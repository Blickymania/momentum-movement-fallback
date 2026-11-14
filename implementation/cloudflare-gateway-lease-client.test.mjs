import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker.mjs";
import { createCloudflareGatewayLeaseStore } from "./cloudflare-gateway-lease-client.mjs";

const token = "x".repeat(48);
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
