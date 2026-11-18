import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { OAuthD1Store, OAuthStoreError } from "../src/oauth-d1-store.mjs";

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async all() {
    const results = this.db.prepare(this.sql).all(...this.args);
    return { success: true, results, meta: { changes: results.length } };
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.args) ?? null;
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { success: true, results: [], meta: { changes: Number(result.changes ?? 0) } };
  }
}

class D1TestDatabase {
  constructor() {
    this.raw = new DatabaseSync(":memory:");
    this.pending = Promise.resolve();
  }
  prepare(sql) { return new Statement(this.raw, sql); }
  batch(statements) {
    const execute = async () => {
      this.raw.exec("BEGIN");
      try {
        const output = [];
        for (const statement of statements) {
          const result = statement.sql.includes("RETURNING")
            ? await statement.all()
            : await statement.run();
          output.push(result);
        }
        this.raw.exec("COMMIT");
        return output;
      } catch (error) {
        this.raw.exec("ROLLBACK");
        throw error;
      }
    };
    const next = this.pending.then(execute, execute);
    this.pending = next.catch(() => {});
    return next;
  }
  close() { this.raw.close(); }
}

let sequence = 0;
function makeStore() {
  sequence = 0;
  const db = new D1TestDatabase();
  return {
    db,
    store: new OAuthD1Store(db, {
      now: () => 1_800_000_000_000 + sequence++,
      randomId: () => "nonce-" + sequence++,
    }),
  };
}

const baseLogin = {
  stateHash: "state-hash",
  clientId: "mcp-test-client",
  redirectUri: "https://client.example/callback",
  clientState: "client-state",
  codeChallenge: "challenge-s256",
  scope: "mcp:read mcp:write",
  resource: "https://manager.example/mcp",
};
const baseCode = {
  codeHash: "authorization-code-hash",
  clientId: baseLogin.clientId,
  redirectUri: baseLogin.redirectUri,
  codeChallenge: baseLogin.codeChallenge,
  resource: baseLogin.resource,
  accessTokenHash: "access-token-hash",
  refreshTokenHash: "refresh-token-hash",
};

test("rejects an existing OAuth table with an incomplete schema", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  db.raw.exec("DROP TABLE mcp_oauth_clients; CREATE TABLE mcp_oauth_clients (client_id TEXT PRIMARY KEY)");
  const health = await store.health();
  assert.equal(health.tables.mcp_oauth_clients, true);
  assert.deepEqual(health.missingColumns.mcp_oauth_clients, ["client_name", "redirect_uris", "created_at"]);
  assert.equal(health.ready, false);
  db.close();
});

test("checked-in D1 migration satisfies the readiness schema", async () => {
  const { db, store } = makeStore();
  const migration = readFileSync(new URL("../migrations/0001_oauth_schema.sql", import.meta.url), "utf8");
  db.raw.exec(migration);
  const health = await store.health();
  assert.equal(health.ready, true);
  assert.ok(Object.values(health.missingColumns).every((missing) => missing.length === 0));
  db.close();
});

test("creates the five OAuth tables and expiry indexes", async () => {
  const { db, store } = makeStore();
  const health = await store.ensureSchema();
  assert.equal(health.ready, true);
  assert.deepEqual(Object.values(health.tables), [true, true, true, true, true]);
  const names = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(x => x.name);
  assert.ok(names.includes("mcp_oauth_access_expiry_idx"));
  assert.ok(names.includes("mcp_oauth_refresh_expiry_idx"));
  db.close();
});

test("registers a dynamic client and retrieves its exact redirect allowlist", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  await store.registerClient({
    clientId: baseLogin.clientId,
    clientName: "Momentum Test Client",
    redirectUris: [baseLogin.redirectUri, baseLogin.redirectUri],
  });
  const client = await store.getClient(baseLogin.clientId);
  assert.equal(client.client_name, "Momentum Test Client");
  assert.deepEqual(JSON.parse(client.redirect_uris), [baseLogin.redirectUri]);
  assert.equal(await store.getClient("unknown-client"), null);
  db.close();
});

test("login state invalidation on an OAuth denial is single use", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  await store.registerClient({
    clientId: baseLogin.clientId,
    clientName: "Client",
    redirectUris: [baseLogin.redirectUri],
  });
  await store.createLoginRequest(baseLogin);
  assert.equal(await store.consumeLoginRequestFailure(baseLogin.stateHash), true);
  assert.equal(await store.consumeLoginRequestFailure(baseLogin.stateHash), false);
  assert.equal(await store.findLoginRequest(baseLogin.stateHash), null);
  db.close();
});

