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

const input = (ownerId, deploymentId = "test-deploy", extra = {}) => ({
  scope: GATEWAY_LEASE_SCOPE,
  ownerId: ownerId.startsWith(deploymentId + ":") ? ownerId : deploymentId + ":" + ownerId,
  deploymentId,
  ttlSeconds: 30,
  ...extra
});

function bootstrap(env, ownerId = "primary-deploy:primary-instance", deploymentId = "primary-deploy") {
  const boundOwner = ownerId.startsWith(deploymentId + ":") ? ownerId : deploymentId + ":" + ownerId;
  return env.coordinator.bootstrap({
    scope: GATEWAY_LEASE_SCOPE,
    ownerId: boundOwner,
    deploymentId,
    proofId: "operator-confirmed-old-gateway-stopped"
  });
}

function confirmFence(env, previous, candidateOwner = "standby-deploy:standby-instance", candidateDeployment = "standby-deploy") {
  const boundCandidate = candidateOwner.startsWith(candidateDeployment + ":")
    ? candidateOwner
    : candidateDeployment + ":" + candidateOwner;
  return env.coordinator.confirmFence({
    scope: GATEWAY_LEASE_SCOPE,
    expectedOwnerId: previous.owner_id,
    expectedFencingEpoch: previous.fencing_epoch,
    candidateOwnerId: boundCandidate,
    candidateDeploymentId: candidateDeployment,
    provider: "test-provider",
    proofId: "test-fence-proof-001"
  });
}

test("constructs the durable ownership table with hard-fence evidence fields", () => {
  const env = createCoordinator();
  assert.equal(env.isInitialized(), true);
  const columns = env.db.prepare("PRAGMA table_info(gateway_ownership)").all();
  assert.deepEqual(columns.map(x => x.name), [
    "lease_scope", "owner_id", "fencing_epoch", "lease_until_ms",
    "heartbeat_at_ms", "deployment_id", "fenced_owner_id", "fenced_epoch",
    "fence_target_owner_id", "fence_target_deployment_id",
    "fence_verified_at_ms", "fence_provider", "fence_proof_id"
  ]);
  env.db.close();
});

test("ordinary acquisition is blocked until a separate operator bootstrap exists", () => {
  const env = createCoordinator();
  try {
    assert.throws(() => env.coordinator.acquire(input("primary-deploy:primary-instance", "primary-deploy")), /lease_bootstrap_required/);
    const seed = bootstrap(env);
    assert.equal(seed.owner_id, "__bootstrap__");
    assert.equal(seed.fence_provider, "operator_attested");
    const first = env.coordinator.acquire(input("primary-deploy:primary-instance", "primary-deploy"));
    assert.equal(first.owner_id, "primary-deploy:primary-instance");
    assert.equal(first.fencing_epoch, "1");
    assert.equal(env.coordinator.acquire(input("standby-deploy:standby-instance", "standby-deploy")), null);
    assert.equal(env.coordinator.acquire(input("primary-deploy:primary-instance", "primary-deploy")), null);
    assert.throws(() => bootstrap(env, "second-primary", "another-deploy"), /lease_bootstrap_already_initialized/);
  } finally { env.db.close(); }
});

test("renewal requires the exact owner, fencing epoch and active lease", () => {
  const env = createCoordinator();
  try {
    bootstrap(env);
    const lease = env.coordinator.acquire(input("primary-deploy:primary-instance", "primary-deploy"));
    assert.equal(env.coordinator.renew(input("standby-deploy:standby-instance", "standby-deploy", {
      fencingEpoch: lease.fencing_epoch
    })), null);
    assert.equal(env.coordinator.renew(input("primary-deploy:primary-instance", "primary-deploy", {
      fencingEpoch: "999"
    })), null);
    const renewed = env.coordinator.renew(input("primary-deploy:primary-instance", "primary-deploy", {
      fencingEpoch: lease.fencing_epoch,
      ttlSeconds: 60
    }));
    assert.equal(renewed.fencing_epoch, "1");
    assert.equal(renewed.lease_until_ms, env.coordinator.now() + 60_000);
  } finally { env.db.close(); }
});

