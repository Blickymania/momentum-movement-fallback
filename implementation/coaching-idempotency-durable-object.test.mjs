import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CoachingInteractionIdempotency } from "../cloudflare/coaching-interaction-idempotency.mjs";

function createCoordinator(now = 1_800_000_000_000) {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(statement, ...params) {
      const prepared = db.prepare(statement);
      if (/\bRETURNING\b|^\s*SELECT\b/i.test(statement)) {
        return { toArray: () => prepared.all(...params) };
      }
      prepared.run(...params);
      return { toArray: () => [] };
    }
  };
  const ctx = {
    storage: { sql },
    blockConcurrencyWhile(callback) { return callback(); }
  };
  const coordinator = new CoachingInteractionIdempotency(ctx, {});
  coordinator.now = () => now;
  return {
    coordinator, db, ctx,
    setNow(value) { now = value; }
  };
}

test("creates a distinct durable claims table and retention index", () => {
  const env = createCoordinator();
  try {
    const columns = env.db.prepare("PRAGMA table_info(coaching_interaction_claims)").all();
    assert.deepEqual(columns.map(x => x.name), ["interaction_id", "source", "claimed_at_ms"]);
    const indexes = env.db.prepare("PRAGMA index_list(coaching_interaction_claims)").all();
    assert.ok(indexes.some(x => x.name === "coaching_interaction_claims_claimed_at_idx"));
  } finally { env.db.close(); }
});

test("claims each Discord interaction once across sender identities and Durable Object recreation", () => {
  const env = createCoordinator();
  try {
    const interactionId = "12345678901234567";
    assert.deepEqual(env.coordinator.claim({ interactionId, source: "bot005" }), { claimed: true });

    const restarted = new CoachingInteractionIdempotency(env.ctx, {});
    restarted.now = () => env.coordinator.now();
    assert.deepEqual(restarted.claim({ interactionId, source: "coaching-relay" }), { claimed: false });
    assert.deepEqual(restarted.claim({
      interactionId: "22345678901234567", source: "coaching-relay"
    }), { claimed: true });
  } finally { env.db.close(); }
});

test("rejects malformed interaction IDs and unknown sender identities", () => {
  const env = createCoordinator();
  try {
    assert.throws(() => env.coordinator.claim({
      interactionId: "not-a-discord-id", source: "bot005"
    }), /interaction_id_invalid/);
    assert.throws(() => env.coordinator.claim({
      interactionId: "32345678901234567", source: "another"
    }), /coaching_source_invalid/);
  } finally { env.db.close(); }
});

test("expires old claims after seven days without expiring fresh claims", () => {
  const env = createCoordinator();
  try {
    const oldId = "42345678901234567";
    const freshId = "52345678901234567";
    assert.deepEqual(env.coordinator.claim({ interactionId: oldId, source: "bot005" }), { claimed: true });
    env.setNow(env.coordinator.now() + 24 * 60 * 60 * 1000);
    assert.deepEqual(env.coordinator.claim({ interactionId: freshId, source: "bot005" }), { claimed: true });
    env.setNow(env.coordinator.now() + 6 * 24 * 60 * 60 * 1000 + 1);
    assert.deepEqual(env.coordinator.claim({ interactionId: oldId, source: "coaching-relay" }), { claimed: true });
    assert.deepEqual(env.coordinator.claim({ interactionId: freshId, source: "coaching-relay" }), { claimed: false });
  } finally { env.db.close(); }
});

test("internal claim endpoint validates strict JSON and returns atomic duplicate status", async () => {
  const env = createCoordinator();
  try {
    const makeRequest = body => new Request("https://coaching-idempotency.internal/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const invalid = await env.coordinator.fetch(makeRequest({ interactionId: "bad", source: "bot005" }));
    assert.equal(invalid.status, 400);
    const first = await env.coordinator.fetch(makeRequest({
      interactionId: "62345678901234567", source: "bot005"
    }));
    assert.deepEqual(await first.json(), { ok: true, claimed: true, duplicate: false });
    const duplicate = await env.coordinator.fetch(makeRequest({
      interactionId: "62345678901234567", source: "bot005"
    }));
    assert.deepEqual(await duplicate.json(), { ok: true, claimed: false, duplicate: true });
  } finally { env.db.close(); }
});


test("readiness endpoint confirms the isolated Durable Object is initialized", async () => {
  const env = createCoordinator();
  try {
    const response = await env.coordinator.fetch(new Request(
      "https://coaching-idempotency.internal/healthz"
    ));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "coaching-interaction-idempotency",
      ready: true
    });
  } finally { env.db.close(); }
});
