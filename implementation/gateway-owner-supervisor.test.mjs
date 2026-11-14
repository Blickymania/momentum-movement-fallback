import test from "node:test";
import assert from "node:assert/strict";
import { startGatewayOwner } from "./gateway-owner-supervisor.mjs";

const leaseRow = {
  lease_scope: "momentum-movement:discord-gateway",
  owner_id: "process-unique-001",
  fencing_epoch: "14",
  deployment_id: "candidate-deploy"
};

function fakeDb({ acquire = [leaseRow], renew = [leaseRow], release = [leaseRow] } = {}) {
  const calls = [];
  return {
    calls,
    async unsafe(sql, args = []) {
      calls.push({ sql, args });
      if (sql.includes("INSERT INTO failover.gateway_ownership")) return acquire;
      if (sql.includes("SET lease_until = clock_timestamp() - interval")) return release;
      if (sql.includes("UPDATE failover.gateway_ownership")) {
        if (typeof renew === "function") return renew(sql, args);
        return renew;
      }
      throw new Error("unexpected_sql");
    }
  };
}

function base(db, overrides = {}) {
  return {
    db,
    scope: leaseRow.lease_scope,
    ownerId: leaseRow.owner_id,
    deploymentId: leaseRow.deployment_id,
    heartbeatIntervalMs: 1000,
    renewTimeoutMs: 500,
    loginGateway: async () => {},
    destroyGateway: async () => {},
    ...overrides
  };
}

test("does not open Gateway when another owner holds the lease", async () => {
  const db = fakeDb({ acquire: [] });
  let logins = 0;
  const result = await startGatewayOwner(base(db, {
    loginGateway: async () => { logins++; }
  }));
  assert.deepEqual(result, { ok: false, reason: "lease_unavailable" });
  assert.equal(logins, 0);
  assert.equal(db.calls.length, 1);
});

test("acquires before login, exposes the fencing assertion, and releases on shutdown", async () => {
  const db = fakeDb();
  const calls = [];
  const owner = await startGatewayOwner(base(db, {
    loginGateway: async ({ lease, assertOwned, fencingEpoch }) => {
      calls.push("login");
      assert.equal(lease.owner_id, leaseRow.owner_id);
      assert.equal(fencingEpoch, leaseRow.fencing_epoch);
      assert.equal(assertOwned(), true);
    },
    destroyGateway: async reason => { calls.push("destroy:" + reason); }
  }));
  assert.equal(owner.ok, true);
  assert.equal(owner.ready, true);
  assert.equal(owner.assertOwned(), true);
  assert.deepEqual(calls, ["login"]);
  const result = await owner.shutdown();
  assert.equal(result.released, true);
  assert.equal(owner.ready, false);
  assert.throws(() => owner.assertOwned(), /gateway_lease_not_active/);
  assert.ok(calls.includes("destroy:graceful_shutdown"));
  assert.ok(db.calls.some(x => x.sql.includes("SET lease_until = clock_timestamp() - interval")));
});

test("login failure destroys the partially opened client and releases the lease", async () => {
  const db = fakeDb();
  let destroyed = false;
  await assert.rejects(() => startGatewayOwner(base(db, {
    loginGateway: async () => { throw new Error("gateway_connect_failed"); },
    destroyGateway: async reason => {
      if (reason === "gateway_start_failed") destroyed = true;
    }
  })), /gateway_connect_failed/);
  assert.equal(destroyed, true);
  assert.ok(db.calls.some(x => x.sql.includes("SET lease_until = clock_timestamp() - interval")));
});

test("lease loss during a hanging login cancels startup and destroys Gateway", async () => {
  const db = fakeDb({ renew: [] });
  const destroyed = [];
  const result = await startGatewayOwner(base(db, {
    loginGateway: () => new Promise(() => {}),
    destroyGateway: async reason => { destroyed.push(reason); }
  }));
  assert.deepEqual(result, { ok: false, reason: "lease_not_renewed" });
  assert.deepEqual(destroyed, ["lease_lost"]);
});

test("a timed-out DB renewal fences the local Gateway and closes it", async () => {
  const db = fakeDb({ renew: () => new Promise(() => {}) });
  const destroyed = [];
  let lostReason = null;
  const result = await startGatewayOwner(base(db, {
    loginGateway: async () => {},
    destroyGateway: async reason => { destroyed.push(reason); },
    onLeaseLost: async reason => { lostReason = reason; }
  }));
  assert.equal(result.ok, true);
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert.equal(result.ready, false);
  assert.equal(result.leaseLost, true);
  assert.equal(lostReason, "lease_renewal_timeout");
  assert.ok(destroyed.includes("lease_lost"));
  assert.throws(() => result.assertOwned(), /gateway_lease_not_active/);
});


test("closes a Gateway that completes connecting after lease loss", async () => {
  const db = fakeDb({ renew: [] });
  const destroyed = [];
  let resolveLogin;
  const loginPromise = new Promise(resolve => { resolveLogin = resolve; });
  const startPromise = startGatewayOwner(base(db, {
    loginGateway: () => loginPromise,
    destroyGateway: async reason => { destroyed.push(reason); }
  }));
  const result = await startPromise;
  assert.deepEqual(result, { ok: false, reason: "lease_not_renewed" });
  assert.deepEqual(destroyed, ["lease_lost"]);
  resolveLogin();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(destroyed, ["lease_lost", "lease_lost_after_login"]);
});
