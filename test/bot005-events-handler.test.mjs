import test from "node:test";
import assert from "node:assert/strict";
import { createBot005EventsHandler } from "../src/bot005-events-handler.mjs";
const GUILD = "1565048205970767992", APP = "1565304619838742598";
const interaction = { id: "1569000000000000061", application_id: APP, guild_id: GUILD,
  token: "non-production-events-interaction-token", type: 2,
  member: { user: { id: "1569000000000000002" } }, data: { name: "events" } };
const event = (payload = interaction, guildId = GUILD) => ({ eventType: "INTERACTION_CREATE", guildId, payload });

test("/events filters to authorized scheduled or active guild events and bounds safe output", async () => {
  const replies = [], reads = [], future = Date.UTC(2027, 0, 1);
  const handler = createBot005EventsHandler({
    revealInteraction: async (payload) => payload, editDeferredReply: async (reply) => replies.push(reply),
    getScheduledEvents: async (guildId) => { reads.push(guildId); return [
      { guild_id: GUILD, status: 1, name: "Future **LIVE** @everyone", scheduled_start_time: new Date(future).toISOString() },
      { guild_id: GUILD, status: 2, name: "Active", scheduled_start_time: new Date(future - 1000).toISOString() },
      { guild_id: GUILD, status: 3, name: "Completed", scheduled_start_time: new Date(future - 2000).toISOString() },
      { guild_id: "1565048205970767993", status: 1, name: "Foreign", scheduled_start_time: new Date(future).toISOString() },
      ...Array.from({ length: 10 }, (_, index) => ({ guild_id: GUILD, status: 1, name: "Event " + index, scheduled_start_time: new Date(future + 1000 + index).toISOString() })),
    ] }, guildId: GUILD, applicationId: APP,
  });
  assert.deepEqual(await handler(event()), { committed: true, receiptId: "bot005-events-" + interaction.id });
  assert.deepEqual(reads, [GUILD]); assert.equal(replies.length, 1);
  assert.equal(replies[0].content.split("\n").length, 9);
  assert.match(replies[0].content, /Active —/);
  assert.ok(replies[0].content.includes(String.fromCharCode(92) + "**LIVE**"));
  assert.ok(replies[0].content.includes("@" + String.fromCharCode(8203) + "everyone"));
  assert.doesNotMatch(replies[0].content, /Completed|Foreign|Event 9/);
  assert.equal(Object.hasOwn(replies[0], "flags"), false);
});

test("/events gives bounded empty and unavailable responses", async () => {
  const replies = [];
  const create = (getScheduledEvents) => createBot005EventsHandler({
    revealInteraction: async (payload) => payload, editDeferredReply: async (reply) => replies.push(reply),
    getScheduledEvents, guildId: GUILD, applicationId: APP,
  });
  await create(async () => { throw Error("unavailable"); })(event());
  assert.match(replies[0].content, /could not be retrieved/);
  await create(async () => [])(event());
  assert.equal(replies[1].content, "No scheduled server events were returned.");
});

test("/events rejects guild and interaction mismatches before fetching", async () => {
  let reads = 0;
  const handler = createBot005EventsHandler({ revealInteraction: async (payload) => payload,
    editDeferredReply: async () => {}, getScheduledEvents: async () => { reads++; return []; },
    guildId: GUILD, applicationId: APP });
  await assert.rejects(handler(event(interaction, "1565048205970767993")), /identity_mismatch/);
  await assert.rejects(handler(event({ ...interaction, application_id: "1565304619838742599" })), /interaction_invalid/);
  assert.equal(reads, 0);
});
