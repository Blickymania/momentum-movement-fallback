import test from "node:test";
import assert from "node:assert/strict";
import { createBot005ServerHandler } from "../src/bot005-server-handler.mjs";
const GUILD = "1565048205970767992", APP = "1565304619838742598";
const interaction = { id: "1569000000000000063", application_id: APP, guild_id: GUILD,
  token: "non-production-server-interaction-token", type: 2, data: { name: "server" } };
const event = (payload = interaction, guildId = GUILD) => ({ eventType: "INTERACTION_CREATE", guildId, payload });
function make(getGuildSummary, replies = []) { return createBot005ServerHandler({
  revealInteraction: async (payload) => payload, editDeferredReply: async (reply) => replies.push(reply),
  getGuildSummary, guildId: GUILD, applicationId: APP,
}); }
test("/server and /dashboard use the verified guild and label member count approximate", async () => {
  const reads = [], replies = [];
  const handler = make(async (guildId) => { reads.push(guildId); return { id: GUILD, approximate_member_count: 1234 }; }, replies);
  for (const name of ["server", "dashboard"]) await handler(event({ ...interaction, data: { name } }));
  assert.deepEqual(reads, [GUILD, GUILD]);
  assert.match(replies[0].content, /Approx\. members: ~1,234/);
  assert.match(replies[0].content, /Guild identity: verified/);
  assert.equal(Object.hasOwn(replies[0], "flags"), false);
});
test("/server hides missing, malformed, or foreign guild counts", async () => {
  const replies = [], results = [{ id: "1565048205970767993", approximate_member_count: 50 }, { id: GUILD, approximate_member_count: -3 }];
  const handler = make(async () => results.shift(), replies);
  await handler(event()); await handler(event());
  assert.match(replies[0].content, /Approx\. members: unavailable/);
  assert.match(replies[1].content, /Approx\. members: unavailable/);
});
test("/server reports a failed summary as unavailable and rejects cross-guild interactions", async () => {
  const replies = []; let reads = 0; const handler = make(async () => { reads++; throw Error("API down"); }, replies);
  await handler(event()); assert.match(replies[0].content, /Approx\. members: unavailable/);
  await assert.rejects(handler(event(interaction, "1565048205970767993")), /identity_mismatch/);
  assert.equal(reads, 1);
});
