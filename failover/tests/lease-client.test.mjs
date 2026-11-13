import test from "node:test";
import assert from "node:assert/strict";
import { LeaseClient } from "../listener/lease-client.mjs";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
function harness(queue) {
  let now = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return response(next.status, next.body);
  };
  const client = new LeaseClient({
    endpoint: "https://lease.example.workers.dev", token: "test-token", instanceId: ID,
    ttlSeconds: 30, heartbeatMs: 5_000, safetyMs: 2_000, fetchImpl, now: () => now,
  });
  return { client, calls, advance: ms => { now += ms; } };
}

test("acquire records the fencing token and permits guarded operations", async () => {
  const h = harness([{ status: 200, body: { acquired: true, fencingToken: "7", expiresAtMs: 30_000 } }]);
  assert.equal(await h.client.tryAcquire(), true);
  assert.equal(h.client.fencingToken, "7");
  assert.equal(h.client.assertValid(), true);
});

test("a competing owner remains standby when the coordinator returns 409", async () => {
  const h = harness([{ status: 409, body: { acquired: false, expiresAtMs: 25_000 } }]);
  assert.equal(await h.client.tryAcquire(), false);
  assert.equal(h.client.isHeld, false);
});

test("renewal preserves the fencing token and refreshes the local safety deadline", async () => {
  const h = harness([
    { status: 200, body: { acquired: true, fencingToken: "9" } },
    { status: 200, body: { valid: true, fencingToken: "9" } },
  ]);
  assert.equal(await h.client.tryAcquire(), true);
  h.advance(10_000);
  assert.equal(await h.client.renew(), true);
  assert.equal(h.client.fencingToken, "9");
  assert.equal(h.client.assertValid(), true);
});

test("local safety deadline blocks operations and notifies loss once", async () => {
  let lost = 0;
  const h = harness([{ status: 200, body: { acquired: true, fencingToken: "2" } }]);
  h.client.onLost = () => { lost++; };
  assert.equal(await h.client.tryAcquire(), true);
  h.advance(29_000);
  assert.throws(() => h.client.assertValid(), /refusing Discord API operation/);
  assert.equal(lost, 1);
  assert.equal(h.client.isHeld, false);
});

test("lease loss aborts the shared signal used by Discord REST requests", async () => {
  const h = harness([
    { status: 200, body: { acquired: true, fencingToken: "4" } },
    { status: 409, body: { valid: false } },
  ]);
  assert.equal(await h.client.tryAcquire(), true);
  const signal = h.client.signal;
  assert.equal(signal.aborted, false);
  assert.equal(await h.client.renew(), false);
  assert.equal(signal.aborted, true);
});

test("coordinator rejection immediately drops local ownership", async () => {
  let lost = 0;
  const h = harness([
    { status: 200, body: { acquired: true, fencingToken: "3" } },
    { status: 409, body: { valid: false } },
  ]);
  h.client.onLost = () => { lost++; };
  assert.equal(await h.client.tryAcquire(), true);
  assert.equal(await h.client.renew(), false);
  assert.equal(h.client.isHeld, false);
  assert.equal(lost, 1);
});
