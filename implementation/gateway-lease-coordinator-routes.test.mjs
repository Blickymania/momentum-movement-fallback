import test from "node:test";
import assert from "node:assert/strict";
import {
  GatewayLeaseCoordinator,
  GATEWAY_LEASE_SCOPE
} from "../cloudflare/gateway-lease-coordinator.mjs";

function makeCoordinator() {
  const calls = [];
  const fakeLease = {
    lease_scope: GATEWAY_LEASE_SCOPE,
    owner_id: "candidate-deploy:instance-1",
    fencing_epoch: "3",
    deployment_id: "candidate-deploy",
    lease_until_ms: 123456789
  };
  const ctx = {
    storage: {
      sql: {
        exec(statement) {
          assert.match(statement, /^\s*CREATE TABLE IF NOT EXISTS gateway_ownership/);
          return { toArray: () => [] };
        }
      }
    },
    blockConcurrencyWhile(callback) {
      return callback();
    }
  };
  const coordinator = new GatewayLeaseCoordinator(ctx, {});
  for (const action of ["bootstrap", "confirmFence", "acquire", "renew", "release"]) {
    coordinator[action] = async value => {
      calls.push({ action, value });
      return fakeLease;
    };
  }
  coordinator.read = () => fakeLease;
  return { coordinator, calls, fakeLease };
}

test("Durable Object dispatches every POST lease endpoint to its matching operation", async () => {
  const { coordinator, calls, fakeLease } = makeCoordinator();
  const routes = [
    ["/lease/bootstrap", "bootstrap"],
    ["/lease/fence/confirm", "confirmFence"],
    ["/lease/acquire", "acquire"],
    ["/lease/renew", "renew"],
    ["/lease/release", "release"]
  ];

  for (const [path, action] of routes) {
    const body = { route: path, ownerId: "candidate-deploy:instance-1" };
    const response = await coordinator.fetch(new Request("https://do.example" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }));
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { ok: true, lease: fakeLease }, path);
    assert.deepEqual(calls.at(-1), { action, value: body }, path);
  }

  assert.deepEqual(calls.map(call => call.action), routes.map(route => route[1]));
});

test("coaching interaction claims remain isolated from the Gateway Lease Durable Object", async () => {
  const { coordinator, calls } = makeCoordinator();
  const response = await coordinator.fetch(new Request(
    "https://do.example/coaching/interaction/claim",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interactionId: "12345678901234567", source: "bot005" })
    }
  ));

  assert.equal(response.status, 404);
  assert.deepEqual(calls, []);
});

test("lease read and health routes remain available and reject unsupported methods", async () => {
  const { coordinator, fakeLease } = makeCoordinator();

  const health = await coordinator.fetch(new Request("https://do.example/healthz"));
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, "control-plane-only");

  const state = await coordinator.fetch(new Request("https://do.example/lease/state"));
  assert.equal(state.status, 200);
  assert.deepEqual(await state.json(), { ok: true, lease: fakeLease });

  const wrongMethod = await coordinator.fetch(new Request("https://do.example/lease/acquire"));
  assert.equal(wrongMethod.status, 405);

  const unknown = await coordinator.fetch(new Request("https://do.example/not-a-route", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  }));
  assert.equal(unknown.status, 404);
});
