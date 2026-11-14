import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  GatewayLeaseCoordinator,
  GATEWAY_LEASE_SCOPE
} from "../cloudflare/gateway-lease-coordinator.mjs";

function createCoordinator(now = 1_800_000_000_000) {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(statement, ...params) {
      const prepared = db.prepare(statement);
      if (/\bRETURNING\b|^\s*SELECT\b/i.test(statement)) {
        return { toArray: () => prepared.all(...params) };
      }
      prepared.run(...params);
      return { toArray: () => [] };
    }
  };
  let initialized = false;
  const ctx = {
    storage: { sql },
    blockConcurrencyWhile(callback) {
      initialized = true;
      return callback();
    }
  };
  const coordinator = new GatewayLeaseCoordinator(ctx, {});
  coordinator.now = () => now;
  return {
    coordinator,
    db,
    ctx,
    isInitialized: () => initialized,
    setNow(value) { now = value; }
  };
}

const input = (ownerId, extra = {}) => ({
  scope: GATEWAY_LEASE_SCOPE,
  ownerId,
  deploymentId: "test-deploy",
  ttlSeconds: 30,
  ...extra
});

test("constructs the private durable table before serving requests", () => {
  const env = createCoordinator();
  assert.equal(env.isInitialized(), true);
  const columns = env.db.prepare("PRAGMA table_info(gateway_ownership)").all();
  assert.deepEqual(columns.map(x => x.name), [
    "lease_scope", "owner_id", "fencing_epoch", "lease_until_ms",
    "heartbeat_at_ms", "deployment_id"
  ]);
  env.db.close();
});

test("only one competing owner acquires an active lease", () => {
  const env = createCoordinator();
  try {
    const first = env.coordinator.acquire(input("primary-instance"));
    const second = env.coordinator.acquire(input("standby-instance"));
    const sameOwner = env.coordinator.acquire(input("primary-instance"));
    assert.equal(first.owner_id, "primary-instance");
    assert.equal(first.fencing_epoch, "1");
    assert.equal(second, null);
    assert.equal(sameOwner, null);
  } finally { env.db.close(); }
});

test("renewal requires the exact owner, fencing epoch and active lease", () => {
  const env = createCoordinator();
  try {
    const lease = env.coordinator.acquire(input("primary-instance"));
    assert.equal(env.coordinator.renew(input("standby-instance", {
      fencingEpoch: lease.fencing_epoch
    })), null);
    assert.equal(env.coordinator.renew(input("primary-instance", {
      fencingEpoch: "999"
    })), null);
    const renewed = env.coordinator.renew(input("primary-instance", {
      fencingEpoch: lease.fencing_epoch,
      ttlSeconds: 60
    }));
    assert.equal(renewed.fencing_epoch, "1");
    assert.equal(renewed.lease_until_ms, env.coordinator.now() + 60_000);
  } finally { env.db.close(); }
});

test("expired lease increments the fencing epoch monotonically", () => {
  const env = createCoordinator();
  try {
    const first = env.coordinator.acquire(input("primary-instance"));
    env.setNow(first.lease_until_ms + 1);
    const second = env.coordinator.acquire(input("standby-instance"));
    assert.equal(second.owner_id, "standby-instance");
    assert.equal(second.fencing_epoch, "2");
    assert.equal(env.coordinator.renew(input("primary-instance", {
      fencingEpoch: first.fencing_epoch
    })), null);
  } finally { env.db.close(); }
});

test("release is fenced and makes the lease available for next owner", () => {
  const env = createCoordinator();
  try {
    const first = env.coordinator.acquire(input("primary-instance"));
    assert.equal(env.coordinator.release({
      scope: GATEWAY_LEASE_SCOPE,
      ownerId: "wrong-owner",
      fencingEpoch: first.fencing_epoch
    }), null);
    assert.equal(env.coordinator.release({
      scope: GATEWAY_LEASE_SCOPE,
      ownerId: first.owner_id,
      fencingEpoch: "999"
    }), null);
    const released = env.coordinator.release({
      scope: GATEWAY_LEASE_SCOPE,
      ownerId: first.owner_id,
      fencingEpoch: first.fencing_epoch
    });
    assert.equal(released.owner_id, "primary-instance");
    const next = env.coordinator.acquire(input("standby-instance"));
    assert.equal(next.fencing_epoch, "2");
  } finally { env.db.close(); }
});

test("rejects unsupported scope, invalid TTL, and unsafe fencing epochs", () => {
  const env = createCoordinator();
  try {
    assert.throws(() => env.coordinator.acquire(input("owner", { scope: "another-guild" })), /lease_scope_invalid/);
    assert.throws(() => env.coordinator.acquire(input("owner", { ttlSeconds: 2 })), /lease_ttl_seconds/);
    assert.throws(() => env.coordinator.renew(input("owner", {
      fencingEpoch: "9007199254740993"
    })), /fencing_epoch_invalid/);
    assert.throws(() => env.coordinator.release({
      scope: GATEWAY_LEASE_SCOPE,
      ownerId: "owner",
      fencingEpoch: "-1"
    }), /fencing_epoch_invalid/);
  } finally { env.db.close(); }
});

test("read exposes current owner and active status without losing epoch precision", () => {
  const env = createCoordinator();
  try {
    const lease = env.coordinator.acquire(input("primary-instance"));
    const current = env.coordinator.read();
    assert.equal(current.owner_id, "primary-instance");
    assert.equal(current.fencing_epoch, "1");
    assert.equal(current.lease_active, 1);
    env.setNow(lease.lease_until_ms + 1);
    assert.equal(env.coordinator.read().lease_active, 0);
  } finally { env.db.close(); }
});

test("HTTP acquire returns 409 for a competing owner and never exposes storage internals", async () => {
  const env = createCoordinator();
  try {
    const makeRequest = ownerId => new Request("https://lease.internal/lease/acquire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input(ownerId))
    });
    const statuses = await Promise.all([
      env.coordinator.fetch(makeRequest("primary")),
      env.coordinator.fetch(makeRequest("standby"))
    ]);
    const codes = statuses.map(x => x.status).sort();
    assert.deepEqual(codes, [200, 409]);
    const body = await statuses[0].clone().json();
    assert.equal(body.ok, true);
    assert.ok(body.lease);
  } finally { env.db.close(); }
});

test("HTTP state route is read-only and POST to unsupported methods is rejected", async () => {
  const env = createCoordinator();
  try {
    const state = await env.coordinator.fetch(new Request("https://lease.internal/lease/state"));
    assert.equal(state.status, 200);
    const post = await env.coordinator.fetch(new Request("https://lease.internal/lease/state", { method: "POST" }));
    assert.equal(post.status, 405);
    const badJson = await env.coordinator.fetch(new Request("https://lease.internal/lease/acquire", {
      method: "POST",
      body: "not-json"
    }));
    assert.equal(badJson.status, 400);
  } finally { env.db.close(); }
});
