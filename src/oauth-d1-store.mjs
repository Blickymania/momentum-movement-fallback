/**
 * Cloudflare D1 persistence adapter for the manager's MCP OAuth records.
 *
 * Access/refresh tokens, authorization codes, and client secrets are never
 * stored in plaintext. Conditional UPDATE ... RETURNING statements, grouped
 * with INSERT ... SELECT statements in one D1 batch, preserve single-use and
 * rotation semantics without PostgreSQL SELECT FOR UPDATE.
 */
export class OAuthStoreError extends Error {
  constructor(message, code = "oauth_storage_error") {
    super(message);
    this.name = "OAuthStoreError";
    this.code = code;
  }
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function assertDb(db) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw new TypeError("A Cloudflare D1 database binding is required");
  }
}

export class OAuthD1Store {
  constructor(db, options = {}) {
    assertDb(db);
    this.db = db;
    this.now = options.now ?? (() => Date.now());
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
  }

  async ensureSchema() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_name TEXT NOT NULL,
        redirect_uris TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS mcp_oauth_login_requests (
        state_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        client_state TEXT,
        code_challenge TEXT NOT NULL,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        consume_nonce TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        consume_nonce TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS mcp_oauth_access_tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        replaced_by TEXT,
        consume_nonce TEXT
      )`,
      "CREATE INDEX IF NOT EXISTS mcp_oauth_login_expiry_idx ON mcp_oauth_login_requests (expires_at)",
      "CREATE INDEX IF NOT EXISTS mcp_oauth_code_expiry_idx ON mcp_oauth_authorization_codes (expires_at)",
      "CREATE INDEX IF NOT EXISTS mcp_oauth_access_expiry_idx ON mcp_oauth_access_tokens (expires_at)",
      "CREATE INDEX IF NOT EXISTS mcp_oauth_refresh_expiry_idx ON mcp_oauth_refresh_tokens (expires_at)",
    ];
    // D1 batches are transactional: partial schema creation is rolled back if
    // any table or index statement fails.
    await this.db.batch(statements.map((sql) => this.db.prepare(sql)));
    return this.health();
  }

  async health() {
    const names = [
      "mcp_oauth_clients",
      "mcp_oauth_login_requests",
      "mcp_oauth_authorization_codes",
      "mcp_oauth_access_tokens",
      "mcp_oauth_refresh_tokens",
    ];
    const rowsResult = await this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?, ?, ?, ?)",
    ).bind(...names).all();
    const found = new Set(rows(rowsResult).map((row) => row.name));
    const tables = Object.fromEntries(names.map((name) => [name, found.has(name)]));
    return { ready: Object.values(tables).every(Boolean), tables };
  }

  async registerClient({ clientId, clientName, redirectUris }) {
    if (typeof clientId !== "string" || !clientId ||
        typeof clientName !== "string" || !clientName ||
        !Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 10) {
      throw new TypeError("Invalid OAuth client registration");
    }
    const now = this.now();
    await this.db.prepare(
      "INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)",
    ).bind(clientId, clientName.slice(0, 100), JSON.stringify([...new Set(redirectUris)]), now).run();
    return { clientId, clientName: clientName.slice(0, 100), redirectUris: [...new Set(redirectUris)], createdAt: now };
  }

  async getClient(clientId) {
    if (typeof clientId !== "string" || !clientId) return null;
    return this.db.prepare(
      "SELECT client_id, client_name, redirect_uris, created_at FROM mcp_oauth_clients WHERE client_id = ? LIMIT 1",
    ).bind(clientId).first();
  }

  async createLoginRequest({ stateHash, clientId, redirectUri, clientState, codeChallenge, scope, resource, ttlMs = 600000 }) {
    const now = this.now();
    await this.db.prepare(
      `INSERT INTO mcp_oauth_login_requests
       (state_hash, client_id, redirect_uri, client_state, code_challenge, scope, resource, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(stateHash, clientId, redirectUri, clientState ?? null, codeChallenge, scope, resource, now, now + ttlMs).run();
    return { createdAt: now, expiresAt: now + ttlMs };
  }

