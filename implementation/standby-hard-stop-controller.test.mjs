import test from "node:test";
import assert from "node:assert/strict";
import { startStandbyAfterHardStop } from "./standby-hard-stop-controller.mjs";

const primary = {
  ownerId: "primary-process",
  deploymentId: "primary-deploy",
  processId: "runtime-123"
};
const standby = {
  ownerId: "standby-process",
  deploymentId: "standby-deploy"
};
const activePrimaryLease = {
  lease_scope: "momentum-movement:discord-gateway",
  owner_id: primary.ownerId,
  fencing_epoch: "9",
  deployment_id: primary.deploymentId,
  lease_active: true
};
const stoppedEvidence = {
  confirmed: true,
  state: "stopped",
  gatewayClosed: true,
  ownerId: primary.ownerId,
  deploymentId: primary.deploymentId,
  processId: primary.processId
};

function fakeLeaseStore({ before = activePrimaryLease, after = null, releaseResult = true } = {}) {
  const calls = [];
  return {
    calls,
    async read(scope) {
      calls.push(["read", scope]);
      return calls.filter(x => x[0] === "read").length === 1 ? before : after;
    },
    async release(args) {
      calls.push(["release", args]);
      return releaseResult ? { ...activePrimaryLease, lease_active: false } : null;
    }
  };
}

test("hard-stops and verifies the exact primary before starting standby", async () => {
  const leaseStore = fakeLeaseStore({ before: activePrimaryLease, after: null });
  const calls = [];
  const processControl = {
    async stopAndConfirm(args) {
      calls.push(["stop", args]);
      return stoppedEvidence;
    }
  };
  const result = await startStandbyAfterHardStop({
    leaseStore,
    processControl,
    primary,
    standby,
    startStandby: async args => {
      calls.push(["start", args]);
      return { ok: true, ready: true, lease: { fencing_epoch: "10" } };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.primaryStopped, true);
  assert.deepEqual(calls.map(x => x[0]), ["stop", "start"]);
  assert.equal(leaseStore.calls[0][0], "read");
  assert.equal(leaseStore.calls[1][0], "release");
  assert.equal(leaseStore.calls[2][0], "read");
  assert.deepEqual(leaseStore.calls[1][1], {
    scope: "momentum-movement:discord-gateway",
    ownerId: primary.ownerId,
    fencingEpoch: "9"
  });
});

test("does not start standby when primary stop cannot be proven", async () => {
  const leaseStore = fakeLeaseStore({ before: activePrimaryLease });
  let starts = 0;
  const result = await startStandbyAfterHardStop({
    leaseStore,
    processControl: { stopAndConfirm: async () => ({ confirmed: true, state: "stopped" }) },
    primary,
    standby,
    startStandby: async () => { starts++; return { ok: true, ready: true }; }
  });
  assert.deepEqual(result, { ok: false, reason: "primary_hard_stop_unverified" });
  assert.equal(starts, 0);
  assert.equal(leaseStore.calls.some(x => x[0] === "release"), false);
});

test("rejects a stop confirmation for the wrong process identity", async () => {
  const leaseStore = fakeLeaseStore({ before: activePrimaryLease });
  let starts = 0;
  const result = await startStandbyAfterHardStop({
    leaseStore,
    processControl: {
      stopAndConfirm: async () => ({ ...stoppedEvidence, processId: "different-process" })
    },
    primary,
    standby,
    startStandby: async () => { starts++; return { ok: true, ready: true }; }
  });
  assert.equal(result.reason, "primary_hard_stop_unverified");
  assert.equal(starts, 0);
});

test("does not stop an unexpected active lease owner", async () => {
  const unexpected = { ...activePrimaryLease, owner_id: "other-primary" };
  const leaseStore = fakeLeaseStore({ before: unexpected });
  let stops = 0;
  let starts = 0;
  const result = await startStandbyAfterHardStop({
    leaseStore,
    processControl: { stopAndConfirm: async () => { stops++; return stoppedEvidence; } },
    primary,
    standby,
    startStandby: async () => { starts++; return { ok: true, ready: true }; }
  });
  assert.equal(result.reason, "unexpected_active_gateway_owner");
  assert.equal(stops, 0);
  assert.equal(starts, 0);
});

test("does not start when old lease remains active after confirmed stop", async () => {
  const leaseStore = fakeLeaseStore({ before: activePrimaryLease, after: activePrimaryLease });
  let starts = 0;
  const result = await startStandbyAfterHardStop({
    leaseStore,
    processControl: { stopAndConfirm: async () => stoppedEvidence },
    primary,
    standby,
    startStandby: async () => { starts++; return { ok: true, ready: true }; }
  });
  assert.equal(result.reason, "primary_lease_still_active");
  assert.equal(starts, 0);
});

test("fails closed if the stop controller throws", async () => {
  const leaseStore = fakeLeaseStore({ before: activePrimaryLease });
  let starts = 0;
  const result = await startStandbyAfterHardStop({
    leaseStore,
    processControl: { stopAndConfirm: async () => { throw new Error("provider_api_error"); } },
    primary,
    standby,
    startStandby: async () => { starts++; return { ok: true, ready: true }; }
  });
  assert.equal(result.reason, "primary_hard_stop_failed");
  assert.equal(starts, 0);
  assert.equal(leaseStore.calls.some(x => x[0] === "release"), false);
});

test("does not accept standby unless its lease supervisor reports ready", async () => {
  const leaseStore = fakeLeaseStore({ before: activePrimaryLease, after: null });
  const result = await startStandbyAfterHardStop({
    leaseStore,
    processControl: { stopAndConfirm: async () => stoppedEvidence },
    primary,
    standby,
    startStandby: async () => ({ ok: true, ready: false })
  });
  assert.equal(result.ok, false);
  assert.equal(result.primaryStopped, true);
  assert.equal(result.reason, "standby_lease_or_gateway_not_ready");
});

test("allows known primary process stop when its lease has already expired", async () => {
  const expired = { ...activePrimaryLease, lease_active: false };
  const leaseStore = fakeLeaseStore({ before: expired, after: expired });
  let starts = 0;
  const result = await startStandbyAfterHardStop({
    leaseStore,
    processControl: { stopAndConfirm: async () => stoppedEvidence },
    primary,
    standby,
    startStandby: async args => {
      starts++;
      assert.equal(args.ownerId, standby.ownerId);
      return { ok: true, ready: true };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(starts, 1);
});
