import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createInteractionTokenVault } from "../src/interaction-token-vault.mjs";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TOKEN = "opaque-discord-interaction-webhook-token-not-for-storage";

function payload(overrides = {}) {
  return {
    id: "1569000000000000001",
    application_id: "1565304619838742598",
    guild_id: "1565048205970767992",
    channel_id: "1565643996624199760",
    token: TOKEN,
    type: 3,
    data: { component_type: 2, custom_id: "ddxp:my" },
    member: { user: { id: "1569000000000000002" } },
    ...overrides,
  };
}

test("encrypts interaction token and omits plaintext from persisted payload", async () => {
  const vault = createInteractionTokenVault(KEY, webcrypto);
  const encrypted = await vault.encryptPayload(payload());
  assert.equal(Object.prototype.hasOwnProperty.call(encrypted, "token"), false);
  assert.equal(encrypted.interaction_token.version, 1);
  assert.equal(encrypted.interaction_token.algorithm, "A256GCM");
  assert.equal(JSON.stringify(encrypted).includes(TOKEN), false);
  const restored = await vault.decryptPayload(encrypted);
  assert.equal(restored.token, TOKEN);
  assert.equal(restored.data.custom_id, "ddxp:my");
});

test("uses a fresh nonce for every encrypted interaction token", async () => {
  const vault = createInteractionTokenVault(KEY, webcrypto);
  const first = await vault.encryptPayload(payload());
  const second = await vault.encryptPayload(payload());
  assert.notEqual(first.interaction_token.iv, second.interaction_token.iv);
  assert.notEqual(first.interaction_token.ciphertext, second.interaction_token.ciphertext);
});

test("authenticated context prevents moving a token envelope to a different interaction", async () => {
  const vault = createInteractionTokenVault(KEY, webcrypto);
  const encrypted = await vault.encryptPayload(payload());
  await assert.rejects(
    () => vault.decryptPayload({ ...encrypted, id: "1569000000000000003" }),
    /authentication failed/,
  );
  await assert.rejects(
    () => vault.decryptPayload({ ...encrypted, application_id: "1565304619838742599" }),
    /authentication failed/,
  );
  await assert.rejects(
    () => vault.decryptPayload({ ...encrypted, guild_id: "1565048205970767993" }),
    /authentication failed/,
  );
});

test("rejects missing, malformed and tampered interaction token envelopes", async () => {
  const vault = createInteractionTokenVault(KEY, webcrypto);
  await assert.rejects(() => vault.encryptPayload({ id: "1", token: "" }), /missing or malformed/);
  await assert.rejects(() => vault.decryptPayload({ ...payload(), token: TOKEN }), /envelope is invalid/);
  const encrypted = await vault.encryptPayload(payload());
  const tampered = {
    ...encrypted,
    interaction_token: {
      ...encrypted.interaction_token,
      ciphertext: encrypted.interaction_token.ciphertext.slice(0, -2) + "AA",
    },
  };
  await assert.rejects(() => vault.decryptPayload(tampered), /authentication failed/);
});

test("requires exactly 32 bytes of hexadecimal and a working Web Crypto implementation", () => {
  for (const invalid of ["", "abc", "x".repeat(64), "0".repeat(62)]) {
    assert.throws(() => createInteractionTokenVault(invalid, webcrypto), /32 bytes of hexadecimal/);
  }
  assert.throws(() => createInteractionTokenVault(KEY, {}), /Web Crypto/);
});
