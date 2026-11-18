import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordDeferredReplyEditor } from "../src/discord-deferred-reply.mjs";

const APP = "1565304619838742598";
const TOKEN = "abcde-interaction-token-123456";

test("PATCHes the deferred original reply with mention parsing disabled", async () => {
  let request;
  const edit = createDiscordDeferredReplyEditor({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
    timeoutSignal: (ms) => ({ timeoutMs: ms }),
  });
  const result = await edit({ applicationId: APP, token: TOKEN, content: "Saved." });
  assert.deepEqual(result, { updated: true, status: 200, messageId: null });
  assert.equal(request.url, "https://discord.com/api/v10/webhooks/" + APP +
    "/" + encodeURIComponent(TOKEN) + "/messages/@original");
  assert.equal(request.options.method, "PATCH");
  assert.deepEqual(JSON.parse(request.options.body), {
    content: "Saved.",
    allowed_mentions: { parse: [] },
  });
  assert.equal(request.options.signal.timeoutMs, 5000);
});

test("accepts only paired forum confirmation buttons and returns the resulting message ID", async () => {
  const messageId = "1566060000000000000";
  const components = [{ type: 1, components: [
    { type: 2, style: 3, label: "Confirm", custom_id: "mm005:forum-confirm:confirm:confirmation_nonce_0001" },
    { type: 2, style: 4, label: "Cancel", custom_id: "mm005:forum-confirm:cancel:confirmation_nonce_0001" },
  ] }];
  const edit = createDiscordDeferredReplyEditor({
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body).components, components);
      return { ok: true, status: 200, json: async () => ({ id: messageId }) };
    }, timeoutSignal: () => ({}),
  });
  const result = await edit({ applicationId: APP, token: TOKEN, content: "Confirm?", components });
  assert.equal(result.messageId, messageId);
  await assert.rejects(() => edit({ applicationId: APP, token: TOKEN, content: "Bad", components: [{ type: 1, components: [] }] }), /invalid/);
});

test("can clear confirmation components when editing a deferred component response", async () => {
  let body;
  const edit = createDiscordDeferredReplyEditor({ fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, status: 200 }; }, timeoutSignal: () => ({}) });
  await edit({ applicationId: APP, token: TOKEN, content: "Done.", components: [] });
  assert.deepEqual(body.components, []);
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  await assert.rejects(() => edit({ applicationId: APP, token: TOKEN, content: "Done.", components: [{ type: 1 }] }), /invalid/);
});

test("rejects invalid endpoint data before network and never retries rejected requests", async () => {
  let calls = 0;
  const edit = createDiscordDeferredReplyEditor({
    fetchImpl: async () => { calls += 1; return { ok: false, status: 429 }; },
    timeoutSignal: () => ({}),
  });
  await assert.rejects(() => edit({ applicationId: "bad", token: TOKEN, content: "Saved." }), /invalid/);
  await assert.rejects(() => edit({ applicationId: APP, token: "bad", content: "Saved." }), /invalid/);
  await assert.rejects(() => edit({ applicationId: APP, token: TOKEN, content: "x".repeat(2001) }), /invalid/);
  await assert.rejects(() => edit({ applicationId: APP, token: TOKEN, content: "Saved." }), /rate_limited/);
  assert.equal(calls, 1);
});
