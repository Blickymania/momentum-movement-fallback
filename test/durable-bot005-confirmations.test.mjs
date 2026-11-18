import test from "node:test";
import assert from "node:assert/strict";
import { DurableBot005ConfirmationStore } from "../src/durable-bot005-confirmations.mjs";

const ID = "confirmation_nonce_0001";
const OWNER = "1565200000000000001";
const GUILD = "1565048205970767992";
const CHANNEL = "1566000000000000001";
const MESSAGE = "1566000000000000002";
const THREAD = "1566000000000000003";

class MemoryStorage {
  constructor(seed) { this.values = new Map(seed ? [[seed.key, structuredClone(seed.value)]] : []); this.pending = Promise.resolve(); }
  async get(key) { return structuredClone(this.values.get(key)); }
  async transaction(callback) {
    const run = async () => {
      const next = new Map([...this.values].map(([key, value]) => [key, structuredClone(value)]));
      const txn = {
        get: async (key) => structuredClone(next.get(key)),
        put: async (key, value) => next.set(key, structuredClone(value)),
      };
      const result = await callback(txn);
      this.values = next;
      return result;
    };
    const result = this.pending.then(run, run);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }
}
function fixture({ now = 1_000_000, maxPlans = 64 } = {}) {
  const storage = new MemoryStorage();
  const store = new DurableBot005ConfirmationStore(storage, { now: () => now, maxPlans });
  return { store, storage, now: () => now };
}
function plan(id = ID, now = 1_000_000) {
  return {
    id, kind: "forum-rename", actorId: OWNER, guildId: GUILD, channelId: CHANNEL,
    expiresAt: now + 120_000, payload: { threadId: THREAD, forumId: CHANNEL, before: "old", title: "new" },
  };
}
const actor = (overrides = {}) => ({
  actorId: OWNER, guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE, ...overrides,
});

test("stores bounded non-secret plan metadata and binds one confirmation message", async () => {
  const { store } = fixture();
  const created = await store.create(plan());
  assert.equal(created.status, "created");
  assert.equal(created.plan.messageId, null);
  assert.equal((await store.bindMessage(ID, MESSAGE)).status, "bound");
  assert.equal((await store.bindMessage(ID, MESSAGE)).status, "bound");
  assert.equal((await store.bindMessage(ID, "1566000000000000004")).status, "binding_conflict");
  assert.equal((await store.get(ID)).messageId, MESSAGE);
});

test("does not allow claim until message is bound", async () => {
  const { store } = fixture();
  await store.create(plan());
  assert.equal((await store.claim(ID, actor())).status, "not_bound");
});

test("binds a claim to exact actor, guild, channel and confirmation message", async () => {
  const { store } = fixture();
  await store.create(plan());
  await store.bindMessage(ID, MESSAGE);
  for (const changed of [
    { actorId: "1565200000000000008" },
    { guildId: "1565048205970767993" },
    { channelId: "1566000000000000008" },
    { messageId: "1566000000000000008" },
  ]) assert.equal((await store.claim(ID, actor(changed))).status, "binding_mismatch");
  assert.equal((await store.claim(ID, actor())).status, "claimed");
});

test("concurrent confirmation clicks can claim an action only once", async () => {
  const { store } = fixture();
  await store.create(plan());
  await store.bindMessage(ID, MESSAGE);
  const results = await Promise.all([store.claim(ID, actor()), store.claim(ID, actor())]);
  assert.deepEqual(results.map((item) => item.status).sort(), ["claimed", "executing"]);
});

test("expires an unclaimed plan without allowing execution", async () => {
  let now = 1_000_000;
  const storage = new MemoryStorage();
  const store = new DurableBot005ConfirmationStore(storage, { now: () => now });
  await store.create(plan(ID, now));
  await store.bindMessage(ID, MESSAGE);
  now += 120_000;
  assert.equal((await store.claim(ID, actor())).status, "expired");
  assert.equal((await store.get(ID)).state, "expired");
});

test("cancel is bound to the same actor and consumes the pending action", async () => {
  const { store } = fixture();
  await store.create(plan());
  await store.bindMessage(ID, MESSAGE);
  assert.equal((await store.cancel(ID, actor({ actorId: "1565200000000000008" }))).status, "binding_mismatch");
  assert.equal((await store.cancel(ID, actor())).status, "cancelled");
  assert.equal((await store.claim(ID, actor())).status, "cancelled");
});

test("terminal results cannot be claimed or rewritten", async () => {
  const { store } = fixture();
  await store.create(plan());
  await store.bindMessage(ID, MESSAGE);
  assert.equal((await store.claim(ID, actor())).status, "claimed");
  assert.equal((await store.finish(ID, { state: "completed", code: "verified" })).status, "completed");
  assert.equal((await store.claim(ID, actor())).status, "completed");
  assert.equal((await store.finish(ID, { state: "unknown", code: "late" })).status, "completed");
});

test("validates TTL, payload shape and sensitive material before persisting", async () => {
  const { store, storage } = fixture();
  await assert.rejects(store.create({ ...plan(), expiresAt: 1_000_001 + 120_000 }), /invalid|safety/i);
  await assert.rejects(store.create({ ...plan(), payload: { threadId: THREAD, token: "never-store" } }), /invalid|safety/i);
  assert.equal(await storage.get("bot005:confirmation-plans:v1"), undefined);
});

test("enforces capacity instead of evicting live pending confirmations", async () => {
  const { store } = fixture({ maxPlans: 1 });
  assert.equal((await store.create(plan())).status, "created");
  assert.equal((await store.create(plan("confirmation_nonce_0002"))).status, "capacity");
  assert.equal((await store.get(ID)).state, "pending");
});

test("fails closed on corrupted persisted state", async () => {
  const key = "bot005:confirmation-plans:v1";
  const storage = new MemoryStorage({ key, value: { plans: [{ id: "bad" }] } });
  const store = new DurableBot005ConfirmationStore(storage);
  await assert.rejects(store.create(plan()), /corrupt/);
});