test("expired lease cannot transfer until the exact previous owner and epoch are hard-fence confirmed", () => {
  const env = createCoordinator();
  try {
    bootstrap(env);
    const first = env.coordinator.acquire(input("primary-deploy:primary-instance", "primary-deploy"));
    env.setNow(first.lease_until_ms + 1);
    assert.throws(() => env.coordinator.acquire(input("standby-deploy:standby-instance", "standby-deploy")), /hard_fence_required/);
    assert.throws(() => env.coordinator.confirmFence({
      scope: GATEWAY_LEASE_SCOPE,
      expectedOwnerId: "primary-deploy:other-owner",
      expectedFencingEpoch: first.fencing_epoch,
      candidateOwnerId: "standby-deploy:standby-instance",
      candidateDeploymentId: "standby-deploy",
      provider: "test-provider",
      proofId: "primary-deploy:wrong-owner"
    }), /lease_fence_not_confirmed/);
    assert.throws(() => env.coordinator.confirmFence({
      scope: GATEWAY_LEASE_SCOPE,
      expectedOwnerId: first.owner_id,
      expectedFencingEpoch: "999",
      candidateOwnerId: "standby-deploy:standby-instance",
      candidateDeploymentId: "standby-deploy",
      provider: "test-provider",
      proofId: "wrong-epoch"
    }), /lease_fence_not_confirmed/);
    const fenced = confirmFence(env, first);
    assert.equal(fenced.fenced_owner_id, "primary-deploy:primary-instance");
    assert.equal(fenced.fenced_epoch, "1");
    assert.equal(fenced.fence_target_owner_id, "standby-deploy:standby-instance");
    assert.equal(fenced.fence_target_deployment_id, "standby-deploy");
    assert.throws(() => confirmFence(env, first, "other-deploy:other-standby", "other-deploy"), /lease_fence_not_confirmed/);
    const repeatedFence = confirmFence(env, first);
    assert.equal(repeatedFence.fence_proof_id, fenced.fence_proof_id);
    const second = env.coordinator.acquire(input("standby-deploy:standby-instance", "standby-deploy"));
    assert.equal(second.owner_id, "standby-deploy:standby-instance");
    assert.equal(second.fencing_epoch, "2");
    assert.equal(env.coordinator.renew(input("primary-deploy:primary-instance", "primary-deploy", {
      fencingEpoch: first.fencing_epoch
    })), null);
  } finally { env.db.close(); }
});

test("release only expires a matching lease and still requires hard-fence confirmation", () => {
  const env = createCoordinator();
  try {
    bootstrap(env);
    const first = env.coordinator.acquire(input("primary-deploy:primary-instance", "primary-deploy"));
    assert.equal(env.coordinator.release({
      scope: GATEWAY_LEASE_SCOPE,
      ownerId: "primary-deploy:wrong-owner",
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
    assert.equal(released.owner_id, "primary-deploy:primary-instance");
    assert.throws(() => env.coordinator.acquire(input("standby-deploy:standby-instance", "standby-deploy")), /hard_fence_required/);
    confirmFence(env, first);
    const next = env.coordinator.acquire(input("standby-deploy:standby-instance", "standby-deploy"));
    assert.equal(next.fencing_epoch, "2");
  } finally { env.db.close(); }
});

test("rejects unsupported scope, invalid TTL, and unsafe fencing epochs", () => {
  const env = createCoordinator();
  try {
    assert.throws(() => env.coordinator.acquire(input("owner", "test-deploy", { scope: "another-guild" })), /lease_scope_invalid/);
    assert.throws(() => env.coordinator.acquire(input("owner", "test-deploy", { ttlSeconds: 2 })), /lease_ttl_seconds/);
    assert.throws(() => env.coordinator.acquire({ scope: GATEWAY_LEASE_SCOPE, ownerId: "unbound-owner", deploymentId: "test-deploy" }), /owner_id_must_be_bound_to_deployment/);
    assert.throws(() => env.coordinator.bootstrap({ scope: GATEWAY_LEASE_SCOPE, ownerId: "unbound-owner", deploymentId: "test-deploy", proofId: "manual-proof" }), /owner_id_must_be_bound_to_deployment/);
    bootstrap(env);
    const lease = env.coordinator.acquire(input("primary-deploy:primary-instance", "primary-deploy"));
    assert.throws(() => env.coordinator.renew(input("owner", "test-deploy", {
      fencingEpoch: "9007199254740993"
    })), /fencing_epoch_invalid/);
    assert.throws(() => env.coordinator.release({
      scope: GATEWAY_LEASE_SCOPE,
      ownerId: lease.owner_id,
      fencingEpoch: "-1"
    }), /fencing_epoch_invalid/);
  } finally { env.db.close(); }
});

test("read exposes current owner, active status and hard-fence audit without losing epoch precision", () => {
  const env = createCoordinator();
  try {
    bootstrap(env);
    const lease = env.coordinator.acquire(input("primary-deploy:primary-instance", "primary-deploy"));
    const current = env.coordinator.read();
    assert.equal(current.owner_id, "primary-deploy:primary-instance");
    assert.equal(current.fencing_epoch, "1");
    assert.equal(current.lease_active, 1);
    env.setNow(lease.lease_until_ms + 1);
    assert.equal(env.coordinator.read().lease_active, 0);
    assert.equal(env.coordinator.read().fenced_owner_id, null);
  } finally { env.db.close(); }
});

test("HTTP refuses acquire without bootstrap, then allows one owner and denies the competitor", async () => {
  const env = createCoordinator();
  try {
    const makeRequest = ownerId => new Request("https://lease.internal/lease/acquire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input(ownerId, ownerId === "primary-deploy:primary" ? "primary-deploy" : "standby-deploy"))
    });
    const noBootstrap = await env.coordinator.fetch(makeRequest("primary-deploy:primary"));
    assert.equal(noBootstrap.status, 409);
    assert.equal((await noBootstrap.json()).reason, "lease_bootstrap_required");

    const seeded = await env.coordinator.fetch(new Request("https://lease.internal/lease/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: GATEWAY_LEASE_SCOPE,
        ownerId: "primary-deploy:primary",
        deploymentId: "primary-deploy",
        proofId: "operator-confirmed-old-gateway-stopped"
      })
    }));
    assert.equal(seeded.status, 200);

    const statuses = await Promise.all([
      env.coordinator.fetch(makeRequest("primary-deploy:primary")),
      env.coordinator.fetch(makeRequest("standby-deploy:standby"))
    ]);
    const codes = statuses.map(x => x.status).sort();
    assert.deepEqual(codes, [200, 409]);
    const successful = statuses.find(response => response.status === 200);
    const body = await successful.clone().json();
    assert.equal(body.ok, true);
    assert.equal(body.lease.fencing_epoch, "1");
  } finally { env.db.close(); }
});

