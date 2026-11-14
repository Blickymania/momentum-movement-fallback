import {
  acquireGatewayLease,
  renewGatewayLease,
  releaseGatewayLease,
  startLeaseHeartbeat
} from "./shared-gateway-lease.mjs";

// Source-only primary/standby adapter primitive. Both deployments must use it.
// A database lease is not physical process fencing: the external controller must
// stop the prior Gateway process before any replacement process is allowed to log in.
export async function startGatewayOwner({
  db,
  leaseStore,
  scope,
  ownerId,
  deploymentId,
  ttlSeconds = 30,
  heartbeatIntervalMs = 10000,
  renewTimeoutMs = 7000,
  loginGateway,
  destroyGateway,
  onLeaseLost
}) {
  if (leaseStore !== undefined &&
      (!leaseStore || typeof leaseStore.acquire !== "function" ||
       typeof leaseStore.renew !== "function" ||
       typeof leaseStore.release !== "function")) {
    throw new TypeError("lease_store_contract_invalid");
  }
  if (!leaseStore && (!db || typeof db.unsafe !== "function")) {
    throw new TypeError("database_or_lease_store_required");
  }
  if (typeof loginGateway !== "function") throw new TypeError("login_gateway_required");
  if (typeof destroyGateway !== "function") throw new TypeError("destroy_gateway_required");

  const store = leaseStore || {
    acquire: input => acquireGatewayLease(db, input),
    renew: input => renewGatewayLease(db, input),
    release: input => releaseGatewayLease(db, input)
  };
  const identity = { scope, ownerId, deploymentId, ttlSeconds };
  const lease = await store.acquire(identity);
  if (!lease) return { ok: false, reason: "lease_unavailable" };

  let leaseLost = false;
  let gatewayReady = false;
  let shutdownStarted = false;
  let lostReason = null;
  let heartbeat = null;
  const destroyedForReason = new Map();
  let resolveLeaseLost;
  const leaseLostSignal = new Promise(resolve => { resolveLeaseLost = resolve; });

  const assertOwned = () => {
    if (leaseLost || shutdownStarted) {
      throw new Error("gateway_lease_not_active");
    }
    return true;
  };

  const destroy = async reason => {
    const key = String(reason || "unspecified");
    if (destroyedForReason.has(key)) return destroyedForReason.get(key);
    const task = Promise.resolve().then(() => destroyGateway(key));
    destroyedForReason.set(key, task);
    return task;
  };

  const handleLeaseLost = async reason => {
    if (leaseLost) return;
    leaseLost = true;
    gatewayReady = false;
    lostReason = reason;
    resolveLeaseLost(reason);
    // Destroy first. A slow notification/observability callback must not delay
    // local Gateway shutdown after ownership has been lost.
    const destruction = destroy("lease_lost").catch(() => {});
    try {
      if (typeof onLeaseLost === "function") await onLeaseLost(reason);
    } catch {
      // Observability callback failure must never prevent local Gateway destruction.
    }
    await destruction
  };

  heartbeat = startLeaseHeartbeat({
    intervalMs: heartbeatIntervalMs,
    renewTimeoutMs,
    renew: () => store.renew({
      scope: lease.lease_scope,
      ownerId: lease.owner_id,
      fencingEpoch: lease.fencing_epoch,
      deploymentId,
      ttlSeconds
    }),
    onLeaseLost: handleLeaseLost
  });

  let loginOutcome;
  const loginTask = Promise.resolve()
    .then(() => loginGateway({
      lease,
      assertOwned,
      // Call this immediately before every privileged Discord side effect.
      // Handlers must not rely on "client ready" alone as proof of ownership.
      fencingEpoch: lease.fencing_epoch
    }))
    .then(() => ({ kind: "connected" }), error => ({ kind: "failed", error }));

  loginOutcome = await Promise.race([
    loginTask,
    leaseLostSignal.then(reason => ({ kind: "lease_lost", reason }))
  ]);

  if (loginOutcome.kind === "lease_lost") {
    gatewayReady = false;
    // If a client finishes connecting after the lease was lost, destroy it again.
    void loginTask.then(outcome => {
      if (outcome.kind === "connected") return destroy("lease_lost_after_login").catch(() => {});
    });
    await destroy("lease_lost").catch(() => {});
    return { ok: false, reason: loginOutcome.reason };
  }

  if (loginOutcome.kind === "failed") {
    gatewayReady = false;
    heartbeat.stop();
    await destroy("gateway_start_failed").catch(() => {});
    if (!leaseLost) {
      await store.release({
        scope: lease.lease_scope,
        ownerId: lease.owner_id,
        fencingEpoch: lease.fencing_epoch
      }).catch(() => null);
    }
    throw loginOutcome.error;
  }

  if (leaseLost || shutdownStarted) {
    gatewayReady = false;
    await destroy("lease_lost_during_login").catch(() => {});
    return { ok: false, reason: lostReason || "shutdown_during_login" };
  }

  gatewayReady = true;

  return {
    ok: true,
    lease,
    assertOwned,
    get ready() { return gatewayReady && !leaseLost && !shutdownStarted; },
    get leaseLost() { return leaseLost; },
    get lostReason() { return lostReason; },
    async shutdown(reason = "graceful_shutdown") {
      if (shutdownStarted) return { released: false, alreadyStopped: true };
      shutdownStarted = true;
      gatewayReady = false;
      heartbeat.stop();
      await destroy(reason).catch(() => {});
      const released = await releaseGatewayLease(db, {
        scope: lease.lease_scope,
        ownerId: lease.owner_id,
        fencingEpoch: lease.fencing_epoch
      }).catch(() => null);
      return { released: Boolean(released), alreadyStopped: false };
    }
  };
}
