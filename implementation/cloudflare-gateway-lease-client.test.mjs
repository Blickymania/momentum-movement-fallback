import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { GatewayLeaseCoordinator, GATEWAY_LEASE_SCOPE } from "../cloudflare/gateway-lease-coordinator.mjs";
import { startGatewayOwner } from "./gateway-owner-supervisor.mjs";
import worker from "../cloudflare/worker.mjs";
import { createCloudflareGatewayLeaseStore } from "./cloudflare-gateway-lease-client.mjs";
import { createCloudflareFenceRequester, createRemoteFencedCloudflareLeaseStore } from "./cloudflare-fence-request-client.mjs";

const token = "x".repeat(48);
const bootstrapToken = "b".repeat(48);
const fenceRequestToken = "r".repeat(48);
const lease = {
  lease_scope: "momentum-movement:discord-gateway",
  owner_id: "instance-1",
  fencing_epoch: "7",
  deployment_id: "deploy-1"
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("lease client only accepts public HTTPS coordinator URLs", () => {
  assert.throws(() => createCloudflareGatewayLeaseStore({
    baseUrl: "http://lease.example.com",
    serviceToken: token
  }), /public_https/);
  assert.throws(() => createCloudflareGatewayLeaseStore({
    baseUrl: "https://bot.railway.internal",
    serviceToken: token
  }), /public_https/);
  assert.throws(() => createCloudflareGatewayLeaseStore({
    baseUrl: "https://127.0.0.1",
    serviceToken: token
  }), /public_https/);
  assert.throws(() => createCloudflareGatewayLeaseStore({
    baseUrl: "https://localhost./",
    serviceToken: token
  }), /public_https/);
  assert.throws(() => createCloudflareGatewayLeaseStore({
    baseUrl: "https://lease.example.com",
    serviceToken: "too-short"
  }), /token_invalid/);
});

test("lease client sends authenticated JSON and returns the Cloudflare lease", async () => {
  let captured;
  const store = createCloudflareGatewayLeaseStore({
    baseUrl: "https://lease.example.com/control/",
    serviceToken: token,
    fetchFn: async (url, init) => {
      captured = { url: String(url), init };
      return jsonResponse({ ok: true, lease });
    }
  });
  const result = await store.acquire({
    scope: lease.lease_scope,
    ownerId: lease.owner_id,
    deploymentId: lease.deployment_id,
    ttlSeconds: 30
  });
  assert.deepEqual(result, lease);
  assert.equal(captured.url, "https://lease.example.com/control/lease/acquire");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.authorization, "Bearer " + token);
  assert.equal(JSON.parse(captured.init.body).ownerId, "instance-1");
  assert.ok(captured.init.signal instanceof AbortSignal);
});

test("lease client maps conflict to null and fails closed on server errors", async () => {
  const conflict = createCloudflareGatewayLeaseStore({
    baseUrl: "https://lease.example.com",
    serviceToken: token,
    fetchFn: async () => jsonResponse({ ok: false, reason: "lease_unavailable" }, 409)
  });
  assert.equal(await conflict.acquire({}), null);

  const unavailable = createCloudflareGatewayLeaseStore({
    baseUrl: "https://lease.example.com",
    serviceToken: token,
    fetchFn: async () => jsonResponse({ error: "internal" }, 503)
  });
  await assert.rejects(() => unavailable.renew({}), /lease_coordinator_http_503/);
});

test("lease client surfaces bootstrap and hard-fence conflicts instead of treating them as lease denial", async () => {
  for (const reason of ["lease_bootstrap_required", "hard_fence_required"]) {
    const store = createCloudflareGatewayLeaseStore({
      baseUrl: "https://lease.example.com",
      serviceToken: token,
      fetchFn: async () => jsonResponse({ ok: false, reason }, 409)
    });
    await assert.rejects(
      () => store.acquire({}),
      new RegExp("lease_coordinator_" + reason)
    );
  }
});

test("lease client times out instead of waiting on a stalled HTTP control plane", async () => {
  const store = createCloudflareGatewayLeaseStore({
    baseUrl: "https://lease.example.com",
    serviceToken: token,
    timeoutMs: 250,
    fetchFn: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  });
  await assert.rejects(() => store.acquire({}), /lease_coordinator_timeout/);
});

test("Worker health is public but lease routes require bearer authentication", async () => {
  const health = await worker.fetch(new Request("https://lease.example.com/healthz"), {});
  assert.equal(health.status, 200);

  const unauthorized = await worker.fetch(new Request("https://lease.example.com/lease/state"), {
    LEASE_SERVICE_TOKEN: token,
    GATEWAY_LEASE_COORDINATOR: { idFromName: () => "id", get: () => ({ fetch: async () => jsonResponse({ ok: true, lease }) }) }
  });
  assert.equal(unauthorized.status, 401);

  const unconfigured = await worker.fetch(new Request("https://lease.example.com/lease/state"), {});
  assert.equal(unconfigured.status, 503);
  const weakToken = await worker.fetch(new Request("https://lease.example.com/lease/state"), {
    LEASE_SERVICE_TOKEN: "weak-token"
  });
  assert.equal(weakToken.status, 503);
});

