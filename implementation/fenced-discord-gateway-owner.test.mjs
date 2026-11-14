import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { prepareFencedDiscordGatewayOwner } from "./fenced-discord-gateway-owner.mjs";

function fakeClient() {
  const client = new EventEmitter();
  client.loginCount = 0;
  client.destroyCount = 0;
  client.restCalls = [];
  client.login = async () => { client.loginCount++; return "connected"; };
  client.destroy = async () => { client.destroyCount++; };
  client.rest = {
    async request(...args) { client.restCalls.push(args); return { ok: true }; }
  };
  return client;
}

function makeLeaseTransport({ denyAcquire = false } = {}) {
  let lease = null;
  let epoch = 0;
  const calls = [];
  return {
    calls,
    async fetch(input, init) {
      const url = new URL(String(input));
      const method = init?.method || "GET";
      calls.push({ path: url.pathname, method });
      if (url.pathname === "/lease/acquire" && method === "POST") {
        if (denyAcquire) return new Response(JSON.stringify({ ok: false }), { status: 409 });
        const body = JSON.parse(init.body);
        const now = Date.now();
        if (lease && lease.lease_until_ms > now) {
          return new Response(JSON.stringify({ ok: false }), { status: 409 });
        }
        epoch++;
        lease = {
          lease_scope: body.scope,
          owner_id: body.ownerId,
          fencing_epoch: String(epoch),
          deployment_id: body.deploymentId,
          lease_until_ms: now + body.ttlSeconds * 1000
        };
        return new Response(JSON.stringify({ ok: true, lease }), { status: 200 });
      }
      if (url.pathname === "/lease/renew" && method === "POST") {
        const body = JSON.parse(init.body);
        const now = Date.now();
        if (!lease || lease.owner_id !== body.ownerId ||
            lease.fencing_epoch !== body.fencingEpoch || lease.lease_until_ms <= now) {
          return new Response(JSON.stringify({ ok: false }), { status: 409 });
        }
        lease.lease_until_ms = now + body.ttlSeconds * 1000;
        return new Response(JSON.stringify({ ok: true, lease }), { status: 200 });
      }
      if (url.pathname === "/lease/release" && method === "POST") {
        const body = JSON.parse(init.body);
        if (!lease || lease.owner_id !== body.ownerId || lease.fencing_epoch !== body.fencingEpoch) {
          return new Response(JSON.stringify({ ok: false }), { status: 409 });
        }
        lease.lease_until_ms = Date.now() - 1;
        return new Response(JSON.stringify({ ok: true, lease }), { status: 200 });
      }
      if (url.pathname === "/lease/state" && method === "GET") {
        return new Response(JSON.stringify({ ok: true, lease }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }
  };
}

function fakeFetchTarget() {
  const calls = [];
  return {
    calls,
    async fetch(input, init) {
      calls.push({ url: String(input), init });
      return new Response("ok", { status: 200 });
    }
  };
}

test("prepared gateway cannot login or execute event side effects until lease acquisition", async () => {
  const client = fakeClient();
  const leaseTransport = makeLeaseTransport();
  const fetchTarget = fakeFetchTarget();
  const prepared = prepareFencedDiscordGatewayOwner({
    client,
    botToken: "fake-bot-token-1234567890",
    deploymentId: "candidate-deploy",
    ownerId: "process-instance-1",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fetchFn: leaseTransport.fetch,
    fetchTarget,
    heartbeatIntervalMs: 10000
  });

  let events = 0;
  client.on("interaction", async () => {
    events++;
    await client.rest.request("POST", "/channels/1/messages");
    await fetchTarget.fetch("https://discord.com/api/v10/channels/1/messages");
  });

  client.emit("interaction");
  assert.equal(events, 0);
  assert.equal(client.loginCount, 0);

  const owner = await prepared.start();
  assert.equal(owner.ok, true);
  assert.equal(client.loginCount, 1);
  assert.equal(prepared.ready, true);

  client.emit("interaction");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events, 1);
  assert.equal(client.restCalls.length, 1);
  assert.equal(fetchTarget.calls.length, 1);

  const stopped = await prepared.shutdown();
  assert.equal(stopped.released, true);
  assert.equal(client.destroyCount, 1);
  assert.equal(prepared.ready, false);
  client.emit("interaction");
  assert.equal(events, 1);
  assert.throws(() => client.rest.request("POST", "/channels/1/messages"), /gateway_ownership_revoked/);
  assert.throws(() => fetchTarget.fetch("https://discord.com/api/v10/channels/1/messages"), /gateway_ownership_revoked/);
});

test("prepared gateway stays disconnected when Cloudflare denies its lease", async () => {
  const client = fakeClient();
  const leaseTransport = makeLeaseTransport({ denyAcquire: true });
  const prepared = prepareFencedDiscordGatewayOwner({
    client,
    botToken: "fake-bot-token-1234567890",
    deploymentId: "candidate-deploy",
    ownerId: "process-instance-2",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fetchFn: leaseTransport.fetch,
    fetchTarget: fakeFetchTarget()
  });
  const result = await prepared.start();
  assert.deepEqual(result, { ok: false, reason: "lease_unavailable" });
  assert.equal(client.loginCount, 0);
  assert.equal(client.destroyCount, 0);
  assert.equal(prepared.ready, false);
  assert.equal(prepared.guards.revoked, true);
});
