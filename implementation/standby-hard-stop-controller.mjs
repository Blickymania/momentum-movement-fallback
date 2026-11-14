function required(value, name) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200) {
    throw new TypeError(name + "_invalid");
  }
  return value.trim();
}

function leaseIsActive(lease) {
  return lease?.lease_active === true || lease?.lease_active === 1;
}

// Fail-closed transition: an external provider adapter MUST confirm the exact
// primary process is stopped and its Gateway is closed before standby start.
// This module does not implement a provider API; it enforces the stop contract.
export async function startStandbyAfterHardStop({
  leaseStore,
  processControl,
  primary,
  standby,
  startStandby,
  scope = "momentum-movement:discord-gateway"
}) {
  if (!leaseStore || typeof leaseStore.read !== "function" ||
      typeof leaseStore.release !== "function") {
    throw new TypeError("lease_store_read_release_required");
  }
  if (!processControl || typeof processControl.stopAndConfirm !== "function") {
    throw new TypeError("hard_stop_adapter_required");
  }
  if (typeof startStandby !== "function") {
    throw new TypeError("standby_start_callback_required");
  }

  const expectedPrimary = {
    ownerId: required(primary?.ownerId, "primary_owner_id"),
    deploymentId: required(primary?.deploymentId, "primary_deployment_id"),
    processId: required(primary?.processId, "primary_process_id")
  };
  const nextStandby = {
    ownerId: required(standby?.ownerId, "standby_owner_id"),
    deploymentId: required(standby?.deploymentId, "standby_deployment_id")
  };
  if (expectedPrimary.ownerId === nextStandby.ownerId) {
    throw new TypeError("primary_and_standby_owner_must_differ");
  }

  const before = await leaseStore.read(scope);
  if (leaseIsActive(before) && before.owner_id !== expectedPrimary.ownerId) {
    return { ok: false, reason: "unexpected_active_gateway_owner" };
  }

  let stopped;
  try {
    stopped = await processControl.stopAndConfirm({
      ownerId: expectedPrimary.ownerId,
      deploymentId: expectedPrimary.deploymentId,
      processId: expectedPrimary.processId
    });
  } catch {
    return { ok: false, reason: "primary_hard_stop_failed" };
  }

  const stopConfirmed = stopped?.confirmed === true &&
    stopped.state === "stopped" &&
    stopped.gatewayClosed === true &&
    stopped.ownerId === expectedPrimary.ownerId &&
    stopped.deploymentId === expectedPrimary.deploymentId &&
    stopped.processId === expectedPrimary.processId;

  if (!stopConfirmed) {
    return { ok: false, reason: "primary_hard_stop_unverified" };
  }

  // Release only the exact primary lease observed before the hard stop.
  if (before?.owner_id === expectedPrimary.ownerId &&
      before?.fencing_epoch !== undefined &&
      before?.fencing_epoch !== null) {
    await leaseStore.release({
      scope,
      ownerId: expectedPrimary.ownerId,
      fencingEpoch: String(before.fencing_epoch)
    }).catch(() => null);
  }

  const after = await leaseStore.read(scope);
  if (leaseIsActive(after)) {
    return {
      ok: false,
      reason: after.owner_id === expectedPrimary.ownerId
        ? "primary_lease_still_active"
        : "another_gateway_owner_active"
    };
  }

  // startStandby must use the fenced supervisor; it acquires the next lease
  // before client.login. Do not allow a raw client.login callback here.
  let owner;
  try {
    owner = await startStandby({
      leaseStore,
      scope,
      ownerId: nextStandby.ownerId,
      deploymentId: nextStandby.deploymentId
    });
  } catch {
    return { ok: false, reason: "standby_start_failed_after_primary_stop" };
  }

  if (!owner || owner.ok !== true || owner.ready !== true) {
    return {
      ok: false,
      reason: owner?.reason || "standby_lease_or_gateway_not_ready",
      primaryStopped: true
    };
  }

  return {
    ok: true,
    primaryStopped: true,
    standbyOwnerId: nextStandby.ownerId,
    standbyDeploymentId: nextStandby.deploymentId,
    owner
  };
}
