export function acquireLeaseState(current, instanceId, nowMs, ttlMs) {
  assertInputs(instanceId, nowMs, ttlMs);
  if (current && current.expiresAtMs > nowMs) {
    if (current.ownerId === instanceId) {
      const state = { ...current, expiresAtMs: nowMs + ttlMs };
      return {
        state,
        result: { acquired: true, fencingToken: String(state.fencingToken), expiresAtMs: state.expiresAtMs },
      };
    }
    return { state: current, result: { acquired: false, expiresAtMs: current.expiresAtMs } };
  }
  const fencingToken = current ? current.fencingToken + 1 : 1;
  if (!Number.isSafeInteger(fencingToken)) throw new Error("fencing token exhausted safe integer range");
  const state = { ownerId: instanceId, fencingToken, expiresAtMs: nowMs + ttlMs };
  return { state, result: { acquired: true, fencingToken: String(fencingToken), expiresAtMs: state.expiresAtMs } };
}

export function renewLeaseState(current, instanceId, fencingToken, nowMs, ttlMs) {
  assertInputs(instanceId, nowMs, ttlMs);
  if (!ownsLiveLease(current, instanceId, fencingToken, nowMs)) {
    return { state: current, result: { valid: false } };
  }
  const state = { ...current, expiresAtMs: nowMs + ttlMs };
  return { state, result: { valid: true, fencingToken: String(state.fencingToken), expiresAtMs: state.expiresAtMs } };
}

export function checkLeaseState(current, instanceId, fencingToken, nowMs) {
  return ownsLiveLease(current, instanceId, fencingToken, nowMs);
}

export function releaseLeaseState(current, instanceId, fencingToken, nowMs) {
  if (!ownsLiveLease(current, instanceId, fencingToken, nowMs)) {
    return { state: current, result: { released: false } };
  }
  const state = { ...current, expiresAtMs: nowMs };
  return { state, result: { released: true, fencingToken: String(state.fencingToken) } };
}

function ownsLiveLease(current, instanceId, fencingToken, nowMs) {
  return Boolean(current && current.ownerId === instanceId &&
    current.fencingToken === Number(fencingToken) &&
    Number.isSafeInteger(Number(fencingToken)) && current.expiresAtMs > nowMs);
}

function assertInputs(instanceId, nowMs, ttlMs) {
  if (typeof instanceId !== "string" || !/^[0-9a-f-]{36}$/i.test(instanceId)) throw new Error("instanceId must be a UUID");
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("nowMs must be a non-negative safe integer");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 15_000 || ttlMs > 90_000) throw new Error("ttlMs must be between 15000 and 90000");
}
