import test from "node:test";
import assert from "node:assert/strict";
import { createBot005TikTokHandler } from "../src/bot005-tiktok-handler.mjs";
const GUILD = "1565048205970767992", APP = "1565304619838742598";
const interaction = { id: "1569000000000000065", application_id: APP, guild_id: GUILD,
  token: "non-production-tiktok-interaction-token", type: 2, data: { name: "tiktok" } };
const event = (payload = interaction, guildId = GUILD) => ({ eventType: "INTERACTION_CREATE", guildId, payload });
function make(configuredUrl, replies = []) { return createBot005TikTokHandler({ revealInteraction: async (payload) => payload,
  editDeferredReply: async (reply) => replies.push(reply), configuredUrl, guildId: GUILD, applicationId: APP }); }
test("/tiktok returns only a validated official HTTPS profile URL", async () => {
  const replies = [], handler = make("https://www.tiktok.com/@Momentum_Movement?lang=en", replies);
  assert.deepEqual(await handler(event()), { committed: true, receiptId: "bot005-tiktok-" + interaction.id });
  assert.equal(replies[0].content, "Official TikTok profile: https://www.tiktok.com/@Momentum_Movement");
  assert.equal(Object.hasOwn(replies[0], "flags"), false);
});
test("/tiktok reports unconfigured or unsafe URLs without exposing them", async () => {
  for (const value of ["", "http://www.tiktok.com/@test", "https://tiktok.com.evil.test/@test",
    "https://user:pass@tiktok.com/@test", "https://tiktok.com/@test/extra", "https://tiktok.com/@test#frag"]) {
    const replies = []; await make(value, replies)(event());
    assert.equal(replies[0].content, "Official TikTok URL is not configured for Momentum Movement.");
    assert.doesNotMatch(replies[0].content, /evil|user:pass|frag/);
  }
});
test("/tiktok rejects cross-guild or mismatched application interactions", async () => {
  const handler = make("");
  await assert.rejects(handler(event(interaction, "1565048205970767993")), /identity_mismatch/);
  await assert.rejects(handler(event({ ...interaction, application_id: "1565304619838742599" })), /interaction_invalid/);
});
