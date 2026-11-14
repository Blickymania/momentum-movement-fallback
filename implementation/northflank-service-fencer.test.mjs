import test from "node:test";
import assert from "node:assert/strict";
import { createNorthflankServiceFencer } from "./northflank-service-fencer.mjs";

const apiToken = "northflank-api-token-for-test-123456";
const projectId = "momentum-failover";
const serviceMap = {
  "primary-deploy": "bot005-primary",
  "standby-deploy": "bot005-standby"
};

function fakeNorthflank({ states, pauseStatus = 200, transitionAfterPolls = 1, malformedHealth = false } = {}) {
  const serviceStates = new Map(Object.entries(states || {
    [serviceMap["primary-deploy"]]: false,
    [serviceMap["standby-deploy"]]: false
  }));
  const calls = [];
  let pauseCount = 0;
  let pollsAfterPause = 0;
  return {
    calls,
    serviceStates,
    async fetch(url, init) {
      const parsed = new URL(String(url));
      calls.push({ method: init.method, path: parsed.pathname, authorization: init.headers.authorization });
      assert.equal(init.headers.authorization, "Bearer " + apiToken);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const serviceId = parts[parts.indexOf("services") + 1];
      if (init.method === "GET" && parsed.pathname.endsWith("/health")) {
        if (!serviceStates.has(serviceId)) return Response.json({ message: "not found" }, { status: 404 });
        if (malformedHealth) return Response.json({ data: { current: {} } });
        if (pauseCount && serviceId === serviceMap["primary-deploy"]) {
          pollsAfterPause++;
          if (pollsAfterPause >= transitionAfterPolls) serviceStates.set(serviceId, true);
        }
        const stopped = serviceStates.get(serviceId);
        return Response.json({ data: { current: { hasMore: false, containers: stopped ? [{
          name: serviceId + "-container", status: "TASK_KILLED", terminated: true
        }] : [{
          name: serviceId + "-container", status: "TASK_RUNNING", terminated: false
        }] } } });
      }
      if (init.method === "POST" && parsed.pathname.endsWith("/pause")) {
        pauseCount++;
        if (pauseStatus !== 200) return Response.json({ message: "pause rejected" }, { status: pauseStatus });
        if (transitionAfterPolls === 0) serviceStates.set(serviceId, true);
        return Response.json({ data: {} }, { status: 200 });
      }
      return Response.json({ message: "unexpected request" }, { status: 404 });
    }
  };
}

function fencerOptions(overrides = {}) {
  return {
    apiToken,
    projectId,
    serviceIdsByDeployment: serviceMap,
    fetchFn: fakeNorthflank().fetch,
    timeoutMs: 1000,
    pollIntervalMs: 100,
    requestTimeoutMs: 1000,
    ...overrides
  };
}

function inactiveLease(overrides = {}) {
  return {
    lease_scope: "momentum-movement:bot-005-gateway",
    owner_id: "primary-deploy:primary-owner",
    fencing_epoch: "3",
    deployment_id: "primary-deploy",
    lease_active: 0,
    ...overrides
  };
}

test("rejects malformed Northflank credentials, IDs, and duplicate service IDs", () => {
  assert.throws(() => createNorthflankServiceFencer({ apiToken: "short", projectId, serviceIdsByDeployment: serviceMap }), /api_token_invalid/);
  assert.throws(() => createNorthflankServiceFencer({ apiToken, projectId: "bad/project", serviceIdsByDeployment: serviceMap }), /project_id_invalid/);
  assert.throws(() => createNorthflankServiceFencer({ apiToken, projectId, serviceIdsByDeployment: { "primary-deploy": "bot005-primary" } }), /distinct/);
  assert.throws(() => createNorthflankServiceFencer({ apiToken, projectId, serviceIdsByDeployment: {
    "primary-deploy": "bot005-primary", "standby-deploy": "bot005-primary"
  } }), /distinct/);
});