test("consumes a login state and creates one authorization code in one D1 batch", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  await store.registerClient({
    clientId: baseLogin.clientId,
    clientName: "Client",
    redirectUris: [baseLogin.redirectUri],
  });
  await store.createLoginRequest(baseLogin);
  assert.ok(await store.findLoginRequest(baseLogin.stateHash));
  await store.consumeLoginRequestAndCreateCode({
    stateHash: baseLogin.stateHash,
    authorizationCodeHash: baseCode.codeHash,
    userId: "user-123",
    guildId: "1565048205970767992",
  });
  assert.equal(await store.findLoginRequest(baseLogin.stateHash), null);
  const code = db.raw.prepare("SELECT * FROM mcp_oauth_authorization_codes WHERE code_hash=?").get(baseCode.codeHash);
  assert.equal(code.user_id, "user-123");
  assert.equal(code.guild_id, "1565048205970767992");
  db.close();
});

test("does not allow a login state to be consumed twice", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  await store.registerClient({ clientId: baseLogin.clientId, clientName: "Client", redirectUris: [baseLogin.redirectUri] });
  await store.createLoginRequest(baseLogin);
  await store.consumeLoginRequestAndCreateCode({
    stateHash: baseLogin.stateHash,
    authorizationCodeHash: baseCode.codeHash,
    userId: "user-123",
    guildId: "1565048205970767992",
  });
  await assert.rejects(() => store.consumeLoginRequestAndCreateCode({
    stateHash: baseLogin.stateHash,
    authorizationCodeHash: "second-code-hash",
    userId: "user-123",
    guildId: "1565048205970767992",
  }), (error) => error instanceof OAuthStoreError && error.code === "invalid_state");
  const count = db.raw.prepare("SELECT COUNT(*) as n FROM mcp_oauth_authorization_codes").get().n;
  assert.equal(count, 1);
  db.close();
});

test("authorization code exchange atomically creates one access and one refresh token", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  await store.registerClient({ clientId: baseLogin.clientId, clientName: "Client", redirectUris: [baseLogin.redirectUri] });
  await store.createLoginRequest(baseLogin);
  await store.consumeLoginRequestAndCreateCode({
    stateHash: baseLogin.stateHash,
    authorizationCodeHash: baseCode.codeHash,
    userId: "user-123",
    guildId: "1565048205970767992",
  });
  const issued = await store.exchangeAuthorizationCode(baseCode);
  assert.equal(issued.client_id, baseLogin.clientId);
  assert.equal(issued.user_id, "user-123");
  assert.equal(issued.guild_id, "1565048205970767992");
  assert.equal(issued.scope, baseLogin.scope);
  assert.equal(issued.resource, baseLogin.resource);
  assert.ok(issued.accessExpiresAt > issued.issuedAt);
  assert.ok(issued.refreshExpiresAt > issued.issuedAt);
  assert.equal(db.raw.prepare("SELECT COUNT(*) as n FROM mcp_oauth_access_tokens").get().n, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) as n FROM mcp_oauth_refresh_tokens").get().n, 1);
  db.close();
});

test("authorization codes are single use and bound to client, redirect, PKCE and resource", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  await store.registerClient({ clientId: baseLogin.clientId, clientName: "Client", redirectUris: [baseLogin.redirectUri] });
  await store.createLoginRequest(baseLogin);
  await store.consumeLoginRequestAndCreateCode({
    stateHash: baseLogin.stateHash,
    authorizationCodeHash: baseCode.codeHash,
    userId: "user-123",
    guildId: "1565048205970767992",
  });
  await assert.rejects(() => store.exchangeAuthorizationCode({ ...baseCode, codeChallenge: "wrong" }), /invalid_grant/);
  await assert.rejects(() => store.exchangeAuthorizationCode({ ...baseCode, redirectUri: "https://evil.example/callback" }), /invalid_grant/);
  const success = await store.exchangeAuthorizationCode(baseCode);
  assert.ok(success);
  await assert.rejects(() => store.exchangeAuthorizationCode({ ...baseCode, accessTokenHash: "second-access", refreshTokenHash: "second-refresh" }), /invalid_grant/);
  assert.equal(db.raw.prepare("SELECT COUNT(*) as n FROM mcp_oauth_access_tokens").get().n, 1);
  db.close();
});

test("concurrent authorization-code redemption allows only one successful exchange", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  await store.registerClient({ clientId: baseLogin.clientId, clientName: "Client", redirectUris: [baseLogin.redirectUri] });
  await store.createLoginRequest(baseLogin);
  await store.consumeLoginRequestAndCreateCode({
    stateHash: baseLogin.stateHash,
    authorizationCodeHash: baseCode.codeHash,
    userId: "user-123",
    guildId: "1565048205970767992",
  });
  const results = await Promise.allSettled([
    store.exchangeAuthorizationCode({ ...baseCode, accessTokenHash: "access-a", refreshTokenHash: "refresh-a" }),
    store.exchangeAuthorizationCode({ ...baseCode, accessTokenHash: "access-b", refreshTokenHash: "refresh-b" }),
  ]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(results.filter(x => x.status === "rejected").length, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) as n FROM mcp_oauth_access_tokens").get().n, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) as n FROM mcp_oauth_refresh_tokens").get().n, 1);
  db.close();
});