test("Worker proxies authenticated state and mutation calls to one deterministic Durable Object", async () => {
  let objectName;
  let requestSeen;
  const namespace = {
    idFromName(name) { objectName = name; return "deterministic-object-id"; },
    get(id) {
      assert.equal(id, "deterministic-object-id");
      return {
        async fetch(request) {
          requestSeen = request;
          return jsonResponse({ ok: true, lease });
        }
      };
    }
  };
  const response = await worker.fetch(new Request("https://lease.example.com/lease/acquire", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ ownerId: "instance-1" })
  }), {
    LEASE_SERVICE_TOKEN: token,
    GATEWAY_LEASE_COORDINATOR: namespace
  });
  assert.equal(response.status, 200);
  assert.equal(objectName, "momentum-movement:discord-gateway");
  assert.equal(requestSeen.method, "POST");
  assert.equal((await response.json()).lease.owner_id, "instance-1");
});

test("Worker separates operator bootstrap and bot fence-request credentials; direct fence confirmation is not public", async () => {
  let forwarded = 0;
  const namespace = {
    idFromName: () => "id",
    get: () => ({ fetch: async () => { forwarded++; return jsonResponse({ ok: true, lease }); } })
  };
  const env = {
    LEASE_SERVICE_TOKEN: token,
    LEASE_BOOTSTRAP_TOKEN: bootstrapToken,
    FENCE_REQUEST_TOKEN: fenceRequestToken,
    GATEWAY_LEASE_COORDINATOR: namespace
  };

  for (const path of ["/lease/bootstrap", "/fence"]) {
    const denied = await worker.fetch(new Request("https://lease.example.com" + path, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ candidateOwnerId: "standby-owner", candidateDeploymentId: "standby-deploy" })
    }), env);
    assert.equal(denied.status, 401);
  }

  const bootstrap = await worker.fetch(new Request("https://lease.example.com/lease/bootstrap", {
    method: "POST",
    headers: { authorization: "Bearer " + bootstrapToken, "content-type": "application/json" },
    body: JSON.stringify({ scope: GATEWAY_LEASE_SCOPE, ownerId: "primary", deploymentId: "primary-deploy", proofId: "operator-proof" })
  }), env);
  assert.equal(bootstrap.status, 200);
  assert.equal(forwarded, 1);

  const directFence = await worker.fetch(new Request("https://lease.example.com/lease/fence/confirm", {
    method: "POST",
    headers: { authorization: "Bearer " + fenceRequestToken, "content-type": "application/json" },
    body: "{}"
  }), env);
  assert.equal(directFence.status, 404);

  const notConfigured = await worker.fetch(new Request("https://lease.example.com/fence", {
    method: "POST",
    headers: { authorization: "Bearer " + fenceRequestToken, "content-type": "application/json" },
    body: JSON.stringify({ candidateOwnerId: "standby-owner", candidateDeploymentId: "standby-deploy" })
  }), env);
  assert.equal(notConfigured.status, 503);
  assert.equal(forwarded, 1);
});

test("Worker never forwards unapproved route paths", async () => {
  let forwarded = false;
  const response = await worker.fetch(new Request("https://lease.example.com/admin", {
    headers: { authorization: "Bearer " + token }
  }), {
    LEASE_SERVICE_TOKEN: token,
    GATEWAY_LEASE_COORDINATOR: {
      idFromName: () => "id",
      get: () => ({ fetch: async () => { forwarded = true; return jsonResponse({ ok: true }); } })
    }
  });
  assert.equal(response.status, 404);
  assert.equal(forwarded, false);
});


