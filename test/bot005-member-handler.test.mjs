import test from "node:test";
import assert from "node:assert/strict";
import { createBot005MemberHandler } from "../src/bot005-member-handler.mjs";
const GUILD = "1565048205970767992", APP = "1565304619838742598", USER = "1569000000000000099";
const interaction = { id: "1569000000000000062", application_id: APP, guild_id: GUILD,
  token: "non-production-member-interaction-token", type: 2,
  data: { name: "member", options: [{ name: "user", type: 6, value: USER }],
    resolved: { users: { [USER]: { id: USER, username: "Safe_User", bot: false } } } } };
const event = (payload = interaction, guildId = GUILD) => ({ eventType: "INTERACTION_CREATE", guildId, payload });
function make(getGuildMember, replies = []) {
  return createBot005MemberHandler({ revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => replies.push(reply), getGuildMember, guildId: GUILD, applicationId: APP });
}
test("/member reads one selected guild member and returns the recovered public fields", async () => {
  const reads = [], replies = [];
  const handler = make(async (guildId, userId) => {
    reads.push([guildId, userId]); return { user: { id: userId }, joined_at: "2021-08-15T22:30:00.000Z" };
  }, replies);
  assert.deepEqual(await handler(event()), { committed: true, receiptId: "bot005-member-" + interaction.id });
  assert.deepEqual(reads, [[GUILD, USER]]);
  assert.equal(replies[0].content, "**Member**: Safe\\_User\nJoined: 2021-08-15\nBot account: No");
  assert.equal(Object.hasOwn(replies[0], "flags"), false);
});
test("/member reports unavailable join date without leaking or inventing member data", async () => {
  const replies = [], handler = make(async () => null, replies);
  await handler(event()); assert.match(replies[0].content, /Joined: not available/);
  assert.match(replies[0].content, /Bot account: No/);
});
test("/member rejects missing, mismatched, or cross-guild targets before fetching", async () => {
  let reads = 0; const handler = make(async () => { reads++; return null; });
  await assert.rejects(handler(event(interaction, "1565048205970767993")), /identity_mismatch/);
  await assert.rejects(handler(event({ ...interaction, data: { ...interaction.data, resolved: { users: {} } } })), /target_invalid/);
  await assert.rejects(handler(event({ ...interaction, application_id: "1565304619838742599" })), /interaction_invalid/);
  assert.equal(reads, 0);
});
