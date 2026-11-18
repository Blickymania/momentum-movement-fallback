import test from "node:test";
import assert from "node:assert/strict";
import { DurableBot005ConfirmationStore } from "../src/durable-bot005-confirmations.mjs";
import { createBot005ForumConfirmHandler } from "../src/bot005-forum-confirm-handler.mjs";

const GUILD = "1565048205970767992", APP = "1565304619838742598";
const OWNER = "1565200000000000001", OTHER = "1565200000000000002";
const CHANNEL = "1566000000000000001", MESSAGE = "1566000000000000002";
const THREAD = "1566000000000000003", PLAN = "confirmation_nonce_0001";
class MemoryStorage {
  constructor() { this.values = new Map(); this.pending = Promise.resolve(); }
  async get(key) { return structuredClone(this.values.get(key)); }
  async transaction(callback) {
    const run = async () => {
      const next = new Map([...this.values].map(([key, value]) => [key, structuredClone(value)]));
      const txn = { get: async (key) => structuredClone(next.get(key)), put: async (key, value) => next.set(key, structuredClone(value)) };
      const result = await callback(txn); this.values = next; return result;
    };
    const result = this.pending.then(run, run); this.pending = result.then(() => undefined, () => undefined); return result;
  }
}
function interaction({ action = "confirm", userId = OWNER, channelId = CHANNEL, messageId = MESSAGE } = {}) {
  return {
    id: "1565200000000000003", token: "test-interaction-token-never-stored",
    type: 3, guild_id: GUILD, application_id: APP, channel_id: channelId,
    member: { user: { id: userId } },
    data: { custom_id: "mm005:forum-confirm:" + action + ":" + PLAN },
    message: { id: messageId, author: { id: APP } },
  };
}
async function fixture({ owner = OWNER, executor = async () => ({ state: "failed", code: "handler_unavailable" }) } = {}) {
  let now = 1_000_000;
  const storage = new MemoryStorage();
  const confirmationStore = new DurableBot005ConfirmationStore(storage, { now: () => now });
  await confirmationStore.create({
    id: PLAN, kind: "forum-rename", actorId: OWNER, guildId: GUILD, channelId: CHANNEL,
    expiresAt: now + 120_000, payload: { threadId: THREAD, forumId: CHANNEL, before: "old", title: "new" },
  });
  await confirmationStore.bindMessage(PLAN, MESSAGE);
  const calls = { getOwner: [], executor: [], replies: [] };
  const handler = createBot005ForumConfirmHandler({
    confirmationStore, revealInteraction: async (value) => value,
    editDeferredReply: async (reply) => calls.replies.push(reply),
    getGuildOwnerId: async (id) => { calls.getOwner.push(id); return owner; },
    executeConfirmed: async (plan) => { calls.executor.push(plan); return executor(plan); },
    guildId: GUILD, applicationId: APP,
  });
  return { handler, confirmationStore, calls, storage, setNow: (value) => { now = value; } };
}

test("cancels only the bound owner's pending action and does not call the executor", async () => {
  const f = await fixture();
  await f.handler({ eventType: "INTERACTION_CREATE", guildId: GUILD, payload: interaction({ action: "cancel" }) });
  assert.equal((await f.confirmationStore.get(PLAN)).state, "cancelled");
  assert.equal(f.calls.executor.length, 0);
  assert.match(f.calls.replies[0].content, /cancelled/i);
});

test("a non-owner confirmation cannot claim or execute the plan", async () => {
  const f = await fixture();
  await f.handler({ eventType: "INTERACTION_CREATE", guildId: GUILD, payload: interaction({ userId: OTHER }) });
  assert.equal((await f.confirmationStore.get(PLAN)).state, "pending");
  assert.equal(f.calls.executor.length, 0);
});

test("exact owner confirmation claims one time and records a failed no-op when no executor action exists", async () => {
  const f = await fixture();
  await f.handler({ eventType: "INTERACTION_CREATE", guildId: GUILD, payload: interaction() });
  assert.equal((await f.confirmationStore.get(PLAN)).state, "failed");
  assert.equal((await f.confirmationStore.get(PLAN)).resultCode, "handler_unavailable");
  assert.equal(f.calls.executor.length, 1);
});

test("the handler records an uncertain executor outcome and never retries it", async () => {
  const f = await fixture({ executor: async () => { throw new Error("transport timeout"); } });
  await f.handler({ eventType: "INTERACTION_CREATE", guildId: GUILD, payload: interaction() });
  assert.equal((await f.confirmationStore.get(PLAN)).state, "unknown");
  assert.equal((await f.confirmationStore.get(PLAN)).resultCode, "executor_outcome_unknown");
  await f.handler({ eventType: "INTERACTION_CREATE", guildId: GUILD, payload: interaction() });
  assert.equal(f.calls.executor.length, 1);
});

test("rejects wrong guild, app, message author, or malformed component id before claiming", async () => {
  for (const change of [
    { guild_id: "1565048205970767999" }, { application_id: "1565304619838742599" },
    { message: { id: MESSAGE, author: { id: OTHER } } },
    { data: { custom_id: "mm005:forum-confirm:confirm:short" } },
  ]) {
    const f = await fixture();
    await assert.rejects(f.handler({
      eventType: "INTERACTION_CREATE", guildId: GUILD, payload: { ...interaction(), ...change },
    }), /invalid/);
    assert.equal((await f.confirmationStore.get(PLAN)).state, "pending");
  }
});

test("checks confirmation channel and message binding; does not consume a mismatched plan", async () => {
  const f = await fixture();
  await f.handler({ eventType: "INTERACTION_CREATE", guildId: GUILD, payload: interaction({ channelId: "1566000000000000009" }) });
  assert.equal((await f.confirmationStore.get(PLAN)).state, "pending");
  assert.match(f.calls.replies[0].content, /not valid/i);
});

test("sanitizes response mentions and reports missing owner identity as an error", async () => {
  const f = await fixture({ executor: async () => ({ state: "completed" }) });
  f.calls.replies = [];
  await f.handler({ eventType: "INTERACTION_CREATE", guildId: GUILD, payload: interaction() });
  assert.ok(!f.calls.replies[0].content.includes("@everyone"));
  assert.equal(f.calls.getOwner[0], GUILD);
});