test("Cloudflare Worker + SQLite Durable Object + remote hard-stop controller require bootstrap and Render suspension", async () => {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(statement, ...params) {
      const prepared = db.prepare(statement);
      if (statement.includes("RETURNING") || statement.trimStart().startsWith("SELECT")) {
        return { toArray: () => prepared.all(...params) };
      }
      prepared.run(...params);
      return { toArray: () => [] };
    }
  };
  const ctx = {
    storage: { sql },
    blockConcurrencyWhile(callback) { return callback(); }
  };
  const durableObject = new GatewayLeaseCoordinator(ctx, {});
  const namespace = {
    idFromName(name) { assert.equal(name, GATEWAY_LEASE_SCOPE); return "one-deterministic-id"; },
    get(id) {
      assert.equal(id, "one-deterministic-id");
      return { fetch: request => durableObject.fetch(request) };
    }
  };
  const workerEnv = {
    LEASE_SERVICE_TOKEN: token,
    LEASE_BOOTSTRAP_TOKEN: bootstrapToken,
    FENCE_REQUEST_TOKEN: fenceRequestToken,
    RENDER_API_KEY: "render-test-api-key-123456",
    RENDER_SERVICE_IDS_JSON: JSON.stringify({
      "primary-deploy": "srv-primary-12345678",
      "standby-deploy": "srv-standby-12345678"
    }),
    GATEWAY_LEASE_COORDINATOR: namespace
  };
  const remoteFetch = async (url, init) => worker.fetch(new Request(url, init), workerEnv);
  const store = createCloudflareGatewayLeaseStore({
    baseUrl: "https://lease.example.com",
    serviceToken: token,
    fetchFn: remoteFetch,
    timeoutMs: 2500
  });
  const fenceRequester = createCloudflareFenceRequester({
    baseUrl: "https://lease.example.com",
    requestToken: fenceRequestToken,
    fetchFn: remoteFetch,
    timeoutMs: 2500
  });
  const fencedStore = createRemoteFencedCloudflareLeaseStore({
    baseLeaseStore: store,
    fenceRequester
  });

  const renderStates = new Map([
    ["srv-primary-12345678", "not_suspended"],
    ["srv-standby-12345678", "not_suspended"]
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    const serviceId = parsed.pathname.split("/").filter(Boolean)[2];
    if (parsed.origin !== "https://api.render.com") return originalFetch(url, init);
    if (init.method === "GET") {
      return new Response(JSON.stringify({
        id: serviceId,
        suspended: renderStates.get(serviceId),
        updatedAt: "2026-11-14T00:00:00Z"
      }), { status: 200 });
    }
    if (init.method === "POST" && parsed.pathname.endsWith("/suspend")) {
      renderStates.set(serviceId, "suspended");
      return new Response(null, { status: 202 });
    }
    return new Response(JSON.stringify({ error: "unsupported_render_test_call" }), { status: 404 });
  };

  try {
    const primaryInput = {
      scope: GATEWAY_LEASE_SCOPE,
      ownerId: "primary-deploy:process-unique",
      deploymentId: "primary-deploy",
      ttlSeconds: 30
    };
    await assert.rejects(
      () => store.acquire(primaryInput),
      /lease_coordinator_lease_bootstrap_required/
    );

    const bootstrap = await worker.fetch(new Request("https://lease.example.com/lease/bootstrap", {
      method: "POST",
      headers: { authorization: "Bearer " + bootstrapToken, "content-type": "application/json" },
      body: JSON.stringify({
        scope: GATEWAY_LEASE_SCOPE,
        ownerId: primaryInput.ownerId,
        deploymentId: primaryInput.deploymentId,
        proofId: "operator-confirmed-old-gateway-stopped"
      })
    }), workerEnv);
    assert.equal(bootstrap.status, 200);

    let primaryLogins = 0;
    let standbyLogins = 0;
    const common = {
      leaseStore: store,
      scope: GATEWAY_LEASE_SCOPE,
      heartbeatIntervalMs: 1000,
      renewTimeoutMs: 500,
      destroyGateway: async () => {}
    };
    const primary = await startGatewayOwner({
      ...common,
      ownerId: primaryInput.ownerId,
      deploymentId: primaryInput.deploymentId,
      loginGateway: async () => { primaryLogins++; }
    });
    assert.equal(primary.ok, true);
    assert.equal(primary.lease.fencing_epoch, "1");
    assert.equal((await store.read()).owner_id, primaryInput.ownerId);

    const standbyDenied = await startGatewayOwner({
      ...common,
      ownerId: "standby-deploy:process-unique",
      deploymentId: "standby-deploy",
      loginGateway: async () => { standbyLogins++; }
    });
    assert.deepEqual(standbyDenied, { ok: false, reason: "lease_unavailable" });
    assert.equal(primaryLogins, 1);
    assert.equal(standbyLogins, 0);

    const primaryStopped = await primary.shutdown();
    assert.equal(primaryStopped.released, true);
    await assert.rejects(
      () => store.acquire({
        scope: GATEWAY_LEASE_SCOPE,
        ownerId: "standby-deploy:process-unique",
        deploymentId: "standby-deploy"
      }),
      /lease_coordinator_hard_fence_required/
    );

    const standby = await startGatewayOwner({
      ...common,
      leaseStore: fencedStore,
      ownerId: "standby-deploy:process-unique",
      deploymentId: "standby-deploy",
      loginGateway: async () => { standbyLogins++; }
    });
    assert.equal(standby.ok, true);
    assert.equal(standby.lease.fencing_epoch, "2");
    assert.equal(standbyLogins, 1);
    assert.equal(renderStates.get("srv-primary-12345678"), "suspended");
    await standby.shutdown();
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("lease client composes the path correctly when the Worker base URL has no path", async () => {
  let capturedUrl;
  const store = createCloudflareGatewayLeaseStore({
    baseUrl: "https://lease.example.com",
    serviceToken: token,
    fetchFn: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ ok: true, lease });
    }
  });
  assert.deepEqual(await store.acquire({}), lease);
  assert.equal(capturedUrl, "https://lease.example.com/lease/acquire");
});


test("lease client reads authenticated state including an empty lease", async () => {
  let captured;
  const store = createCloudflareGatewayLeaseStore({
    baseUrl: "https://lease.example.com",
    serviceToken: token,
    fetchFn: async (url, init) => {
      captured = { url: String(url), init };
      return jsonResponse({ ok: true, lease: null });
    }
  });
  assert.equal(await store.read(), null);
  assert.equal(captured.url, "https://lease.example.com/lease/state");
  assert.equal(captured.init.method, "GET");
  assert.equal(captured.init.body, undefined);
});
