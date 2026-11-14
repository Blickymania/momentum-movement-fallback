import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installGatewayOwnershipGuards } from "./discord-gateway-ownership-guards.mjs";

function fakeClient() {
  const client = new EventEmitter();
  const requests = [];
  const logins = [];
  client.login = async (...args) => { logins.push(args); return "ready"; };
  client.logins = logins;
  client.rest = {
    async request(...args) {
      requests.push(args);
      return { ok: true };
    }
  };
  client.requests = requests;
  return client;
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

test("rejects missing client REST hook and non-public coordinator URLs", () => {
  const client = new EventEmitter();
  client.login = async () => {};
  assert.throws(() => installGatewayOwnershipGuards({
    client,
    leaseCoordinatorUrl: "https://lease.example.com",
    fetchTarget: fakeFetchTarget()
  }), /discord_rest_request_hook_required/);

  const valid = fakeClient();
  assert.throws(() => installGatewayOwnershipGuards({
    client: valid,
    leaseCoordinatorUrl: "http://lease.example.com",
    fetchTarget: fakeFetchTarget()
  }), /public_https/);
  assert.throws(() => installGatewayOwnershipGuards({
    client: valid,
    leaseCoordinatorUrl: "https://bot.railway.internal",
    fetchTarget: fakeFetchTarget()
  }), /public_https/);
  assert.throws(() => installGatewayOwnershipGuards({
    client: valid,
    leaseCoordinatorUrl: "https://localhost./",
    fetchTarget: fakeFetchTarget()
  }), /public_https/);
});

test("wraps event and once listeners so they do not run without active ownership", () => {
  const client = fakeClient();
  const fetchTarget = fakeFetchTarget();
  const guard = installGatewayOwnershipGuards({
    client,
    leaseCoordinatorUrl: "https://lease.example.com/control",
    fetchTarget
  });
  let events = 0;
  let onceEvents = 0;
  client.on("interaction", () => { events++; });
  client.once("ready", () => { onceEvents++; });

  client.emit("interaction");
  client.emit("ready");
  assert.equal(events, 0);
  assert.equal(onceEvents, 0);
  assert.equal(guard.guardedListenerCount, 2);

  guard.setAssertOwned(() => true);
  client.emit("interaction");
  client.emit("ready");
  client.emit("ready");
  assert.equal(events, 1);
  assert.equal(onceEvents, 1);

  guard.revoke();
  client.emit("interaction");
  assert.equal(events, 1);
  assert.equal(guard.revoked, true);
  guard.restore();
});

test("blocks Gateway login unless a valid ownership lease is active", async () => {
  const client = fakeClient();
  const guard = installGatewayOwnershipGuards({
    client,
    leaseCoordinatorUrl: "https://lease.example.com",
    fetchTarget: fakeFetchTarget()
  });
  assert.throws(() => client.login("token-placeholder"), /gateway_lease_not_active/);
  assert.equal(client.logins.length, 0);
  guard.setAssertOwned(() => true);
  assert.equal(await client.login("token-placeholder"), "ready");
  assert.equal(client.logins.length, 1);
  guard.revoke();
  assert.throws(() => client.login("token-placeholder"), /gateway_ownership_revoked/);
  assert.equal(client.logins.length, 1);
  guard.restore();
});

test("fences every Discord REST request before invoking the underlying client", async () => {
  const client = fakeClient();
  const guard = installGatewayOwnershipGuards({
    client,
    leaseCoordinatorUrl: "https://lease.example.com",
    fetchTarget: fakeFetchTarget()
  });
  await assert.rejects(() => client.rest.request("POST", "/channels/1/messages"), /gateway_lease_not_active/);
  assert.equal(client.requests.length, 0);

  guard.setAssertOwned(() => true);
  const result = await client.rest.request("POST", "/channels/1/messages");
  assert.deepEqual(result, { ok: true });
  assert.equal(client.requests.length, 1);

  guard.revoke();
  await assert.rejects(() => client.rest.request("POST", "/channels/1/messages"), /gateway_ownership_revoked/);
  assert.equal(client.requests.length, 1);
  guard.restore();
});

test("fences all direct fetch calls except the configured lease coordinator origin", async () => {
  const client = fakeClient();
  const fetchTarget = fakeFetchTarget();
  const guard = installGatewayOwnershipGuards({
    client,
    leaseCoordinatorUrl: "https://lease.example.com/control",
    fetchTarget
  });
  await assert.rejects(() => fetchTarget.fetch("https://discord.com/api/v10/channels/1/messages"), /gateway_lease_not_active/);
  await assert.rejects(() => fetchTarget.fetch("http://coaching-workflow.railway.internal:3000/interaction"), /gateway_lease_not_active/);
  assert.equal(fetchTarget.calls.length, 0);

  const leaseResponse = await fetchTarget.fetch("https://lease.example.com/lease/renew");
  assert.equal(leaseResponse.status, 200);
  assert.equal(fetchTarget.calls.length, 1);

  guard.setAssertOwned(() => true);
  const discordResponse = await fetchTarget.fetch("https://discord.com/api/v10/channels/1/messages");
  assert.equal(discordResponse.status, 200);
  const coachingResponse = await fetchTarget.fetch("https://coaching.example.com/interaction");
  assert.equal(coachingResponse.status, 200);
  assert.throws(() => fetchTarget.fetch("http://coaching-workflow.railway.internal:3000/interaction"), /railway_dependency_forbidden/);
  assert.equal(fetchTarget.calls.length, 3);

  guard.revoke();
  await assert.rejects(() => fetchTarget.fetch("https://coaching.example.com/interaction"), /gateway_ownership_revoked/);
  guard.restore();
  const unguarded = await fetchTarget.fetch("https://coaching.example.com/interaction");
  assert.equal(unguarded.status, 200);
});

test("replaces client listener methods and global fetch only until explicit restoration", async () => {
  const client = fakeClient();
  const fetchTarget = fakeFetchTarget();
  const originalOn = client.on;
  const originalOnce = client.once;
  const originalLogin = client.login;
  const originalRest = client.rest.request;
  const originalFetch = fetchTarget.fetch;
  const guard = installGatewayOwnershipGuards({
    client,
    leaseCoordinatorUrl: "https://lease.example.com",
    fetchTarget
  });
  assert.notEqual(client.on, originalOn);
  assert.notEqual(client.once, originalOnce);
  assert.notEqual(client.login, originalLogin);
  assert.notEqual(client.rest.request, originalRest);
  assert.notEqual(fetchTarget.fetch, originalFetch);
  guard.restore();
  assert.equal(client.on, originalOn);
  assert.equal(client.once, originalOnce);
  assert.equal(client.login, originalLogin);
  assert.equal(client.rest.request, originalRest);
  assert.equal(fetchTarget.fetch, originalFetch);
});
