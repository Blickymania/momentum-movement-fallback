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
  if (!db || typeof db.unsafe !== "function") throw new TypeError("database_required");
  if (typeof loginGateway !== "function") throw new TypeError("login_gateway_required");
  if (typeof destroyGateway !== "function") throw new TypeError("destroy_gateway_required");

  const identity = { scope, ownerId, deploymentId, ttlSeconds };
  const lease = await acquireGatewayLease(db, identity);
  if (!lease) return { ok: false, reason: "lease_unavailable" };

  let leaseLost = false;
  let gatewayReady = false;
  let shutdownStarted = false;
  let lostReason = null;
  let heartbeat = null;
  let destroyedForReason = new Set();

  const assertOwned = () => {
    if (leaseLost || !gatewayReady || shutdownStarted) {
      throw new Error("gateway_lease_not_active");
    }
    return true;
  };

  const destroy = async reason => {
    const key = String(reason || "unspecified");
    if (destroyedForReason.has(key)) return;
    destroyedForReason.add(key);
    await destroyGateway(key);
  };

  const handleLeaseLost = async reason => {
    if (leaseLost) return;
    leaseLost = true;
    gatewayReady = false;
    lostReason = reason;
    try {
      if (typeof onLeaseLost === "function") await onLeaseLost(reason);
    } catch {
      // Observability callback failure must never prevent local Gateway destruction.
    }
    // The adapter's destroyGateway callback must be safe to call while login is
    // pending, and a subsequent post-login destroy is issued if necessary.
    try { await destroy("lease_lost"); } catch { /* remain fail-closed */ }
  };

  heartbeat = startLeaseHeartbeat({
    intervalMs: heartbeatIntervalMs,
    renewTimeoutMs,
    renew: () => renewGatewayLease(db, {
      scope: lease.lease_scope,
      ownerId: lease.owner_id,
      fencingEpoch: lease.fencing_epoch,
      deploymentId,
      ttlSeconds
    }),
    onLeaseLost: handleLeaseLost
  });

  try {
    await loginGateway({
      lease,
      assertOwned,
      // Call this immediately before every privileged Discord side effect.
      // Handlers must not rely on "client ready" alone as proof of ownership.
      fencingEpoch: lease.fencing_epoch
    });

    if (leaseLost || shutdownStarted) {
      gatewayReady = false;
      await destroy("lease_lost_during_login");
      return { ok: false, reason: lostReason || "shutdown_during_login" };
    }

    gatewayReady = true;
  } catch (error) {
    gatewayReady = false;
    heartbeat.stop();
    try { await destroy("gateway_start_failed"); } catch { /* keep original error */ }
    if (!leaseLost) {
      await releaseGatewayLease(db, {
        scope: lease.lease_scope,
        ownerId: lease.owner_id,
        fencingEpoch: lease.fencing_epoch
      }).catch(() => null);
    }
    throw error;
  }

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
