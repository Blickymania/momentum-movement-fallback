import test from "node:test";
import assert from "node:assert/strict";
import { createBot005ForumInspectHandler } from "../src/bot005-forum-inspect-handler.mjs";
const GUILD = "1565048205970767992", APP = "1565304619838742598";
const OWNER = "1565200000000000001", MEMBER = "1565200000000000002";
const FORUM = "1566000000000000001";
function event(userId = OWNER, changes = {}) {
  const payload = {
    id: "1565200000000000003", token: "non-production-forum-inspect-token", type: 2,
    guild_id: GUILD, application_id: APP,
    member: { user: { id: userId }, permissions: "0" },
    data: { name: "forum-admin", options: [{ type: 1, name: "inspect", options: [
      { type: 7, name: "forum", value: FORUM },
    ] }] },
  };
  return { eventType: "INTERACTION_CREATE", guildId: GUILD, payload: { ...payload, ...changes } };
}
function harness(ownerId = OWNER, channel = {
  id: FORUM, guild_id: GUILD, type: 15, name: "private-forum",
  available_tags: [
    { id: "1566000000000000002", name: "Announcements", moderated: false },
    { id: "1566000000000000003", name: "@everyone", moderated: true },
  ],
}) {
  const calls = { owner: 0, channelIds: [], replies: [], writes: 0 };
  const handler = createBot005ForumInspectHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => calls.replies.push(reply),
    getGuildOwnerId: async (guildId) => { calls.owner += 1; assert.equal(guildId, GUILD); return ownerId; },
    getForumChannel: async (id) => { calls.channelIds.push(id); return channel; },
    guildId: GUILD, applicationId: APP,
  });
  return { handler, calls };
}
test("inspects only selected same-guild forum tags, sanitizes mentions, and writes nothing", async () => {
  const { handler, calls } = harness();
  const result = await handler(event());
  assert.equal(result.committed, true);
  assert.deepEqual(calls.channelIds, [FORUM]);
  assert.match(calls.replies[0].content, /Announcements/);
  assert.match(calls.replies[0].content, /@\u200beveryone/);
  assert.doesNotMatch(calls.replies[0].content, /private-forum/);
  assert.equal(calls.writes, 0);
});
test("refuses non-owners before reading the selected channel", async () => {
  const { handler, calls } = harness();
  await handler(event(MEMBER));
  assert.deepEqual(calls.channelIds, []);
  assert.match(calls.replies[0].content, /restricted to the server owner/);
});
test("rejects malformed selections and channel responses outside the requested forum", async () => {
  const { handler } = harness();
  const noOption = event();
  noOption.payload.data.options[0].options = [];
  await assert.rejects(handler(noOption), /interaction_invalid/);
  const foreign = harness(OWNER, { id: FORUM, guild_id: "1565048205970767993", type: 15, available_tags: [] });
  await assert.rejects(foreign.handler(event()), /channel_identity_mismatch/);
  const wrongType = harness(OWNER, { id: FORUM, guild_id: GUILD, type: 0, available_tags: [] });
  await assert.rejects(wrongType.handler(event()), /channel_identity_mismatch/);
});
test("rejects malformed tag data and fails closed when tags exceed Discord's limit", async () => {
  const invalid = harness(OWNER, { id: FORUM, guild_id: GUILD, type: 15, available_tags: [{ id: "bad", name: "tag", moderated: false }] });
  await assert.rejects(invalid.handler(event()), /tag_invalid/);
  const excess = harness(OWNER, { id: FORUM, guild_id: GUILD, type: 15, available_tags: Array.from({ length: 21 }, (_, i) =>
    ({ id: String(1566000000000000000n + BigInt(i + 10)), name: "tag", moderated: false })) });
  await assert.rejects(excess.handler(event()), /tags_invalid/);
});
