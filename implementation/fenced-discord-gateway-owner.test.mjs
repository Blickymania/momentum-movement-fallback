import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { prepareFencedDiscordGatewayOwner } from "./fenced-discord-gateway-owner.mjs";

function fakeClient() {
  const client = new EventEmitter();
  client.loginCount = 0;
  client.destroyCount = 0;
  client.restCalls = [];
  client.login = async () => { client.loginCount++; client.emit("ready"); return "connected"; };
  client.destroy = async () => { client.destroyCount++; };
  client.rest = {
    async request(...args) { client.restCalls.push(args); return { ok: true }; }
  };
  return client;
}

function makeLeaseTransport({ denyAcquire = false, denyFence = false } = {}) {
  let lease = null;
  let epoch = 0;
  let fenceAllowed = false;
  const calls = [];
  return {
    calls,
    async fetch(input, init) {
      const url = new URL(String(input));
      const method = init?.method || "GET";
      calls.push({ path: url.pathname, method });
      if (url.pathname === "/lease/acquire" && method === "POST") {
        if (denyAcquire) return new Response(JSON.stringify({ ok: false, reason: "lease_unavailable" }), { status: 409 });
        const body = JSON.parse(init.body);
        const now = Date.now();
        if (lease && lease.lease_until_ms > now) {
          return new Response(JSON.stringify({ ok: false, reason: "lease_unavailable" }), { status: 409 });
        }
        if (lease && lease.lease_until_ms <= now && !fenceAllowed) {
          return new Response(JSON.stringify({ ok: false, reason: "hard_fence_required" }), { status: 409 });
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
      if (url.pathname === "/fence" && method === "POST") {
        const body = JSON.parse(init.body);
        if (denyFence) {
          return new Response(JSON.stringify({
            ok: false,
            reason: "render_suspend_state_unverified"
          }), { status: 503 });
        }
        fenceAllowed = true;
        return new Response(JSON.stringify({
          ok: true,
          fenced: true,
          candidateOwnerId: body.candidateOwnerId,
          candidateDeploymentId: body.candidateDeploymentId,
          stopProof: { state: "suspended", serviceId: "srv-previous-12345678" }
        }), { status: 200 });
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
    ownerId: "candidate-deploy:process-instance-1",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fenceRequestToken: "f".repeat(48),
    fetchFn: leaseTransport.fetch,
    fetchTarget,
    heartbeatIntervalMs: 10000
  });

  let events = 0;
  client.once("ready", () => prepared.markApplicationReady());
  client.on("interaction", async () => {
    events++;
    await client.rest.request("POST", "/channels/1/messages");
    await fetchTarget.fetch("https://discord.com/api/v10/channels/1/messages");
  });

  client.emit("interaction");
  assert.equal(events, 0);
  assert.equal(client.loginCount, 0);

  const readySignal = prepared.waitUntilReady(5000);
  const owner = await prepared.start();
  assert.equal(await readySignal, true);
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
    ownerId: "candidate-deploy:process-instance-2",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fenceRequestToken: "f".repeat(48),
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


test("graceful shutdown aborts a pending Gateway login and releases the acquired lease", async () => {
  const client = fakeClient();
  let loginStartedResolve;
  let finishLateLogin;
  const loginStarted = new Promise(resolve => { loginStartedResolve = resolve; });
  client.login = async () => {
    client.loginCount++;
    loginStartedResolve();
    return new Promise(resolve => { finishLateLogin = resolve; });
  };
  const leaseTransport = makeLeaseTransport();
  const prepared = prepareFencedDiscordGatewayOwner({
    client,
    botToken: "fake-bot-token-1234567890",
    deploymentId: "candidate-deploy",
    ownerId: "candidate-deploy:process-instance-shutdown",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fenceRequestToken: "f".repeat(48),
    fetchFn: leaseTransport.fetch,
    fetchTarget: fakeFetchTarget(),
    heartbeatIntervalMs: 10000
  });

  const startPromise = prepared.start();
  await loginStarted;
  const stopped = await prepared.shutdown("SIGTERM");
  assert.equal(stopped.released, true);
  assert.equal(client.destroyCount, 1);
  assert.equal(prepared.ready, false);
  await assert.rejects(() => startPromise, /gateway_start_aborted/);
  finishLateLogin("late-connected");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.destroyCount, 2);
  assert.equal(leaseTransport.calls.filter(x => x.path === "/lease/acquire").length, 1);
  assert.equal(leaseTransport.calls.filter(x => x.path === "/lease/release").length, 1);
});


test("prepared owner rejects an owner ID that is not namespaced to its deployment", () => {
  const client = fakeClient();
  assert.throws(() => prepareFencedDiscordGatewayOwner({
    client,
    botToken: "fake-bot-token-1234567890",
    deploymentId: "standby-deploy",
    ownerId: "primary-deploy:wrong-owner",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fenceRequestToken: "f".repeat(48),
    fetchFn: makeLeaseTransport().fetch,
    fetchTarget: fakeFetchTarget()
  }), /owner_id_must_be_bound_to_deployment/);
});

test("generated owner ID is unique and prefixed by the deployment identity", () => {
  const client = fakeClient();
  const prepared = prepareFencedDiscordGatewayOwner({
    client,
    botToken: "fake-bot-token-1234567890",
    deploymentId: "standby-deploy",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fenceRequestToken: "f".repeat(48),
    fetchFn: makeLeaseTransport().fetch,
    fetchTarget: fakeFetchTarget()
  });
  assert.match(prepared.ownerId, /^standby-deploy:[0-9a-f-]{36}$/i);
  assert.equal(prepared.scope, "momentum-movement:bot-005-gateway");
});


test("prepared Bot 005 owner requests Worker hard-stop before promoting after lease expiry", async () => {
  const client = fakeClient();
  const transport = makeLeaseTransport();
  const oldOwner = prepareFencedDiscordGatewayOwner({
    client,
    botToken: "fake-bot-token-1234567890",
    deploymentId: "primary-deploy",
    ownerId: "primary-deploy:process-old",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fenceRequestToken: "p".repeat(48),
    fetchFn: transport.fetch,
    fetchTarget: fakeFetchTarget(),
    heartbeatIntervalMs: 10000
  });
  const primary = await oldOwner.start();
  assert.equal(primary.ok, true);
  await oldOwner.shutdown();

  // Model expiry as a crashed old process: no old runtime remains to renew.
  const leaseState = transport.calls;
  const standbyClient = fakeClient();
  const standby = prepareFencedDiscordGatewayOwner({
    client: standbyClient,
    botToken: "fake-bot-token-1234567890",
    deploymentId: "standby-deploy",
    ownerId: "standby-deploy:process-new",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fenceRequestToken: "s".repeat(48),
    fetchFn: transport.fetch,
    fetchTarget: fakeFetchTarget(),
    heartbeatIntervalMs: 10000
  });
  const promoted = await standby.start();
  assert.equal(promoted.ok, true);
  assert.equal(promoted.lease.fencing_epoch, "2");
  assert.equal(standbyClient.loginCount, 1);
  assert.equal(leaseState.some(x => x.path === "/fence"), true);
  await standby.shutdown();
});


test("prepared Bot 005 owner never logs in when Worker cannot verify the previous service hard-stop", async () => {
  const transport = makeLeaseTransport({ denyFence: true });
  const primaryClient = fakeClient();
  const primary = prepareFencedDiscordGatewayOwner({
    client: primaryClient,
    botToken: "fake-bot-token-1234567890",
    deploymentId: "primary-deploy",
    ownerId: "primary-deploy:process-before-fence",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fenceRequestToken: "p".repeat(48),
    fetchFn: transport.fetch,
    fetchTarget: fakeFetchTarget(),
    heartbeatIntervalMs: 10000
  });
  assert.equal((await primary.start()).ok, true);
  await primary.shutdown();

  const standbyClient = fakeClient();
  const standby = prepareFencedDiscordGatewayOwner({
    client: standbyClient,
    botToken: "fake-bot-token-1234567890",
    deploymentId: "standby-deploy",
    ownerId: "standby-deploy:process-fence-fails",
    leaseCoordinatorUrl: "https://lease.example.com",
    leaseServiceToken: "x".repeat(48),
    fenceRequestToken: "s".repeat(48),
    fetchFn: transport.fetch,
    fetchTarget: fakeFetchTarget(),
    heartbeatIntervalMs: 10000
  });
  await assert.rejects(
    () => standby.start(),
    /fence_request_render_suspend_state_unverified/
  );
  assert.equal(standbyClient.loginCount, 0);
  assert.equal(standbyClient.destroyCount, 0);
  assert.equal(standby.ready, false);
  assert.equal(standby.guards.revoked, true);
  assert.equal(transport.calls.filter(x => x.path === "/fence").length, 1);
  assert.equal(transport.calls.filter(x => x.path === "/lease/acquire").length, 2);
});
