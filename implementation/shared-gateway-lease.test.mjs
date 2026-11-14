import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireGatewayLease,
  renewGatewayLease,
  releaseGatewayLease,
  startLeaseHeartbeat,
  leaseSqlForTests
} from "./shared-gateway-lease.mjs";

function fakeDb(handler) {
  const calls = [];
  return {
    calls,
    async unsafe(sql, args = []) {
      calls.push({ sql, args });
      return handler(sql, args);
    }
  };
}

test("acquire is one atomic upsert and returns no lease when another owner is active", async () => {
  const db = fakeDb((sql) => {
    assert.match(sql, /ON CONFLICT \(lease_scope\) DO UPDATE/);
    assert.match(sql, /lease_until <= clock_timestamp\(\)/);
    return [];
  });
  const result = await acquireGatewayLease(db, {
    scope: "momentum-movement:discord-gateway",
    ownerId: "standby-instance-1",
    deploymentId: "deploy-abc",
    ttlSeconds: 30
  });
  assert.equal(result, null);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].args, [
    "momentum-movement:discord-gateway",
    "standby-instance-1",
    30,
    "deploy-abc"
  ]);
});

test("renewal is fenced by scope, owner, epoch, and unexpired lease", async () => {
  const row = { owner_id: "primary-1", fencing_epoch: "7" };
  const db = fakeDb((sql, args) => {
    assert.match(sql, /owner_id = \$2/);
    assert.match(sql, /fencing_epoch = \$3::bigint/);
    assert.match(sql, /lease_until > clock_timestamp\(\)/);
    return [row];
  });
  const result = await renewGatewayLease(db, {
    scope: "momentum-movement:discord-gateway",
    ownerId: "primary-1",
    fencingEpoch: "7",
    deploymentId: "deploy-primary",
    ttlSeconds: 30
  });
  assert.equal(result, row);
  assert.deepEqual(db.calls[0].args, [
    "momentum-movement:discord-gateway",
    "primary-1",
    "7",
    30,
    "deploy-primary"
  ]);
});

test("release can only expire the matching owner and fencing epoch", async () => {
  const db = fakeDb((sql, args) => {
    assert.match(sql, /WHERE lease_scope = \$1/);
    assert.match(sql, /AND owner_id = \$2/);
    assert.match(sql, /AND fencing_epoch = \$3::bigint/);
    return [{ owner_id: args[1], fencing_epoch: args[2] }];
  });
  const result = await releaseGatewayLease(db, {
    scope: "momentum-movement:discord-gateway",
    ownerId: "primary-1",
    fencingEpoch: "12"
  });
  assert.equal(result.fencing_epoch, "12");
});

test("heartbeat loss stops future beats and invokes fail-closed callback once", async () => {
  let losses = 0;
  let attempts = 0;
  const heartbeat = startLeaseHeartbeat({
    intervalMs: 1000,
    renew: async () => { attempts++; return null; },
    onLeaseLost: async (reason) => {
      assert.equal(reason, "lease_not_renewed");
      losses++;
    }
  });
  await heartbeat.beat();
  await heartbeat.beat();
  assert.equal(attempts, 1);
  assert.equal(losses, 1);
});

test("lease SQL uses database clock and exposes monotonic fencing epochs", () => {
  assert.match(leaseSqlForTests.ACQUIRE_SQL, /clock_timestamp\(\)/);
  assert.match(leaseSqlForTests.ACQUIRE_SQL, /fencing_epoch \+ 1/);
  assert.match(leaseSqlForTests.ACQUIRE_SQL, /lease_until > clock_timestamp\(\)/);
  assert.match(leaseSqlForTests.RENEW_SQL, /fencing_epoch = \$3::bigint/);
});

test("invalid lease TTL and fencing epoch are rejected before database access", async () => {
  const db = fakeDb(() => { throw new Error("must_not_be_called"); });
  await assert.rejects(() => acquireGatewayLease(db, {
    scope: "scope", ownerId: "owner", deploymentId: "deploy", ttlSeconds: 2
  }), /lease_ttl_seconds/);
  await assert.rejects(() => renewGatewayLease(db, {
    scope: "scope", ownerId: "owner", fencingEpoch: "not-an-epoch",
    deploymentId: "deploy"
  }), /fencing_epoch_invalid/);
  assert.equal(db.calls.length, 0);
});
