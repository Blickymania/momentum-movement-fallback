import test from "node:test";
import assert from "node:assert/strict";
import {
  createCloudflareFenceRequester,
  createRemoteFencedCloudflareLeaseStore
} from "./cloudflare-fence-request-client.mjs";

const token = "f".repeat(48);

test("fence requester accepts only a public HTTPS Worker URL and strong token", () => {
  for (const baseUrl of [
    "http://lease.example.com",
    "https://bot.railway.internal",
    "https://127.0.0.1",
    "https://localhost.",
    "https://lease.internal",
    "https://lease.lan",
    "https://lease.test",
    "https://singlelabel",
    "https://[::1]"
  ]) {
    assert.throws(() => createCloudflareFenceRequester({
      baseUrl,
      requestToken: token
    }), /public_https/);
  }
  assert.throws(() => createCloudflareFenceRequester({
    baseUrl: "https://lease.example.com",
    requestToken: "weak"
  }), /token_invalid/);
});

test("fence requester sends only the exact candidate identity and accepts verified stop proof", async () => {
  let captured;
  const requester = createCloudflareFenceRequester({
    baseUrl: "https://lease.example.com/control/",
    requestToken: token,
    fetchFn: async (url, init) => {
      captured = { url: String(url), init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        ok: true,
        fenced: true,
        candidateOwnerId: "standby-owner",
        candidateDeploymentId: "standby-deploy",
        stopProof: { serviceId: "srv-primary-12345678", state: "suspended" }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const result = await requester.requestFence({
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy"
  });
  assert.equal(captured.url, "https://lease.example.com/control/fence");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.authorization, "Bearer " + token);
  assert.deepEqual(captured.body, {
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy"
  });
  assert.equal(result.stopProof.state, "suspended");
});

test("fence requester refuses success-shaped responses without a verified suspended stop", async () => {
  const requester = createCloudflareFenceRequester({
    baseUrl: "https://lease.example.com",
    requestToken: token,
    fetchFn: async () => new Response(JSON.stringify({
      ok: true,
      fenced: true,
      candidateOwnerId: "standby-owner",
      candidateDeploymentId: "standby-deploy",
      stopProof: { state: "not_suspended" }
    }), { status: 200 })
  });
  await assert.rejects(() => requester.requestFence({
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy"
  }), /fence_request_fence_request_http_200/);
});

test("fence requester fails closed on controller conflicts and timeout", async () => {
  const blocked = createCloudflareFenceRequester({
    baseUrl: "https://lease.example.com",
    requestToken: token,
    fetchFn: async () => new Response(JSON.stringify({
      ok: false,
      reason: "lease_still_active"
    }), { status: 409 })
  });
  await assert.rejects(() => blocked.requestFence({
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy"
  }), /fence_request_lease_still_active/);

  const stalled = createCloudflareFenceRequester({
    baseUrl: "https://lease.example.com",
    requestToken: token,
    timeoutMs: 250,
    fetchFn: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  });
  await assert.rejects(() => stalled.requestFence({
    candidateOwnerId: "standby-owner",
    candidateDeploymentId: "standby-deploy"
  }), /fence_request_timeout/);
});

test("remote lease wrapper requests external fencing only for hard_fence_required", async () => {
  const calls = [];
  let promoted = false;
  const baseLeaseStore = {
    async acquire(input) {
      calls.push("acquire");
      if (!promoted) throw new Error("lease_coordinator_hard_fence_required");
      return { owner_id: input.ownerId, fencing_epoch: "8" };
    },
    async renew() { return { ok: true }; },
    async release() { return { ok: true }; },
    async read() { return { ok: true }; }
  };
  const fenceRequester = {
    async requestFence(input) {
      calls.push(["fence", input.candidateOwnerId, input.candidateDeploymentId]);
      promoted = true;
      return { fenced: true };
    }
  };
  const store = createRemoteFencedCloudflareLeaseStore({ baseLeaseStore, fenceRequester });
  const lease = await store.acquire({ ownerId: "standby-owner", deploymentId: "standby-deploy" });
  assert.equal(lease.fencing_epoch, "8");
  assert.deepEqual(calls, [
    "acquire",
    ["fence", "standby-owner", "standby-deploy"],
    "acquire"
  ]);
});

test("remote lease wrapper propagates active-owner denial and unrelated failures", async () => {
  let fenceCalls = 0;
  const fenceRequester = { async requestFence() { fenceCalls++; } };
  for (const errorText of ["lease_coordinator_unavailable", "lease_coordinator_lease_bootstrap_required"]) {
    const store = createRemoteFencedCloudflareLeaseStore({
      baseLeaseStore: {
        async acquire() { throw new Error(errorText); },
        async renew() {},
        async release() {},
        async read() {}
      },
      fenceRequester
    });
    await assert.rejects(() => store.acquire({ ownerId: "x", deploymentId: "y" }), new RegExp(errorText));
  }
  const activeStore = createRemoteFencedCloudflareLeaseStore({
    baseLeaseStore: {
      async acquire() { return null; },
      async renew() {},
      async release() {},
      async read() {}
    },
    fenceRequester
  });
  assert.equal(await activeStore.acquire({ ownerId: "x", deploymentId: "y" }), null);
  assert.equal(fenceCalls, 0);
});
