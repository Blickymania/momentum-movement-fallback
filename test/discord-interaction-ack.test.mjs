import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordInteractionAcknowledger } from "../src/discord-interaction-ack.mjs";

const ID = "1569000000000000001";
const TOKEN = "test-interaction-token-never-log-this";
const response = (value, status = 204) => new Response(value, { status });

test("sends a handler-selected deferred reply without logging or returning its token", async () => {
  const calls = [];
  const ack = createDiscordInteractionAcknowledger({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(null);
    },
  });
  const result = await ack({ interactionId: ID, token: TOKEN, response: { type: 5 } });
  assert.equal(result.acknowledged, true);
  assert.equal(result.responseType, 5);
  assert.equal(result.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), { type: 5 });
  assert.match(calls[0].url, /\/callback$/);
  assert.ok(calls[0].url.includes(encodeURIComponent(TOKEN)));
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test("supports handler-selected component update and modal response plans", async () => {
  const plans = [{ type: 6 }, { type: 9, data: { custom_id: "membercard:edit", title: "Profile", components: [] } }];
  const sent = [];
  const ack = createDiscordInteractionAcknowledger({
    fetchImpl: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return response(null);
    },
  });
  for (const plan of plans) await ack({ interactionId: ID, token: TOKEN, response: plan });
  assert.deepEqual(sent, plans);
});

test("rejects invalid identities and unsafe response plans before network access", async () => {
  let calls = 0;
  const ack = createDiscordInteractionAcknowledger({
    fetchImpl: async () => { calls += 1; return response(null); },
  });
  await assert.rejects(() => ack({ interactionId: "bad", token: TOKEN, response: { type: 5 } }), /snowflake/);
  await assert.rejects(() => ack({ interactionId: ID, token: "short", response: { type: 5 } }), /token/);
  await assert.rejects(() => ack({ interactionId: ID, token: TOKEN, response: { type: 42 } }), /plan/);
  await assert.rejects(() => ack({ interactionId: ID, token: TOKEN, response: { type: 9 } }), /plan/);
  assert.equal(calls, 0);
});

test("uses a bounded acknowledgement timeout and does not retry transport failures", async () => {
  let timeout;
  let calls = 0;
  const ack = createDiscordInteractionAcknowledger({
    timeoutMs: 2_100,
    timeoutSignal: (ms) => { timeout = ms; return { marker: "signal" }; },
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.deepEqual(options.signal, { marker: "signal" });
      throw new Error("transport error containing " + TOKEN);
    },
  });
  await assert.rejects(() => ack({ interactionId: ID, token: TOKEN, response: { type: 5 } }), (error) => {
    assert.equal(error.code, "discord_interaction_ack_transport_failed");
    assert.equal(error.message.includes(TOKEN), false);
    return true;
  });
  assert.equal(timeout, 2_100);
  assert.equal(calls, 1);
});

test("classifies rate-limit and Discord service failures without exposing response bodies", async () => {
  for (const [status, code] of [[429, "discord_interaction_ack_rate_limited"], [503, "discord_interaction_ack_service_error"], [400, "discord_interaction_ack_rejected"]]) {
    const ack = createDiscordInteractionAcknowledger({
      fetchImpl: async () => new Response("private body " + TOKEN, { status }),
    });
    await assert.rejects(() => ack({ interactionId: ID, token: TOKEN, response: { type: 5 } }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });
  }
});

test("rejects an acknowledgement deadline above 2.5 seconds", () => {
  assert.throws(() => createDiscordInteractionAcknowledger({ timeoutMs: 2_501 }), /configuration/);
});
