import test from "node:test";
import assert from "node:assert/strict";
import { createRenderServiceFencer } from "./render-service-fencer.mjs";

const apiKey = "render-api-key-for-test-123456";
const serviceMap = {
  "primary-deploy": "srv-primary-12345678",
  "standby-deploy": "srv-standby-12345678"
};

function fakeRender({ states, suspendResult = 202, transitionAfterPolls = 1 } = {}) {
  const serviceStates = new Map(Object.entries(states || {
    [serviceMap["primary-deploy"]]: "not_suspended",
    [serviceMap["standby-deploy"]]: "not_suspended"
  }));
  const calls = [];
  let postCount = 0;
  let pollsAfterPost = 0;
  return {
    calls,
    serviceStates,
    async fetch(url, init) {
      const parsed = new URL(String(url));
      calls.push({
        method: init.method,
        path: parsed.pathname,
        authorization: init.headers.authorization
      });
      assert.equal(init.headers.authorization, "Bearer " + apiKey);
      const serviceId = parsed.pathname.split("/").filter(Boolean)[2];
      if (init.method === "GET") {
        if (!serviceStates.has(serviceId)) {
          return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
        }
        if (postCount && serviceId === serviceMap["primary-deploy"]) {
          pollsAfterPost++;
          if (pollsAfterPost >= transitionAfterPolls) {
            serviceStates.set(serviceId, "suspended");
          }
        }
        return new Response(JSON.stringify({
          id: serviceId,
          suspended: serviceStates.get(serviceId),
          updatedAt: "2026-11-14T00:00:00Z"
        }), { status: 200 });
      }
      if (init.method === "POST" && parsed.pathname.endsWith("/suspend")) {
        postCount++;
        if (suspendResult !== 202) {
          return new Response(JSON.stringify({ message: "suspend rejected" }), { status: suspendResult });
        }
        if (transitionAfterPolls === 0) {
          serviceStates.set(serviceId, "suspended");
        }
        return new Response(null, { status: 202 });
      }
      return new Response(JSON.stringify({ message: "unexpected request" }), { status: 404 });
    }
  };
}

function fencerOptions(overrides = {}) {
  return {
    apiKey,
    serviceIdsByDeployment: serviceMap,
    fetchFn: fakeRender().fetch,
    timeoutMs: 1000,
    pollIntervalMs: 100,
    requestTimeoutMs: 1000,
    ...overrides
  };
}

function inactiveLease(overrides = {}) {
  return {
    lease_scope: "momentum-movement:discord-gateway",
    owner_id: "primary-owner",
    fencing_epoch: "3",
    deployment_id: "primary-deploy",
    lease_active: 0,
    ...overrides
  };
}

test("rejects malformed Render credentials, service maps, and duplicate service IDs", () => {
  assert.throws(() => createRenderServiceFencer({
    apiKey: "short",
    serviceIdsByDeployment: serviceMap
  }), /api_key_invalid/);
  assert.throws(() => createRenderServiceFencer({
    apiKey,
    serviceIdsByDeployment: { "primary-deploy": "not-a-render-id" }
  }), /service_id_invalid/);
  assert.throws(() => createRenderServiceFencer({
    apiKey,
    serviceIdsByDeployment: {
      "primary-deploy": "srv-same-12345678",
      "standby-deploy": "srv-same-12345678"
    }
  }), /must_be_unique/);
});

