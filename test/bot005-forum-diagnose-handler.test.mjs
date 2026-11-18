import test from "node:test";
import assert from "node:assert/strict";
import { createBot005ForumDiagnoseHandler } from "../src/bot005-forum-diagnose-handler.mjs";
const GUILD = "1565048205970767992", APP = "1565304619838742598";
const OWNER = "1565200000000000001", MEMBER = "1565200000000000002";
function event(userId = OWNER, overrides = {}) {
  const payload = {
    id: "1565200000000000003", token: "interaction-token", type: 2,
    guild_id: GUILD, application_id: APP,
    member: { user: { id: userId }, permissions: "0" },
    data: { name: "forum-admin", options: [{ type: 1, name: "diagnose" }] },
  };
  return { eventType: "INTERACTION_CREATE", guildId: GUILD, payload: { ...payload, ...overrides } };
}
function harness(ownerId = OWNER, channels = []) {
  const calls = { owner: 0, channels: 0, edits: [], writes: 0 };
  const handler = createBot005ForumDiagnoseHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => calls.edits.push(reply),
    getGuildOwnerId: async () => { calls.owner += 1; return ownerId; },
    getGuildChannels: async () => { calls.channels += 1; return channels; },
    guildId: GUILD, applicationId: APP,
  });
  return { handler, calls };
}
test("diagnoses visible same-guild forums without revealing channel names or writing", async () => {
  const { handler, calls } = harness(OWNER, [
    { id: "1566000000000000001", guild_id: GUILD, type: 15, name: "private-forum" },
    { id: "1566000000000000002", guild_id: GUILD, type: 0, name: "chat" },
    { id: "1566000000000000003", guild_id: "1565048205970767993", type: 15, name: "foreign-forum" },
    { id: "1566000000000000004", guild_id: GUILD, type: 15, name: "second-forum" },
  ]);
  const result = await handler(event());
  assert.equal(result.committed, true);
  assert.equal(calls.channels, 1);
  assert.equal(calls.writes, 0);
  assert.match(calls.edits[0].content, /Forums visible to this bot: 2/);
  assert.match(calls.edits[0].content, /not a complete forum or permission audit/);
  assert.doesNotMatch(calls.edits[0].content, /private-forum|foreign-forum|second-forum/);
});
test("rejects non-owner even when permissions claim Manage Guild", async () => {
  const { handler, calls } = harness();
  const interaction = event(MEMBER);
  interaction.payload.member.permissions = "32";
  await handler(interaction);
  assert.equal(calls.channels, 0);
  assert.match(calls.edits[0].content, /restricted to the server owner/);
});
test("rejects mismatched identity and malformed channel results", async () => {
  const { handler } = harness();
  await assert.rejects(handler({ ...event(), guildId: "1565048205970767993" }), /identity_mismatch/);
  const malformed = harness(OWNER, null);
  await assert.rejects(malformed.handler(event()), /channels_invalid/);
});
