import test from "node:test";
import assert from "node:assert/strict";
import { createBot005HelpHandler } from "../src/bot005-help-handler.mjs";
const GUILD = "1565048205970767992", APP = "1565304619838742598";
const interaction = { id: "1569000000000000064", application_id: APP, guild_id: GUILD,
  token: "non-production-help-interaction-token", type: 2, data: { name: "help" } };
const event = (payload = interaction, guildId = GUILD) => ({ eventType: "INTERACTION_CREATE", guildId, payload });
test("/help lists only coded command names and clearly states disabled candidate and Railway production status", async () => {
  const replies = [];
  const handler = createBot005HelpHandler({ revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => replies.push(reply), guildId: GUILD, applicationId: APP });
  assert.deepEqual(await handler(event()), { committed: true, receiptId: "bot005-help-" + interaction.id });
  assert.match(replies[0].content, /Coded slash-command names: .*\/help/);
  assert.match(replies[0].content, /forum-admin diagnose and inspect/);
  assert.match(replies[0].content, /other 24 of the 36/);
  assert.match(replies[0].content, /All candidate feature flags are off/);
  assert.match(replies[0].content, /Production remains on Railway/);
  assert.equal(Object.hasOwn(replies[0], "flags"), false);
});
test("/help rejects cross-guild or mismatched application interactions", async () => {
  const handler = createBot005HelpHandler({ revealInteraction: async (payload) => payload,
    editDeferredReply: async () => {}, guildId: GUILD, applicationId: APP });
  await assert.rejects(handler(event(interaction, "1565048205970767993")), /identity_mismatch/);
  await assert.rejects(handler(event({ ...interaction, application_id: "1565304619838742599" })), /interaction_invalid/);
});
