import test from "node:test";
import assert from "node:assert/strict";
import { createBot005RulesHandler } from "../src/bot005-rules-handler.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const interaction = {
  id: "1569000000000000042", application_id: APP, guild_id: GUILD,
  token: "non-production-rules-token-long", type: 2,
  member: { user: { id: "1569000000000000002" } }, data: { name: "rules" },
};
const event = (payload = interaction, guildId = GUILD) => ({ eventType: "INTERACTION_CREATE", guildId, payload });

test("finds a rules text channel only inside the authorized guild and sends a public no-ping reply", async () => {
  const edits = [], reads = [];
  const handler = createBot005RulesHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => edits.push(reply),
    getGuildChannels: async (guildId) => {
      reads.push(guildId);
      return [
        { id: "1567000000000000001", guild_id: GUILD, type: 2, name: "rules-voice" },
        { id: "1567000000000000002", guild_id: "1565048205970767993", type: 0, name: "rules-foreign" },
        { id: "1567000000000000003", guild_id: GUILD, type: 0, name: "community-guidelines" },
      ];
    },
    guildId: GUILD, applicationId: APP,
  });
  assert.deepEqual(await handler(event()), { committed: true, receiptId: "bot005-rules-" + interaction.id });
  assert.deepEqual(reads, [GUILD]);
  assert.deepEqual(edits, [{ applicationId: APP, token: interaction.token, content: "Community rules: <#1567000000000000003>" }]);
  assert.equal(Object.hasOwn(edits[0], "flags"), false);
});

test("reports missing or unavailable rules channels without writing to Discord", async () => {
  const edits = [];
  const handler = createBot005RulesHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => edits.push(reply),
    getGuildChannels: async () => [], guildId: GUILD, applicationId: APP,
  });
  await handler(event());
  assert.equal(edits[0].content, "The rules channel was not found automatically. No channel was created.");
  const unavailable = createBot005RulesHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => edits.push(reply),
    getGuildChannels: async () => { throw new Error("Discord read failed"); },
    guildId: GUILD, applicationId: APP,
  });
  await unavailable(event());
  assert.equal(edits[1].content, "The rules channel could not be checked right now. No channels were changed.");
});

test("rejects cross-guild events and mismatched command identity before reading channels", async () => {
  let reads = 0;
  const handler = createBot005RulesHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async () => {},
    getGuildChannels: async () => { reads += 1; return []; },
    guildId: GUILD, applicationId: APP,
  });
  await assert.rejects(() => handler(event(interaction, "1565048205970767993")), /event_identity_mismatch/);
  await assert.rejects(() => handler(event({ ...interaction, data: { name: "ban" } })), /interaction_invalid/);
  assert.equal(reads, 0);
});