test("verifies candidate running, suspends previous service, polls state, then confirms exact fence", async () => {
  const render = fakeRender({ transitionAfterPolls: 2 });
  const fencer = createRenderServiceFencer(fencerOptions({ fetchFn: render.fetch }));
  const confirmations = [];
  const result = await fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async input => {
      confirmations.push(input);
      return { lease_scope: input.scope, fencing_epoch: "3", fenced_owner_id: input.expectedOwnerId };
    }
  });

  assert.equal(result.previousServiceId, serviceMap["primary-deploy"]);
  assert.equal(result.candidateServiceId, serviceMap["standby-deploy"]);
  assert.equal(result.stopProof.state, "suspended");
  assert.equal(result.stopProof.alreadySuspended, false);
  assert.equal(render.serviceStates.get(serviceMap["primary-deploy"]), "suspended");
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].expectedOwnerId, "primary-owner");
  assert.equal(confirmations[0].expectedFencingEpoch, "3");
  assert.equal(confirmations[0].candidateOwnerId, "standby-owner");
  assert.equal(confirmations[0].candidateDeploymentId, "standby-deploy");
  assert.equal(confirmations[0].provider, "render-service-suspended");
  assert.match(confirmations[0].proofId, /^render-suspend-v1:[a-f0-9]{64}$/);
  assert.ok(confirmations[0].proofId.length <= 200);
  const repeated = await fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async input => { confirmations.push(input); return { ok: true }; }
  });
  assert.equal(repeated.stopProof.alreadySuspended, true);
  assert.equal(confirmations[1].proofId, confirmations[0].proofId);
  assert.equal(render.calls.filter(x => x.method === "POST").length, 1);
});

test("does not call suspend again when previous Render service is already suspended", async () => {
  const render = fakeRender({
    states: {
      [serviceMap["primary-deploy"]]: "suspended",
      [serviceMap["standby-deploy"]]: "not_suspended"
    }
  });
  const fencer = createRenderServiceFencer(fencerOptions({ fetchFn: render.fetch }));
  let confirmed = false;
  const proof = await fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async () => { confirmed = true; return { ok: true }; }
  });
  assert.equal(proof.stopProof.alreadySuspended, true);
  assert.equal(confirmed, true);
  assert.equal(render.calls.filter(x => x.method === "POST").length, 0);
});

test("fails closed when Render accepts suspend but never reports suspended", async () => {
  const render = fakeRender({ transitionAfterPolls: 1000 });
  const fencer = createRenderServiceFencer(fencerOptions({
    fetchFn: render.fetch,
    timeoutMs: 1000,
    pollIntervalMs: 1000
  }));
  let confirmed = false;
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async () => { confirmed = true; }
  }), /render_suspend_state_unverified/);
  assert.equal(confirmed, false);
});

test("does not confirm a fence when Render rejects the suspend request", async () => {
  const render = fakeRender({ suspendResult: 500 });
  const fencer = createRenderServiceFencer(fencerOptions({ fetchFn: render.fetch }));
  let confirmed = false;
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async () => { confirmed = true; }
  }), /render_api_http_500/);
  assert.equal(confirmed, false);
});

test("refuses fencing while old lease remains active or is absent", async () => {
  const render = fakeRender();
  const fencer = createRenderServiceFencer(fencerOptions({ fetchFn: render.fetch }));
  const confirmFence = async () => { throw new Error("must_not_confirm"); };
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease({ lease_active: 1 }) },
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence
  }), /lease_still_active/);
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => null },
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence
  }), /lease_bootstrap_required/);
  assert.equal(render.calls.length, 0);
});

test("refuses same-service deployment mapping and suspended candidate", async () => {
  assert.throws(() => createRenderServiceFencer({
    apiKey,
    serviceIdsByDeployment: {
      "primary-deploy": "srv-same-12345678",
      "standby-deploy": "srv-same-12345678"
    }
  }), /must_be_unique/);

  const render = fakeRender({
    states: {
      [serviceMap["primary-deploy"]]: "not_suspended",
      [serviceMap["standby-deploy"]]: "suspended"
    }
  });
  const fencer = createRenderServiceFencer(fencerOptions({ fetchFn: render.fetch }));
  let confirmed = false;
  await assert.rejects(() => fencer.fenceExpiredOwner({
    leaseStore: { read: async () => inactiveLease() },
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy",
    confirmFence: async () => { confirmed = true; }
  }), /render_candidate_service_suspended/);
  assert.equal(confirmed, false);
  assert.equal(render.calls.some(x => x.method === "POST"), false);
});