test("HTTP lease transfer requires a separately confirmed hard fence", async () => {
  const env = createCoordinator();
  try {
    await env.coordinator.fetch(new Request("https://lease.internal/lease/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: GATEWAY_LEASE_SCOPE,
        ownerId: "primary-deploy:primary",
        deploymentId: "primary-deploy",
        proofId: "operator-confirmed-old-gateway-stopped"
      })
    }));
    const first = await env.coordinator.fetch(new Request("https://lease.internal/lease/acquire", {
      method: "POST",
      body: JSON.stringify(input("primary-deploy:primary", "primary-deploy"))
    }));
    const lease = (await first.json()).lease;
    env.setNow(lease.lease_until_ms + 1);
    const denied = await env.coordinator.fetch(new Request("https://lease.internal/lease/acquire", {
      method: "POST",
      body: JSON.stringify(input("standby-deploy:standby", "standby-deploy"))
    }));
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).reason, "hard_fence_required");
    const confirmed = await env.coordinator.fetch(new Request("https://lease.internal/lease/fence/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: GATEWAY_LEASE_SCOPE,
        expectedOwnerId: "primary-deploy:primary",
        expectedFencingEpoch: lease.fencing_epoch,
        candidateOwnerId: "standby-deploy:standby",
        candidateDeploymentId: "standby-deploy",
        provider: "test-provider",
        proofId: "verified-suspension-123"
      })
    }));
    assert.equal(confirmed.status, 200);
    const accepted = await env.coordinator.fetch(new Request("https://lease.internal/lease/acquire", {
      method: "POST",
      body: JSON.stringify(input("standby-deploy:standby", "standby-deploy"))
    }));
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).lease.fencing_epoch, "2");
  } finally { env.db.close(); }
});

test("HTTP state route is read-only and invalid JSON is rejected", async () => {
  const env = createCoordinator();
  try {
    const state = await env.coordinator.fetch(new Request("https://lease.internal/lease/state"));
    assert.equal(state.status, 200);
    assert.equal((await state.json()).ok, true);
    const post = await env.coordinator.fetch(new Request("https://lease.internal/lease/state", { method: "POST" }));
    assert.equal(post.status, 405);
    const badJson = await env.coordinator.fetch(new Request("https://lease.internal/lease/acquire", {
      method: "POST",
      body: "not-json"
    }));
    assert.equal(badJson.status, 400);
  } finally { env.db.close(); }
});
