import test from "node:test";
import assert from "node:assert/strict";
import { createBot005StatusHandler } from "../src/bot005-status-handler.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const ID = "1569000000000000031";
const interaction = {
  id: ID, type: 2, guild_id: GUILD, application_id: APP,
  token: "test-status-interaction-token-long",
  member: { user: { id: "1569000000000000002" } },
  data: { name: "bot-status" },
};
const event = {
  eventType: "INTERACTION_CREATE",
  guildId: GUILD,
  payload: interaction,
};

test("reports the candidate Gateway state without claiming feature parity", async () => {
  const edits = [];
  const handler = createBot005StatusHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => edits.push(reply),
    getStatus: async () => ({ clients: [{ guildId: GUILD, applicationId: APP, status: "connected" }] }),
    guildId: GUILD,
    applicationId: APP,
  });
  assert.deepEqual(await handler(event), { committed: true, receiptId: "bot005-status-" + ID });
  assert.equal(edits[0].content,
    "Momentum Movement migration candidate Gateway state: connected. This reports connection state only; Bot 005 feature parity is not verified.");
});

test("uses an unavailable state and rejects mismatched interactions", async () => {
  let edits = 0;
  const handler = createBot005StatusHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async () => { edits += 1; },
    getStatus: async () => ({ clients: [] }),
    guildId: GUILD,
    applicationId: APP,
  });
  await handler(event);
  assert.equal(edits, 1);
  await assert.rejects(() => handler({ ...event, payload: { ...interaction, application_id: "1565304619838742599" } }), /interaction_invalid/);
  assert.equal(edits, 1);
});