test("access-token authentication enforces expiry, revocation, resource and guild", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  await store.registerClient({ clientId: baseLogin.clientId, clientName: "Client", redirectUris: [baseLogin.redirectUri] });
  await store.createLoginRequest(baseLogin);
  await store.consumeLoginRequestAndCreateCode({
    stateHash: baseLogin.stateHash,
    authorizationCodeHash: baseCode.codeHash,
    userId: "user-123",
    guildId: "1565048205970767992",
  });
  await store.exchangeAuthorizationCode(baseCode);
  assert.equal((await store.authenticateAccessToken("access-token-hash", baseLogin.resource, "1565048205970767992")).user_id, "user-123");
  assert.equal(await store.authenticateAccessToken("access-token-hash", "https://other.example/mcp", "1565048205970767992"), null);
  assert.equal(await store.authenticateAccessToken("access-token-hash", baseLogin.resource, "1565048205970767000"), null);
  await store.revokeToken("access-token-hash", baseLogin.clientId);
  assert.equal(await store.authenticateAccessToken("access-token-hash", baseLogin.resource, "1565048205970767992"), null);
  db.close();
});

test("refresh-token rotation revokes the old token and issues a new pair atomically", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  await store.registerClient({ clientId: baseLogin.clientId, clientName: "Client", redirectUris: [baseLogin.redirectUri] });
  await store.createLoginRequest(baseLogin);
  await store.consumeLoginRequestAndCreateCode({
    stateHash: baseLogin.stateHash,
    authorizationCodeHash: baseCode.codeHash,
    userId: "user-123",
    guildId: "1565048205970767992",
  });
  await store.exchangeAuthorizationCode(baseCode);
  const rotated = await store.rotateRefreshToken({
    oldRefreshTokenHash: baseCode.refreshTokenHash,
    clientId: baseLogin.clientId,
    resource: baseLogin.resource,
    accessTokenHash: "next-access-hash",
    newRefreshTokenHash: "next-refresh-hash",
  });
  assert.equal(rotated.client_id, baseLogin.clientId);
  assert.equal(rotated.user_id, "user-123");
  assert.equal(rotated.guild_id, "1565048205970767992");
  assert.equal(rotated.scope, baseLogin.scope);
  assert.equal(rotated.resource, baseLogin.resource);
  const old = db.raw.prepare("SELECT revoked_at, replaced_by FROM mcp_oauth_refresh_tokens WHERE token_hash=?").get(baseCode.refreshTokenHash);
  assert.ok(old.revoked_at);
  assert.equal(old.replaced_by, "next-refresh-hash");
  assert.ok(await store.authenticateAccessToken("next-access-hash", baseLogin.resource, "1565048205970767992"));
  await assert.rejects(() => store.rotateRefreshToken({
    oldRefreshTokenHash: baseCode.refreshTokenHash,
    clientId: baseLogin.clientId,
    resource: baseLogin.resource,
    accessTokenHash: "third-access",
    newRefreshTokenHash: "third-refresh",
  }), /invalid_grant/);
  db.close();
});

test("refresh rotation enforces client and resource binding", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  await store.registerClient({ clientId: baseLogin.clientId, clientName: "Client", redirectUris: [baseLogin.redirectUri] });
  await store.createLoginRequest(baseLogin);
  await store.consumeLoginRequestAndCreateCode({
    stateHash: baseLogin.stateHash,
    authorizationCodeHash: baseCode.codeHash,
    userId: "user-123",
    guildId: "1565048205970767992",
  });
  await store.exchangeAuthorizationCode(baseCode);
  await assert.rejects(() => store.rotateRefreshToken({
    oldRefreshTokenHash: baseCode.refreshTokenHash,
    clientId: "other-client",
    resource: baseLogin.resource,
    accessTokenHash: "wrong-client-access",
    newRefreshTokenHash: "wrong-client-refresh",
  }), /invalid_grant/);
  await assert.rejects(() => store.rotateRefreshToken({
    oldRefreshTokenHash: baseCode.refreshTokenHash,
    clientId: baseLogin.clientId,
    resource: "https://other.example/mcp",
    accessTokenHash: "wrong-resource-access",
    newRefreshTokenHash: "wrong-resource-refresh",
  }), /invalid_grant/);
  assert.equal(db.raw.prepare("SELECT COUNT(*) as n FROM mcp_oauth_access_tokens").get().n, 1);
  db.close();
});

test("token revocation is harmless for unknown tokens and optional client scope", async () => {
  const { db, store } = makeStore();
  await store.ensureSchema();
  const result = await store.revokeToken("missing-token-hash");
  assert.deepEqual(result, { accessTokensRevoked: 0, refreshTokensRevoked: 0 });
  db.close();
});
