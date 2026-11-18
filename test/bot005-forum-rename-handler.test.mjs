import test from "node:test";
import assert from "node:assert/strict";
import { DurableBot005ConfirmationStore } from "../src/durable-bot005-confirmations.mjs";
import { createBot005ForumRenameHandler } from "../src/bot005-forum-rename-handler.mjs";

const GUILD = "1565048205970767992", APP = "1565304619838742598";
const OWNER = "1565200000000000001", OTHER = "1565200000000000002";
const CHANNEL = "1565643251783049237", THREAD = "1566000000000000005", FORUM = "1566000000000000001";
const INTERACTION = "1569000000000000106", MESSAGE = "1566060000000000000";
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
function interaction({ userId = OWNER, threadId = THREAD, title = "Updated title" } = {}) {
  return {
    id: INTERACTION, token: "non-production-rename-interaction-token", type: 2,
    guild_id: GUILD, application_id: APP, channel_id: CHANNEL, member: { user: { id: userId } },
    data: { name: "forum-admin", options: [{ type: 1, name: "rename", options: [
      { type: 3, name: "thread_id", value: threadId }, { type: 3, name: "title", value: title },
    ] }] },
  };
}
async function fixture({ owner = OWNER, thread, forum, edit } = {}) {
  const storage = new MemoryStorage();
  const store = new DurableBot005ConfirmationStore(storage);
  const calls = { reads: [], edits: [], mutations: 0 };
  const defaultThread = { id: THREAD, guild_id: GUILD, parent_id: FORUM, type: 11, name: "Old title" };
  const defaultForum = { id: FORUM, guild_id: GUILD, type: 15, available_tags: [] };
  const handler = createBot005ForumRenameHandler({
    confirmationStore: store, revealInteraction: async (payload) => payload,
    editDeferredReply: async (data) => {
      calls.edits.push(data);
      return edit ? edit(data, calls.edits.length) : { updated: true, status: 200, messageId: MESSAGE };
    },
    getGuildOwnerId: async () => owner,
    getChannel: async (id) => {
      calls.reads.push(id);
      return id === THREAD ? (thread ?? defaultThread) : id === FORUM ? (forum ?? defaultForum) : null;
    },
    guildId: GUILD, applicationId: APP,
  });
  return { handler, store, storage, calls };
}
function event(payload = interaction()) { return { eventType: "INTERACTION_CREATE", guildId: GUILD, payload }; }

test("owner rename stages only a bounded plan and binds both buttons to the returned message", async () => {
  const f = await fixture();
  const result = await f.handler(event());
  const plan = await f.store.get(INTERACTION);
  assert.equal(result.committed, true);
  assert.deepEqual(f.calls.reads, [THREAD, FORUM]);
  assert.equal(plan.state, "pending");
  assert.equal(plan.messageId, MESSAGE);
  assert.deepEqual(plan.payload, { threadId: THREAD, forumId: FORUM, before: "Old title", title: "Updated title" });
  assert.equal(f.calls.edits[0].components[0].components.length, 2);
  assert.ok(f.calls.edits[0].components[0].components.every(button => button.custom_id.includes(INTERACTION)));
  assert.equal(f.calls.mutations, 0);
});

test("non-owner is denied before thread or forum reads", async () => {
  const f = await fixture();
  await f.handler(event(interaction({ userId: OTHER })));
  assert.deepEqual(f.calls.reads, []);
  assert.equal(await f.store.get(INTERACTION), null);
});

test("rejects wrong guild, non-public thread, foreign thread and non-forum parent", async () => {
  for (const record of [
    { thread: { id: THREAD, guild_id: "1565048205970767993", parent_id: FORUM, type: 11, name: "Old" } },
    { thread: { id: THREAD, guild_id: GUILD, parent_id: FORUM, type: 12, name: "Old" } },
    { forum: { id: FORUM, guild_id: GUILD, type: 0, available_tags: [] } },
  ]) {
    const f = await fixture(record);
    await f.handler(event());
    assert.equal(await f.store.get(INTERACTION), null);
    assert.equal(f.calls.mutations, 0);
  }
});

test("validates changed titles and rejects values outside Discord title length", async () => {
  for (const title of ["", "ab", "A".repeat(101), "Old title"]) {
    const f = await fixture();
    await f.handler(event(interaction({ title })));
    assert.equal(await f.store.get(INTERACTION), null);
    assert.equal(f.calls.reads.length, title.length < 3 || title.length > 100 ? 0 : 2);
  }
});

test("cleans controls and cancels the plan if message binding cannot be verified", async () => {
  const f = await fixture({ edit: async (_data, call) =>
    call === 1 ? { updated: true, status: 204, messageId: null } : { updated: true, status: 200, messageId: null },
  });
  await f.handler(event());
  assert.equal((await f.store.get(INTERACTION)).state, "cancelled");
  assert.deepEqual(f.calls.edits[1].components, []);
  assert.equal(f.calls.mutations, 0);
});

test("retries the same command idempotently without creating a second plan", async () => {
  const f = await fixture();
  await f.handler(event());
  await f.handler(event());
  const state = await f.storage.get("bot005:confirmation-plans:v1");
  assert.equal(state.plans.length, 1);
  assert.equal(state.plans[0].messageId, MESSAGE);
  assert.equal(f.calls.mutations, 0);
});
