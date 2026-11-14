// Shared PostgreSQL lease primitives for Momentum Movement Gateway ownership.
// The caller must use a unique ownerId per process instance, acquire before login,
// and destroy its Discord client immediately if renewal fails.
//
// IMPORTANT: A DB lease is coordination, not physical fencing of an already-open
// Discord socket. Never enable standby takeover against the legacy Bot 005 process
// until the primary uses this protocol and an external controller proves the old
// process/socket is stopped before standby login.

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS gateway_ownership (
  lease_scope text PRIMARY KEY,
  owner_id text NOT NULL,
  fencing_epoch bigint NOT NULL,
  lease_until timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  deployment_id text NOT NULL
)`;

const ACQUIRE_SQL = `
INSERT INTO gateway_ownership
  (lease_scope, owner_id, fencing_epoch, lease_until, heartbeat_at, deployment_id)
VALUES
  ($1, $2, 1, clock_timestamp() + make_interval(secs => $3::double precision),
   clock_timestamp(), $4)
ON CONFLICT (lease_scope) DO UPDATE SET
  owner_id = EXCLUDED.owner_id,
  fencing_epoch = gateway_ownership.fencing_epoch + 1,
  lease_until = clock_timestamp() + make_interval(secs => $3::double precision),
  heartbeat_at = clock_timestamp(),
  deployment_id = EXCLUDED.deployment_id
WHERE gateway_ownership.lease_until <= clock_timestamp()
RETURNING lease_scope, owner_id, fencing_epoch::text AS fencing_epoch,
          lease_until, heartbeat_at, deployment_id`;

const RENEW_SQL = `
UPDATE gateway_ownership
SET lease_until = clock_timestamp() + make_interval(secs => $4::double precision),
    heartbeat_at = clock_timestamp(),
    deployment_id = $5
WHERE lease_scope = $1
  AND owner_id = $2
  AND fencing_epoch = $3::bigint
  AND lease_until > clock_timestamp()
RETURNING lease_scope, owner_id, fencing_epoch::text AS fencing_epoch,
          lease_until, heartbeat_at, deployment_id`;

const RELEASE_SQL = `
UPDATE gateway_ownership
SET lease_until = clock_timestamp() - interval '1 millisecond',
    heartbeat_at = clock_timestamp()
WHERE lease_scope = $1
  AND owner_id = $2
  AND fencing_epoch = $3::bigint
RETURNING lease_scope, owner_id, fencing_epoch::text AS fencing_epoch,
          lease_until, heartbeat_at, deployment_id`;

const READ_SQL = `
SELECT lease_scope, owner_id, fencing_epoch::text AS fencing_epoch,
       lease_until, heartbeat_at, deployment_id,
       lease_until > clock_timestamp() AS lease_active
FROM gateway_ownership
WHERE lease_scope = $1
`;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
    throw new TypeError(name + "_invalid");
  }
  return value.trim();
}

function requiredTtl(value) {
  if (!Number.isInteger(value) || value < 10 || value > 120) {
    throw new RangeError("lease_ttl_seconds_must_be_10_to_120");
  }
  return value;
}

function first(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function ensureLeaseSchema(db) {
  await db.unsafe(TABLE_SQL);
}

export async function acquireGatewayLease(db, {
  scope,
  ownerId,
  deploymentId,
  ttlSeconds = 30
}) {
  const args = [
    requiredString(scope, "scope"),
    requiredString(ownerId, "owner_id"),
    requiredTtl(ttlSeconds),
    requiredString(deploymentId, "deployment_id")
  ];
  // Active leases can never be re-acquired, even by a process presenting the
  // same ownerId. A process must generate a fresh unique ownerId on every start.
  return first(await db.unsafe(ACQUIRE_SQL, args));
}

export async function renewGatewayLease(db, {
  scope,
  ownerId,
  fencingEpoch,
  deploymentId,
  ttlSeconds = 30
}) {
  const epoch = String(fencingEpoch ?? "");
  if (!/^\\d{1,20}$/.test(epoch)) throw new TypeError("fencing_epoch_invalid");
  const args = [
    requiredString(scope, "scope"),
    requiredString(ownerId, "owner_id"),
    epoch,
    requiredTtl(ttlSeconds),
    requiredString(deploymentId, "deployment_id")
  ];
  return first(await db.unsafe(RENEW_SQL, args));
}

export async function releaseGatewayLease(db, { scope, ownerId, fencingEpoch }) {
  const epoch = String(fencingEpoch ?? "");
  if (!/^\\d{1,20}$/.test(epoch)) throw new TypeError("fencing_epoch_invalid");
  return first(await db.unsafe(RELEASE_SQL, [
    requiredString(scope, "scope"),
    requiredString(ownerId, "owner_id"),
    epoch
  ]));
}

export async function readGatewayLease(db, scope) {
  return first(await db.unsafe(READ_SQL, [requiredString(scope, "scope")]));
}

// A heartbeat failure is fail-closed. A slow/hung renewal must not leave the
// Gateway alive indefinitely while its lease expires in the database.
export function startLeaseHeartbeat({
  renew,
  intervalMs = 10000,
  renewTimeoutMs = 7000,
  onLeaseLost,
  onHeartbeat
}) {
  if (typeof renew !== "function" || typeof onLeaseLost !== "function") {
    throw new TypeError("heartbeat_callbacks_required");
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 40000) {
    throw new RangeError("heartbeat_interval_invalid");
  }
  if (!Number.isInteger(renewTimeoutMs) || renewTimeoutMs < 250 || renewTimeoutMs > 60000) {
    throw new RangeError("heartbeat_renew_timeout_invalid");
  }

  let stopped = false;
  let running = false;
  let timer;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
  };

  const lose = async (reason) => {
    if (stopped) return;
    stop();
    await onLeaseLost(reason);
  };

  const beat = async () => {
    if (stopped || running) return;
    running = true;
    let timeout;
    try {
      const result = await Promise.race([
        Promise.resolve().then(renew),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("lease_renewal_timeout")), renewTimeoutMs);
          timeout.unref?.();
        })
      ]);
      if (!result) {
        await lose("lease_not_renewed");
        return;
      }
      if (typeof onHeartbeat === "function") await onHeartbeat(result);
    } catch (error) {
      const reason = error instanceof Error && error.message === "lease_renewal_timeout"
        ? "lease_renewal_timeout"
        : "lease_renewal_error";
      await lose(reason);
    } finally {
      if (timeout) clearTimeout(timeout);
      running = false;
    }
  };

  timer = setInterval(() => { void beat(); }, intervalMs);
  timer.unref?.();
  return { stop, beat };
}

export const leaseSqlForTests = Object.freeze({
  TABLE_SQL,
  ACQUIRE_SQL,
  RENEW_SQL,
  RELEASE_SQL,
  READ_SQL
});
