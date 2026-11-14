import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker.mjs";

const apiToken = "northflank-worker-test-api-token-123456";
const fenceToken = "standby-deployment-fence-token-123456";
const previousService = "bot005-primary";
const candidateService = "bot005-standby";

function makeNamespace({ active = false, allowConfirm = true } = {}) {
  const calls = [];
  const lease = {
    lease_scope: "momentum-movement:bot-005-gateway",
    owner_id: "primary-deploy:primary-owner",
    fencing_epoch: "3",
    deployment_id: "primary-deploy",
    lease_active: active ? 1 : 0
  };
  return {
    calls,
    idFromName(name) { return "id:" + name; },
    get(id) {
      assert.equal(id, "id:momentum-movement:bot-005-gateway");
      return {
        async fetch(request) {
          const url = new URL(request.url);
          calls.push({ path: url.pathname, method: request.method });
          if (url.pathname === "/lease/state") {
            return Response.json({ ok: true, lease });
          }
          if (url.pathname === "/lease/fence/confirm") {
            const body = await request.json();
            if (!allowConfirm) return Response.json({ ok: false, reason: "lease_fence_not_confirmed" }, { status: 409 });
            return Response.json({ ok: true, lease: {
              ...lease,
              fenced_owner_id: body.expectedOwnerId,
              fenced_epoch: body.expectedFencingEpoch,
              fence_target_owner_id: body.candidateOwnerId,
              fence_target_deployment_id: body.candidateDeploymentId,
              fence_provider: body.provider,
              fence_proof_id: body.proofId
            }});
          }
          return Response.json({ error: "not_found" }, { status: 404 });
        }
      };
    }
  };
}

function makeNorthflankFetch({ pauseStatus = 200, neverStop = false } = {}) {
  const calls = [];
  let primaryStopped = false;
  return {
    calls,
    async fetch(url, init) {
      const parsed = new URL(String(url));
      calls.push({ method: init.method, path: parsed.pathname, authorization: init.headers.authorization });
      assert.equal(init.headers.authorization, "Bearer " + apiToken);
      const serviceId = parsed.pathname.split("/").filter(Boolean).at(-2);
      if (init.method === "GET" && parsed.pathname.endsWith("/health")) {
        const stopped = serviceId === previousService && primaryStopped && !neverStop;
        const candidate = serviceId === candidateService;
        if (![previousService, candidateService].includes(serviceId)) {
          return Response.json({ message: "not found" }, { status: 404 });
        }
        return Response.json({ data: { current: {
          hasMore: false,
          containers: [{
            name: serviceId + "-container",
            status: stopped ? "TASK_KILLED" : "TASK_RUNNING",
            terminated: stopped
          }]
        }}});
      }
      if (init.method === "POST" && parsed.pathname.endsWith("/pause")) {
        if (pauseStatus !== 200) return Response.json({ message: "pause rejected" }, { status: pauseStatus });
        primaryStopped = true;
        return Response.json({ data: { paused: true } }, { status: 200 });
      }
      return Response.json({ message: "unexpected request" }, { status: 404 });
    }
  };
}

function fenceRequest(body = {
  candidateOwnerId: "standby-deploy:standby-owner",
  candidateDeploymentId: "standby-deploy"
}, token = fenceToken) {
  return new Request("https://control.example.com/fence", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function env(namespace, overrides = {}) {
  return {
    FENCE_PROVIDER: "northflank",
    FENCE_REQUEST_TOKENS_JSON: JSON.stringify({ "standby-deploy": fenceToken }),
    NORTHFLANK_API_TOKEN: apiToken,
    NORTHFLANK_PROJECT_ID: "momentum-failover",
    NORTHFLANK_SERVICE_IDS_JSON: JSON.stringify({
      "primary-deploy": previousService,
      "standby-deploy": candidateService
    }),
    GATEWAY_LEASE_COORDINATOR: namespace,
    ...overrides
  };
}

test("Worker routes Bot 005 fencing through Northflank and confirms only after containers stop", async () => {
  const originalFetch = globalThis.fetch;
  const northflank = makeNorthflankFetch();
  const namespace = makeNamespace();
  globalThis.fetch = northflank.fetch;
  try {
    const response = await worker.fetch(fenceRequest(), env(namespace));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.fenced, true);
    assert.equal(body.previousServiceId, previousService);
    assert.equal(body.candidateServiceId, candidateService);
    assert.equal(body.stopProof.state, "paused");
    assert.equal(body.stopProof.alreadyStopped, false);
    assert.equal(body.stopProof.remainingRunningContainers, 0);
    assert.equal(body.fenceConfirmation.provider, "northflank-service-paused");
    assert.match(body.fenceConfirmation.proofId, /^northflank-pause-v1:[a-f0-9]{64}$/);
    assert.deepEqual(northflank.calls.filter(call => call.method === "POST").map(call => call.path), [
      "/v1/projects/momentum-failover/services/bot005-primary/pause"
    ]);
    assert.deepEqual(namespace.calls.map(call => call.path), ["/lease/state", "/lease/fence/confirm"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker refuses fencing when Northflank rejects pause", async () => {
  const originalFetch = globalThis.fetch;
  const northflank = makeNorthflankFetch({ pauseStatus: 500 });
  const namespace = makeNamespace();
  globalThis.fetch = northflank.fetch;
  try {
    const response = await worker.fetch(fenceRequest(), env(namespace));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, "northflank_api_http_500");
    assert.deepEqual(namespace.calls.map(call => call.path), ["/lease/state"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker requires the matching deployment-specific fence token before provider access", async () => {
  const originalFetch = globalThis.fetch;
  const northflank = makeNorthflankFetch();
  const namespace = makeNamespace();
  globalThis.fetch = northflank.fetch;
  try {
    const response = await worker.fetch(fenceRequest(undefined, "wrong-token"), env(namespace));
    assert.equal(response.status, 401);
    assert.equal(northflank.calls.length, 0);
    assert.equal(namespace.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker refuses unknown providers and missing Northflank configuration without fallback", async () => {
  const originalFetch = globalThis.fetch;
  const northflank = makeNorthflankFetch();
  const namespace = makeNamespace();
  globalThis.fetch = northflank.fetch;
  try {
    const unknown = await worker.fetch(fenceRequest(), env(namespace, { FENCE_PROVIDER: "unknown" }));
    assert.equal(unknown.status, 503);
    assert.equal((await unknown.json()).error, "fence_provider_invalid");
    const missing = await worker.fetch(fenceRequest(), env(namespace, { NORTHFLANK_API_TOKEN: "" }));
    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).error, "northflank_fencer_not_configured");
    assert.equal(northflank.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