test("verifies standby running, pauses previous service, observes terminated containers, then confirms fence", async () => {
  const northflank = fakeNorthflank({ transitionAfterPolls: 2 });
  const fencer = createNorthflankServiceFencer(fencerOptions({ fetchFn: northflank.fetch }));
  const confirmations = [];
  const result = await fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-deploy:standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async input => {
      confirmations.push(input);
      return { lease_scope: input.scope, fencing_epoch: "3", fenced_owner_id: input.expectedOwnerId };
    }
  });
  assert.equal(result.previousServiceId, serviceMap["primary-deploy"]);
  assert.equal(result.candidateServiceId, serviceMap["standby-deploy"]);
  assert.equal(result.stopProof.state, "paused");
  assert.equal(result.stopProof.alreadyPaused, false);
  assert.equal(northflank.serviceStates.get(serviceMap["primary-deploy"]), true);
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].expectedOwnerId, "primary-deploy:primary-owner");
  assert.equal(confirmations[0].expectedFencingEpoch, "3");
  assert.equal(confirmations[0].candidateOwnerId, "standby-deploy:standby-owner");
  assert.equal(confirmations[0].candidateDeploymentId, "standby-deploy");
  assert.equal(confirmations[0].provider, "northflank-service-paused");
  assert.match(confirmations[0].proofId, /^northflank-pause-v1:[a-f0-9]{64}$/);
  const repeated = await fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-deploy:standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async input => { confirmations.push(input); return { ok: true }; }
  });
  assert.equal(repeated.stopProof.alreadyPaused, true);
  assert.equal(confirmations[1].proofId, confirmations[0].proofId);
  assert.equal(northflank.calls.filter(call => call.method === "POST").length, 1);
});

test("does not pause the previous service again when already stopped", async () => {
  const northflank = fakeNorthflank({ states: {
    [serviceMap["primary-deploy"]]: true,
    [serviceMap["standby-deploy"]]: false
  } });
  const fencer = createNorthflankServiceFencer(fencerOptions({ fetchFn: northflank.fetch }));
  const proof = await fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-deploy:standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async () => ({ ok: true })
  });
  assert.equal(proof.stopProof.alreadyPaused, true);
  assert.equal(northflank.calls.filter(call => call.method === "POST").length, 0);
});

test("fails closed when pause is accepted but current containers remain active", async () => {
  const northflank = fakeNorthflank({ transitionAfterPolls: 1000 });
  const fencer = createNorthflankServiceFencer(fencerOptions({
    fetchFn: northflank.fetch, timeoutMs: 1000, pollIntervalMs: 1000
  }));
  let confirmed = false;
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-deploy:standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async () => { confirmed = true; }
  }), /northflank_pause_state_unverified/);
  assert.equal(confirmed, false);
});

test("does not confirm a fence when Northflank rejects pause", async () => {
  const northflank = fakeNorthflank({ pauseStatus: 500 });
  const fencer = createNorthflankServiceFencer(fencerOptions({ fetchFn: northflank.fetch }));
  let confirmed = false;
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-deploy:standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async () => { confirmed = true; }
  }), /northflank_api_http_500/);
  assert.equal(confirmed, false);
});

test("refuses promotion unless lease is inactive and candidate containers are running", async () => {
  const northflank = fakeNorthflank({ states: {
    [serviceMap["primary-deploy"]]: false,
    [serviceMap["standby-deploy"]]: true
  } });
  const fencer = createNorthflankServiceFencer(fencerOptions({ fetchFn: northflank.fetch }));
  const confirmFence = async () => { throw new Error("must_not_confirm"); };
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease({ lease_active: 1 }) },
    candidateOwnerId: "standby-deploy:standby-owner",
    candidateDeploymentId: "standby-deploy", confirmFence
  }), /lease_still_active/);
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-deploy:standby-owner",
    candidateDeploymentId: "standby-deploy", confirmFence
  }), /northflank_candidate_service_not_running/);
  assert.equal(northflank.calls.length, 1);
  assert.equal(northflank.calls[0].method, "GET");
  assert.ok(northflank.calls[0].path.endsWith("/bot005-standby/health"));
  assert.equal(northflank.calls.some(call => call.method === "POST"), false);
});

test("fails closed when the provider health payload is missing container evidence", async () => {
  const northflank = fakeNorthflank({ malformedHealth: true });
  const fencer = createNorthflankServiceFencer(fencerOptions({ fetchFn: northflank.fetch }));
  await assert.rejects(() => fencer.getServiceHealth(serviceMap["primary-deploy"]), /northflank_service_state_unverified/);
});

test("refuses absent lease state and mismatched owners before provider calls", async () => {
  const northflank = fakeNorthflank();
  const fencer = createNorthflankServiceFencer(fencerOptions({ fetchFn: northflank.fetch }));
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => null },
    candidateOwnerId: "standby-deploy:standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async () => { throw new Error("must_not_confirm"); }
  }), /lease_bootstrap_required/);
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease({ owner_id: "wrong-owner" }) },
    candidateOwnerId: "standby-deploy:standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async () => { throw new Error("must_not_confirm"); }
  }), /previous_owner_id_not_bound_to_deployment/);
  assert.equal(northflank.calls.length, 0);
});
