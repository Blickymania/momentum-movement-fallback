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
  assert.deepEqual(result, { updated: true, status: 200 });
  assert.equal(request.url, "https://discord.com/api/v10/webhooks/" + APP +
    "/" + encodeURIComponent(TOKEN) + "/messages/@original");
  assert.equal(request.options.method, "PATCH");
  assert.deepEqual(JSON.parse(request.options.body), {
    content: "Saved.",
    allowed_mentions: { parse: [] },
  });
  assert.equal(request.options.signal.timeoutMs, 5000);
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
