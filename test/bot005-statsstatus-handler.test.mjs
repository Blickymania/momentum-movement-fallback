import test from "node:test";
import assert from "node:assert/strict";
import { createBot005StatsStatusHandler } from "../src/bot005-statsstatus-handler.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const CHANNEL = "1566030504635924600";
const interaction = {
  id: "1569000000000000052", application_id: APP, guild_id: GUILD,
  token: "non-production-statsstatus-token-long", type: 2,
  member: { user: { id: "1569000000000000002" } }, data: { name: "statsstatus" },
};
const event = (payload = interaction, guildId = GUILD) => ({ eventType: "INTERACTION_CREATE", guildId, payload });

test("reports verified display state and withholds unconfirmed totals", async () => {
  const reads = [], edits = [];
  const handler = createBot005StatsStatusHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => edits.push(reply),
    getStatsChannel: async (channelId) => { reads.push(channelId); return { id: CHANNEL, guild_id: GUILD, type: 2, name: "level-50s-online" }; },
    guildId: GUILD, applicationId: APP,
  });
  assert.deepEqual(await handler(event()), { committed: true, receiptId: "bot005-statsstatus-" + interaction.id });
  assert.deepEqual(reads, [CHANNEL]);
  assert.equal(edits[0].content, "**Momentum Movement — Verified Statistics**\nLIVE display: level-50s-online\nMember and role counts update through the independent Community Stats Sync.\nTikTok coin and diamond totals are withheld until creator-confirmed values are available.");
  assert.equal(Object.hasOwn(edits[0], "flags"), false);
  assert.equal(edits[0].content.includes("Total:"), false);
  assert.equal(edits[0].content.includes("coins:"), false);
  assert.equal(edits[0].content.includes("diamonds:"), false);
});

test("fails closed for wrong channel ID, guild, type, or unavailable response", async () => {
  const edits = [];
  const handlerFor = getStatsChannel => createBot005StatsStatusHandler({
    revealInteraction: async payload => payload, editDeferredReply: async reply => edits.push(reply),
    getStatsChannel, guildId: GUILD, applicationId: APP,
  });
  for (const value of [
    { id: "1566030504635924601", guild_id: GUILD, type: 2, name: "wrong" },
    { id: CHANNEL, guild_id: "1565048205970767993", type: 2, name: "wrong" },
    { id: CHANNEL, guild_id: GUILD, type: 0, name: "wrong" },
  ]) {
    await handlerFor(async () => value)(event());
    assert.equal(edits.at(-1).content, "The verified statistics display is temporarily unavailable. No values were invented.");
  }
  await handlerFor(async () => { throw new Error("Discord read failed"); })(event());
  assert.equal(edits.at(-1).content, "The verified statistics display is temporarily unavailable. No values were invented.");
});

test("rejects cross-guild commands before channel lookup", async () => {
  let reads = 0;
  const handler = createBot005StatsStatusHandler({
    revealInteraction: async payload => payload, editDeferredReply: async () => {},
    getStatsChannel: async () => { reads += 1; return null; }, guildId: GUILD, applicationId: APP,
  });
  await assert.rejects(() => handler(event(interaction, "1565048205970767993")), /event_identity_mismatch/);
  assert.equal(reads, 0);
});
