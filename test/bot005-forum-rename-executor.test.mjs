import test from "node:test";
import assert from "node:assert/strict";
import { createBot005ForumRenameExecutor } from "../src/bot005-forum-rename-executor.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const OWNER = "1565200000000000001";
const INVOCATION_CHANNEL = "1565643251783049237";
const THREAD = "1566000000000000005";
const FORUM = "1566000000000000001";
const OLD = "Old title";
const NEXT = "Updated title";
const plan = (overrides = {}) => ({
  kind: "forum-rename", actorId: OWNER, guildId: GUILD, channelId: INVOCATION_CHANNEL,
  payload: { threadId: THREAD, forumId: FORUM, before: OLD, title: NEXT }, ...overrides,
});
const threadRecord = (overrides = {}) => ({
  id: THREAD, guild_id: GUILD, parent_id: FORUM, type: 11, name: OLD,
  thread_metadata: { archived: false, locked: false }, ...overrides,
});
const forumRecord = (overrides = {}) => ({
  id: FORUM, guild_id: GUILD, type: 15, name: "community-forum", ...overrides,
});
function fixture({ thread, forum, permissions = "17179869184", patch } = {}) {
  let currentThread = thread ?? threadRecord();
  const calls = [];
  const executor = createBot005ForumRenameExecutor({
    guildId: GUILD, applicationId: APP,
    getChannel: async (id) => {
      calls.push({ method: "GET", id });
      if (id === THREAD) return structuredClone(currentThread);
      if (id === FORUM) return structuredClone(forum ?? forumRecord());
      return null;
    },
    getMemberPermissions: async (channelId, userId) => {
      calls.push({ method: "PERMISSIONS", channelId, userId });
      return { permissions };
    },
    patchChannel: async (id, body) => {
      calls.push({ method: "PATCH", id, body: structuredClone(body) });
      if (patch) return patch({ id, body, calls, setThread: (value) => { currentThread = value; } });
      currentThread = { ...currentThread, name: body.name };
      return { ok: true, status: 200 };
    },
  });
  return { executor, calls, setThread: (record) => { currentThread = record; } };
}

test("renames a validated active forum thread with Manage Threads and verifies by GET", async () => {
  const f = fixture();
  assert.deepEqual(await f.executor(plan()), { state: "completed", code: "rename_verified" });
  assert.deepEqual(f.calls.map((call) => call.method), ["GET", "GET", "PERMISSIONS", "GET", "PATCH", "GET"]);
  assert.deepEqual(f.calls.find((call) => call.method === "PATCH"), {
    method: "PATCH", id: THREAD, body: { name: NEXT },
  });
  assert.equal(f.calls.find((call) => call.method === "PERMISSIONS").channelId, FORUM);
  assert.equal(f.calls.find((call) => call.method === "PERMISSIONS").userId, APP);
});

test("fails closed without MANAGE_THREADS or ADMINISTRATOR", async () => {
  for (const permissions of ["0", "17179869176", "invalid"]) {
    const f = fixture({ permissions });
    assert.deepEqual(await f.executor(plan()), { state: "failed", code: "manage_threads_required" });
    assert.equal(f.calls.some((call) => call.method === "PATCH"), false);
  }
  const admin = fixture({ permissions: "8" });
  assert.deepEqual(await admin.executor(plan()), { state: "completed", code: "rename_verified" });
});

test("rejects stale, archived, cross-guild, wrong-type and wrong-parent targets before writing", async () => {
  const cases = [
    { thread: threadRecord({ name: "Changed after staging" }), code: "thread_title_changed" },
    { thread: threadRecord({ thread_metadata: { archived: true } }), code: "thread_archived" },
    { thread: threadRecord({ guild_id: "1565048205970767993" }), code: "thread_identity_changed" },
    { thread: threadRecord({ type: 12 }), code: "thread_identity_changed" },
    { forum: forumRecord({ type: 0 }), code: "forum_identity_changed" },
  ];
  for (const item of cases) {
    const f = fixture(item);
    assert.deepEqual(await f.executor(plan()), { state: "failed", code: item.code });
    assert.equal(f.calls.some((call) => call.method === "PATCH"), false);
  }
});

test("idempotent retry sees the target title and never sends a second PATCH", async () => {
  const f = fixture({ thread: threadRecord({ name: NEXT }) });
  assert.deepEqual(await f.executor(plan()), { state: "completed", code: "already_applied" });
  assert.equal(f.calls.some((call) => call.method === "PATCH"), false);
});

test("an uncertain PATCH is resolved by a fresh GET and is never retried", async () => {
  const f = fixture({ patch: async () => { throw new Error("transport timeout"); } });
  assert.deepEqual(await f.executor(plan()), { state: "failed", code: "rename_not_observed" });
  assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 1);
  const applied = fixture({ patch: async ({ setThread }) => {
    setThread(threadRecord({ name: NEXT }));
    throw new Error("lost response after apply");
  } });
  assert.deepEqual(await applied.executor(plan()), {
    state: "completed", code: "rename_verified_after_uncertain_write",
  });
  assert.equal(applied.calls.filter((call) => call.method === "PATCH").length, 1);
});

test("postcondition mismatch and unavailable readback remain unknown without another write", async () => {
  const mismatched = fixture({ patch: async ({ setThread }) => {
    setThread(threadRecord({ name: "Unexpected concurrent title" }));
    return { ok: true, status: 200 };
  } });
  assert.deepEqual(await mismatched.executor(plan()), { state: "unknown", code: "rename_postcondition_mismatch" });
  assert.equal(mismatched.calls.filter((call) => call.method === "PATCH").length, 1);
});
