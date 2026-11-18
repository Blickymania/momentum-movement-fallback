import test from "node:test";
import assert from "node:assert/strict";
import { createBot005PingHandler } from "../src/bot005-ping-handler.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const USER = "1569000000000000002";
const ID = "1569000000000000021";

function event(overrides = {}) {
  return {
    eventType: "INTERACTION_CREATE",
    guildId: GUILD,
    payload: {
      id: ID, type: 2, guild_id: GUILD, application_id: APP,
      token: "test-interaction-token-long-enough",
      member: { user: { id: USER } },
      data: { name: "ping" },
    },
    ...overrides,
  };
}

test("responds to the verified read-only ping with a public, no-mention reply", async () => {
  const edits = [];
  const handler = createBot005PingHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async (reply) => edits.push(reply),
    guildId: GUILD,
    applicationId: APP,
  });
  const result = await handler(event());
  assert.deepEqual(result, { committed: true, receiptId: "bot005-ping-" + ID });
  assert.deepEqual(edits, [{
    applicationId: APP,
    token: "test-interaction-token-long-enough",
    content: "Pong.",
  }]);
});

test("rejects other commands and mismatched guilds before editing a reply", async () => {
  let calls = 0;
  const handler = createBot005PingHandler({
    revealInteraction: async (payload) => payload,
    editDeferredReply: async () => { calls += 1; },
    guildId: GUILD,
    applicationId: APP,
  });
  await assert.rejects(() => handler(event({
    payload: { ...event().payload, data: { name: "ban" } },
  })), /interaction_invalid/);
  await assert.rejects(() => handler(event({ guildId: "1565048205970767993" })), /event_identity_mismatch/);
  assert.equal(calls, 0);
});