  async findLoginRequest(stateHash) {
    return this.db.prepare(
      `SELECT state_hash, client_id, redirect_uri, client_state, code_challenge, scope, resource, expires_at
       FROM mcp_oauth_login_requests
       WHERE state_hash = ? AND expires_at > ? AND consumed_at IS NULL
       LIMIT 1`,
    ).bind(stateHash, this.now()).first();
  }

  async consumeLoginRequestAndCreateCode({ stateHash, authorizationCodeHash, userId, guildId, ttlMs = 300000 }) {
    const now = this.now();
    const nonce = this.randomId();
    const batch = await this.db.batch([
      this.db.prepare(
        `UPDATE mcp_oauth_login_requests
         SET consumed_at = ?, consume_nonce = ?
         WHERE state_hash = ? AND expires_at > ? AND consumed_at IS NULL
         RETURNING state_hash`,
      ).bind(now, nonce, stateHash, now),
      this.db.prepare(
        `INSERT INTO mcp_oauth_authorization_codes
         (code_hash, client_id, redirect_uri, code_challenge, user_id, guild_id, scope, resource, created_at, expires_at)
         SELECT ?, client_id, redirect_uri, code_challenge, ?, ?, scope, resource, ?, ?
         FROM mcp_oauth_login_requests
         WHERE state_hash = ? AND consumed_at = ? AND consume_nonce = ?`,
      ).bind(authorizationCodeHash, userId, guildId, now, now + ttlMs, stateHash, now, nonce),
    ]);
    const claimed = rows(batch?.[0]).length === 1;
    const inserted = Number(batch?.[1]?.meta?.changes ?? 0) === 1;
    if (!claimed || !inserted) {
      throw new OAuthStoreError("invalid_state", "invalid_state");
    }
    return { createdAt: now, expiresAt: now + ttlMs };
  }

  async exchangeAuthorizationCode({
    codeHash,
    clientId,
    redirectUri,
    codeChallenge,
    resource,
    accessTokenHash,
    refreshTokenHash,
    accessTtlMs = 3600000,
    refreshTtlMs = 2592000000,
  }) {
    const now = this.now();
    const nonce = this.randomId();
    const batch = await this.db.batch([
      this.db.prepare(
        `UPDATE mcp_oauth_authorization_codes
         SET consumed_at = ?, consume_nonce = ?
         WHERE code_hash = ? AND client_id = ? AND redirect_uri = ?
           AND code_challenge = ? AND (? = '' OR resource = ?)
           AND expires_at > ? AND consumed_at IS NULL
         RETURNING code_hash`,
      ).bind(now, nonce, codeHash, clientId, redirectUri, codeChallenge, resource ?? "", resource ?? "", now),
      this.db.prepare(
        `INSERT INTO mcp_oauth_access_tokens
         (token_hash, client_id, user_id, guild_id, scope, resource, created_at, expires_at)
         SELECT ?, client_id, user_id, guild_id, scope, resource, ?, ?
         FROM mcp_oauth_authorization_codes
         WHERE code_hash = ? AND consumed_at = ? AND consume_nonce = ?`,
      ).bind(accessTokenHash, now, now + accessTtlMs, codeHash, now, nonce),
      this.db.prepare(
        `INSERT INTO mcp_oauth_refresh_tokens
         (token_hash, client_id, user_id, guild_id, scope, resource, created_at, expires_at)
         SELECT ?, client_id, user_id, guild_id, scope, resource, ?, ?
         FROM mcp_oauth_authorization_codes
         WHERE code_hash = ? AND consumed_at = ? AND consume_nonce = ?`,
      ).bind(refreshTokenHash, now, now + refreshTtlMs, codeHash, now, nonce),
    ]);
    const claimed = rows(batch?.[0]).length === 1;
    const accessInserted = Number(batch?.[1]?.meta?.changes ?? 0) === 1;
    const refreshInserted = Number(batch?.[2]?.meta?.changes ?? 0) === 1;
    if (!claimed || !accessInserted || !refreshInserted) {
      throw new OAuthStoreError("invalid_grant", "invalid_grant");
    }
    return { issuedAt: now, accessExpiresAt: now + accessTtlMs, refreshExpiresAt: now + refreshTtlMs };
  }

