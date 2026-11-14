import test from "node:test";
import assert from "node:assert/strict";
import { acquireLeaseState, renewLeaseState, checkLeaseState, releaseLeaseState } from "../listener/lease-state.mjs";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TTL = 30_000;

test("only one instance acquires an unexpired lease", () => {
  const first = acquireLeaseState(null, A, 1_000, TTL);
  assert.equal(first.result.acquired, true);
  assert.equal(first.result.fencingToken, "1");
  const second = acquireLeaseState(first.state, B, 2_000, TTL);
  assert.equal(second.result.acquired, false);
  assert.equal(second.state.ownerId, A);
});

test("same-owner acquire retry is idempotent and extends the lease", () => {
  const first = acquireLeaseState(null, A, 1_000, TTL);
  const retried = acquireLeaseState(first.state, A, 5_000, TTL);
  assert.equal(retried.result.acquired, true);
  assert.equal(retried.result.fencingToken, "1");
  assert.equal(retried.state.expiresAtMs, 35_000);
});

test("owner renews without changing its fencing token", () => {
  const acquired = acquireLeaseState(null, A, 1_000, TTL);
  const renewed = renewLeaseState(acquired.state, A, "1", 10_000, TTL);
  assert.equal(renewed.result.valid, true);
  assert.equal(renewed.result.fencingToken, "1");
  assert.equal(renewed.state.expiresAtMs, 40_000);
});

test("expired lease is taken over with a strictly higher fencing token", () => {
  const first = acquireLeaseState(null, A, 1_000, TTL);
  const second = acquireLeaseState(first.state, B, 31_000, TTL);
  assert.equal(second.result.acquired, true);
  assert.equal(second.result.fencingToken, "2");
  assert.equal(second.state.ownerId, B);
});

test("stale owner cannot renew, check, or release after takeover", () => {
  const first = acquireLeaseState(null, A, 1_000, TTL);
  const second = acquireLeaseState(first.state, B, 31_000, TTL);
  assert.equal(renewLeaseState(second.state, A, "1", 32_000, TTL).result.valid, false);
  assert.equal(checkLeaseState(second.state, A, "1", 32_000), false);
  assert.equal(releaseLeaseState(second.state, A, "1", 32_000).result.released, false);
  assert.equal(checkLeaseState(second.state, B, "2", 32_000), true);
});

test("release makes the lease available but never resets the fencing counter", () => {
  const first = acquireLeaseState(null, A, 1_000, TTL);
  const released = releaseLeaseState(first.state, A, "1", 2_000);
  assert.equal(released.result.released, true);
  const second = acquireLeaseState(released.state, B, 3_000, TTL);
  assert.equal(second.result.fencingToken, "2");
});

test("expired owner cannot renew itself after expiry", () => {
  const first = acquireLeaseState(null, A, 1_000, TTL);
  assert.equal(renewLeaseState(first.state, A, "1", 31_000, TTL).result.valid, false);
});

test("rejects unsafe TTLs and malformed instance IDs", () => {
  assert.throws(() => acquireLeaseState(null, A, 1_000, 1_000), /ttlMs/);
  assert.throws(() => acquireLeaseState(null, "bad", 1_000, TTL), /UUID/);
});
