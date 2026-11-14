import test from "node:test";
import assert from "node:assert/strict";
import {
  createCoachingWorkflowClient,
  createCoachingWorkflowClientFromEnv
} from "./coaching-workflow-client.mjs";

const payload = {
  id: "interaction-123456789",
  application_id: "1565304619838742598",
  type: 3,
  data: { custom_id: "coach:request" },
  guild_id: "1565048205970767992",
  channel_id: "staff-channel",
  token: "fake-interaction-token",
  version: 1,
  user: { id: "discord-user" },
  member: { user: { id: "discord-user" }, roles: [], permissions: "0" },
  __acknowledged: true
};

function response(status = 200) {
  return { ok: status >= 200 && status < 300, status };
}

test("requires one public HTTPS /interaction endpoint", () => {
  for (const endpoint of [
    undefined,
    "",
    "not-a-url",
    "http://coaching.example.com/interaction",
    "https://coaching-workflow.railway.internal:3000/interaction",
    "https://coaching.railway.app/interaction",
    "https://127.0.0.1/interaction",
    "https://[::1]/interaction",
    "https://localhost./interaction",
    "https://coaching.local/interaction",
    "https://coaching.internal/interaction",
    "https://coaching.test/interaction",
    "https://coaching.invalid/interaction",
    "https://coaching.example/interaction",
    "https://singlelabel/interaction",
    "https://coaching.example.com/",
    "https://coaching.example.com/other",
    "https://user:pass@coaching.example.com/interaction",
    "https://coaching.example.com/interaction?debug=true",
    "https://coaching.example.com/interaction#fragment"
  ]) {
    assert.throws(
      () => createCoachingWorkflowClient({ endpoint }),
      /coaching_workflow_url_/
    );
  }
});

test("posts the original interaction payload once to the configured endpoint", async () => {
  let calls = 0;
  let captured;
  const client = createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    fetchFn: async (url, init) => {
      calls++;
      captured = { url: String(url), init, body: JSON.parse(init.body) };
      return response(202);
    }
  });

  const result = await client.forward(payload);
  assert.deepEqual(result, { ok: true, status: 202 });
  assert.equal(calls, 1);
  assert.equal(captured.url, "https://coaching.example.com/interaction");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["content-type"], "application/json");
  assert.equal(captured.init.headers["x-coaching-source"], "bot005");
  assert.match(captured.init.headers["x-coaching-timestamp"], /^[1-9][0-9]+$/);
  assert.match(captured.init.headers["x-coaching-signature"], /^[a-f0-9]{64}$/);
  assert.deepEqual(captured.body, payload);
  assert.ok(captured.init.signal instanceof AbortSignal);
});

test("uses the current global fetch at call time so the runtime ownership guard can intercept it", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const client = createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars"
  });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return response(200);
  };
  try {
    await client.forward(payload);
    assert.deepEqual(calls, [{
      url: "https://coaching.example.com/interaction",
      method: "POST"
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed on HTTP errors without retrying interaction submissions", async () => {
  let calls = 0;
  const client = createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    fetchFn: async () => {
      calls++;
      return response(503);
    }
  });
  await assert.rejects(
    () => client.forward(payload),
    /coaching_workflow_http_503/
  );
  assert.equal(calls, 1);
});

test("fails closed on network errors and bounded request timeouts", async () => {
  const unavailable = createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    fetchFn: async () => { throw new Error("network details must not leak"); }
  });
  await assert.rejects(
    () => unavailable.forward(payload),
    /coaching_workflow_unavailable/
  );

  const stalled = createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    timeoutMs: 500,
    fetchFn: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  });
  await assert.rejects(
    () => stalled.forward(payload),
    /coaching_workflow_timeout/
  );
});

test("rejects malformed and oversized payloads before making a network request", async () => {
  let calls = 0;
  const client = createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    maxPayloadBytes: 1024,
    fetchFn: async () => {
      calls++;
      return response(200);
    }
  });
  await assert.rejects(() => client.forward(null), /coaching_interaction_payload_invalid/);
  await assert.rejects(
    () => client.forward({ data: "x".repeat(2048) }),
    /coaching_interaction_payload_too_large/
  );
  assert.equal(calls, 0);
});

test("loads the endpoint from COACHING_WORKFLOW_URL without reading unrelated environment values", async () => {
  let captured = null;
  const client = createCoachingWorkflowClientFromEnv({
    env: { COACHING_WORKFLOW_URL: "https://coaching.example.com/interaction", COACHING_WORKFLOW_SOURCE: "bot005", COACHING_WORKFLOW_AUTH_SECRET: "local-test-auth-secret-at-least-thirty-two-chars" },
    fetchFn: async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return response(200);
    }
  });
  await client.forward(payload);
  assert.deepEqual(captured, {
    url: "https://coaching.example.com/interaction",
    body: payload
  });
});

test("validates timeout and payload limits", () => {
  assert.throws(() => createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    timeoutMs: 100
  }), /coaching_workflow_timeout_invalid/);
  assert.throws(() => createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    maxPayloadBytes: 10
  }), /coaching_workflow_payload_limit_invalid/);
});


test("checks workflow readiness without sending an interaction payload", async () => {
  const requests = [];
  const client = createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    fetchFn: async (url, init) => {
      requests.push({ url: String(url), method: init.method, body: init.body });
      return {
        ok: true,
        status: 200,
        async json() { return { ready: true }; }
      };
    }
  });
  const readiness = await client.checkReady();
  assert.deepEqual(readiness, { ok: true, status: 200, ready: true });
  assert.deepEqual(requests, [{
    url: "https://coaching.example.com/readyz",
    method: "GET",
    body: undefined
  }]);
});

test("readiness reports false when the service is healthy HTTP but application is not ready", async () => {
  const client = createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async json() { return { ready: false }; }
    })
  });
  assert.deepEqual(await client.checkReady(), { ok: true, status: 200, ready: false });
});

test("readiness fails closed on HTTP and network errors", async () => {
  const unavailable = createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    fetchFn: async () => { throw new Error("private network detail"); }
  });
  await assert.rejects(() => unavailable.checkReady(), /coaching_workflow_unavailable/);
  const failed = createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars",
    fetchFn: async () => ({
      ok: false,
      status: 503,
      async json() { return { ready: false }; }
    })
  });
  assert.deepEqual(await failed.checkReady(), { ok: false, status: 503, ready: false });
});


test("requires per-source authentication configuration before exposing the client", () => {
  assert.throws(() => createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction"
  }), /coaching_workflow_authentication_required/);
  assert.throws(() => createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "bot005",
    authSecret: "short"
  }), /coaching_workflow_authentication_required/);
  assert.throws(() => createCoachingWorkflowClient({
    endpoint: "https://coaching.example.com/interaction",
    authSource: "other-service",
    authSecret: "local-test-auth-secret-at-least-thirty-two-chars"
  }), /coaching_workflow_authentication_required/);
});
