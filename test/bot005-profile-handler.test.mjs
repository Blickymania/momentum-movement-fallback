import test from "node:test";
import assert from "node:assert/strict";
import { createBot005ProfileModalHandler, SAVED_MESSAGE } from "../src/bot005-profile-handler.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const USER = "1569000000000000002";
const INTERACTION = "1569000000000000001";

function interaction(overrides = {}) {
  return {
    id: INTERACTION,
    type: 5,
    guild_id: GUILD,
    application_id: APP,
    token: "test-interaction-token-123456",
    member: { user: { id: USER } },
    data: {
      custom_id: "memberdata:profile",
      components: [{
        type: 1,
        components: [{ type: 4, custom_id: "visibility", value: "private" }],
      }],
    },
    ...overrides,
  };
}

function event(payload, overrides = {}) {
  return {
    eventType: "INTERACTION_CREATE",
    guildId: GUILD,
    payload: { ...payload, application_id: APP },
    ...overrides,
  };
}

test("persists profile modal before idempotent deferred reply edit", async () => {
  const order = [];
  let savedSubmission;
  let edited;
  const handle = createBot005ProfileModalHandler({
    store: {
      async apply(submission) {
        order.push("store");
        savedSubmission = submission;
        return { committed: true, receiptId: "bot005-profile-" + submission.interactionId };
      },
    },
    revealInteraction: async () => interaction(),
    editDeferredReply: async (input) => {
      order.push("reply");
      edited = input;
      return { updated: true, status: 200 };
    },
    guildId: GUILD,
    applicationId: APP,
  });
  const result = await handle(event({ id: INTERACTION }));
  assert.deepEqual(order, ["store", "reply"]);
  assert.equal(savedSubmission.kind, "profile");
  assert.equal(result.committed, true);
  assert.deepEqual(edited, {
    applicationId: APP,
    token: "test-interaction-token-123456",
    content: SAVED_MESSAGE,
  });
});

test("retry after reply edit failure reuses the durable interaction receipt", async () => {
  let applyCalls = 0;
  let editCalls = 0;
  const handle = createBot005ProfileModalHandler({
    store: {
      async apply(submission) {
        applyCalls += 1;
        return { committed: true, duplicate: applyCalls > 1, receiptId: "receipt-" + submission.interactionId };
      },
    },
    revealInteraction: async () => interaction(),
    editDeferredReply: async () => {
      editCalls += 1;
      if (editCalls === 1) throw new Error("temporary reply edit failure");
      return { updated: true, status: 200 };
    },
    guildId: GUILD,
    applicationId: APP,
  });
  await assert.rejects(() => handle(event({ id: INTERACTION })), /temporary reply edit failure/);
  const retried = await handle(event({ id: INTERACTION }));
  assert.deepEqual(retried, { committed: true, receiptId: "receipt-" + INTERACTION });
  assert.equal(applyCalls, 2);
  assert.equal(editCalls, 2);
});

test("rejects mismatched guild/application and malformed modal without writes", async () => {
  let writes = 0;
  const handle = createBot005ProfileModalHandler({
    store: { async apply() { writes += 1; return { committed: true, receiptId: "r" }; } },
    revealInteraction: async (payload) => payload,
    editDeferredReply: async () => ({ updated: true }),
    guildId: GUILD,
    applicationId: APP,
  });
  await assert.rejects(() => handle(event({}, { guildId: "1565048205970767993" })), /identity_mismatch/);
  await assert.rejects(() => handle(event({ application_id: "1565304619838742599" })), /identity_mismatch/);
  await assert.rejects(() => handle(event({
    ...interaction(),
    data: { custom_id: "memberdata:unknown", components: [] },
  })), /selector_unhandled/);
  assert.equal(writes, 0);
});

test("handler refuses missing durable receipt", async () => {
  const handle = createBot005ProfileModalHandler({
    store: { async apply() { return { committed: false }; } },
    revealInteraction: async () => interaction(),
    editDeferredReply: async () => assert.fail("reply must not edit before durable receipt"),
    guildId: GUILD,
    applicationId: APP,
  });
  await assert.rejects(() => handle(event({ id: INTERACTION })), /receipt_missing/);
});