  async rotateRefreshToken({
    oldRefreshTokenHash,
    clientId,
    resource,
    accessTokenHash,
    newRefreshTokenHash,
    accessTtlMs = 3600000,
    refreshTtlMs = 2592000000,
  }) {
    const now = this.now();
    const nonce = this.randomId();
    const batch = await this.db.batch([
      this.db.prepare(
        `UPDATE mcp_oauth_refresh_tokens
         SET revoked_at = ?, replaced_by = ?, consume_nonce = ?
         WHERE token_hash = ? AND client_id = ? AND revoked_at IS NULL
           AND expires_at > ? AND (? = '' OR resource = ?)
         RETURNING token_hash`,
      ).bind(now, newRefreshTokenHash, nonce, oldRefreshTokenHash, clientId, now, resource ?? "", resource ?? ""),
      this.db.prepare(
        `INSERT INTO mcp_oauth_access_tokens
         (token_hash, client_id, user_id, guild_id, scope, resource, created_at, expires_at)
         SELECT ?, client_id, user_id, guild_id, scope, resource, ?, ?
         FROM mcp_oauth_refresh_tokens
         WHERE token_hash = ? AND revoked_at = ? AND consume_nonce = ?`,
      ).bind(accessTokenHash, now, now + accessTtlMs, oldRefreshTokenHash, now, nonce),
      this.db.prepare(
        `INSERT INTO mcp_oauth_refresh_tokens
         (token_hash, client_id, user_id, guild_id, scope, resource, created_at, expires_at)
         SELECT ?, client_id, user_id, guild_id, scope, resource, ?, ?
         FROM mcp_oauth_refresh_tokens
         WHERE token_hash = ? AND revoked_at = ? AND consume_nonce = ?`,
      ).bind(newRefreshTokenHash, now, now + refreshTtlMs, oldRefreshTokenHash, now, nonce),
    ]);
    const claimed = rows(batch?.[0]).length === 1;
    const accessInserted = Number(batch?.[1]?.meta?.changes ?? 0) === 1;
    const refreshInserted = Number(batch?.[2]?.meta?.changes ?? 0) === 1;
    if (!claimed || !accessInserted || !refreshInserted) {
      throw new OAuthStoreError("invalid_grant", "invalid_grant");
    }
    return { issuedAt: now, accessExpiresAt: now + accessTtlMs, refreshExpiresAt: now + refreshTtlMs };
  }

  async authenticateAccessToken(tokenHash, expectedResource, expectedGuildId) {
    const now = this.now();
    const row = await this.db.prepare(
      `SELECT client_id, user_id, guild_id, scope, resource
       FROM mcp_oauth_access_tokens
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
       LIMIT 1`,
    ).bind(tokenHash, now).first();
    if (!row || row.resource !== expectedResource || String(row.guild_id) !== String(expectedGuildId)) {
      return null;
    }
    return row;
  }

  async revokeToken(tokenHash, clientId = "") {
    const now = this.now();
    const result = await this.db.batch([
      this.db.prepare(
        "UPDATE mcp_oauth_access_tokens SET revoked_at = ? WHERE token_hash = ? AND (? = '' OR client_id = ?) AND revoked_at IS NULL",
      ).bind(now, tokenHash, clientId, clientId),
      this.db.prepare(
        "UPDATE mcp_oauth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND (? = '' OR client_id = ?) AND revoked_at IS NULL",
      ).bind(now, tokenHash, clientId, clientId),
    ]);
    return {
      accessTokensRevoked: Number(result?.[0]?.meta?.changes ?? 0),
      refreshTokensRevoked: Number(result?.[1]?.meta?.changes ?? 0),
    };
  }
}
