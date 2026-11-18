import test from "node:test";
import assert from "node:assert/strict";
import { createBot005ForumThreadHandler } from "../src/bot005-forum-thread-handler.mjs";
const GUILD = "1565048205970767992", APP = "1565304619838742598";
const OWNER = "1565200000000000001", MEMBER = "1565200000000000002";
const THREAD = "1566000000000000005", FORUM = "1566000000000000001";
const TAG = "1566000000000000002";
function event(userId = OWNER, threadId = THREAD) {
  return { eventType: "INTERACTION_CREATE", guildId: GUILD, payload: {
    id: "1565200000000000003", token: "non-production-forum-thread-token",
    type: 2, guild_id: GUILD, application_id: APP,
    member: { user: { id: userId }, permissions: "0" },
    data: { name: "forum-admin", options: [{ type: 1, name: "thread", options: [
      { type: 3, name: "thread_id", value: threadId },
    ] }] },
  } };
}
function mocks(ownerId = OWNER, records = {}) {
  const forum = records.forum ?? { id: FORUM, guild_id: GUILD, type: 15,
    available_tags: [{ id: TAG, name: "Question", moderated: false }] };
  const thread = records.thread ?? { id: THREAD, guild_id: GUILD, parent_id: FORUM, type: 11,
    name: "Need @everyone help", applied_tags: [TAG],
    thread_metadata: { archived: false, locked: false, archive_timestamp: "2026-11-01T00:00:00.000Z" } };
  const calls = { reads: [], replies: [], writes: 0 };
  const handler = createBot005ForumThreadHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => calls.replies.push(reply),
    getGuildOwnerId: async () => ownerId,
    getChannel: async (id) => { calls.reads.push(id); return id === THREAD ? thread : id === FORUM ? forum : null; },
    guildId: GUILD, applicationId: APP,
  });
  return { handler, calls };
}
test("inspects same-guild forum thread metadata and applied tag names with no writes", async () => {
  const { handler, calls } = mocks();
  const result = await handler(event());
  assert.equal(result.committed, true);
  assert.deepEqual(calls.reads, [THREAD, FORUM]);
  assert.match(calls.replies[0].content, /Title: .*everyone help/);
  assert.doesNotMatch(calls.replies[0].content, /@everyone/);
  assert.match(calls.replies[0].content, /State: active, unlocked/);
  assert.match(calls.replies[0].content, /Applied tags: Question/);
  assert.match(calls.replies[0].content, /thread messages were not read/);
  assert.equal(calls.writes, 0);
});
test("only the server owner can read thread metadata", async () => {
  const { handler, calls } = mocks();
  await handler(event(MEMBER));
  assert.deepEqual(calls.reads, []);
  assert.match(calls.replies[0].content, /restricted to the server owner/);
});
test("returns a bounded unavailable response for inaccessible thread or parent", async () => {
  const missingThread = mocks(OWNER, { thread: null });
  await missingThread.handler(event());
  assert.deepEqual(missingThread.calls.reads, [THREAD]);
  assert.match(missingThread.calls.replies[0].content, /not available to this bot/);
  const missingParent = mocks(OWNER, { forum: false });
  await missingParent.handler(event());
  assert.deepEqual(missingParent.calls.reads, [THREAD, FORUM]);
  assert.match(missingParent.calls.replies[0].content, /parent forum is not available/);
});
test("rejects mismatched guild, non-forum parent, or malformed thread metadata", async () => {
  const wrongGuild = mocks(OWNER, { thread: {
    id: THREAD, guild_id: "1565048205970767993", parent_id: FORUM, type: 11,
    name: "x", applied_tags: [], thread_metadata: { archived: false, locked: false },
  } });
  await assert.rejects(wrongGuild.handler(event()), /identity_mismatch/);
  const wrongParent = mocks(OWNER, { forum: { id: FORUM, guild_id: GUILD, type: 0, available_tags: [] } });
  await assert.rejects(wrongParent.handler(event()), /parent_or_metadata_invalid/);
});
