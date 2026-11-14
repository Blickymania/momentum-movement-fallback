const LEASE_SCOPE = "momentum-movement:discord-gateway";
const DEFAULT_TTL_SECONDS = 30;
const MIN_TTL_SECONDS = 10;
const MAX_TTL_SECONDS = 120;

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS gateway_ownership (
  lease_scope TEXT PRIMARY KEY
    CHECK (length(lease_scope) BETWEEN 1 AND 200),
  owner_id TEXT NOT NULL
    CHECK (length(owner_id) BETWEEN 1 AND 200),
  fencing_epoch INTEGER NOT NULL
    CHECK (fencing_epoch >= 1),
  lease_until_ms INTEGER NOT NULL,
  heartbeat_at_ms INTEGER NOT NULL,
  deployment_id TEXT NOT NULL
    CHECK (length(deployment_id) BETWEEN 1 AND 200)
)`;

const ACQUIRE_SQL = `
INSERT INTO gateway_ownership
  (lease_scope, owner_id, fencing_epoch, lease_until_ms, heartbeat_at_ms, deployment_id)
VALUES
  (?, ?, 1, ?, ?, ?)
ON CONFLICT (lease_scope) DO UPDATE SET
  owner_id = excluded.owner_id,
  fencing_epoch = gateway_ownership.fencing_epoch + 1,
  lease_until_ms = excluded.lease_until_ms,
  heartbeat_at_ms = excluded.heartbeat_at_ms,
  deployment_id = excluded.deployment_id
WHERE gateway_ownership.lease_until_ms <= ?
RETURNING lease_scope, owner_id, CAST(fencing_epoch AS TEXT) AS fencing_epoch, lease_until_ms,
          heartbeat_at_ms, deployment_id`;

const RENEW_SQL = `
UPDATE gateway_ownership
SET lease_until_ms = ?,
    heartbeat_at_ms = ?,
    deployment_id = ?
WHERE lease_scope = ?
  AND owner_id = ?
  AND fencing_epoch = ?
  AND lease_until_ms > ?
RETURNING lease_scope, owner_id, CAST(fencing_epoch AS TEXT) AS fencing_epoch, lease_until_ms,
          heartbeat_at_ms, deployment_id`;

const RELEASE_SQL = `
UPDATE gateway_ownership
SET lease_until_ms = ?,
    heartbeat_at_ms = ?
WHERE lease_scope = ?
  AND owner_id = ?
  AND fencing_epoch = ?
RETURNING lease_scope, owner_id, CAST(fencing_epoch AS TEXT) AS fencing_epoch, lease_until_ms,
          heartbeat_at_ms, deployment_id`;

const READ_SQL = `
SELECT lease_scope, owner_id, CAST(fencing_epoch AS TEXT) AS fencing_epoch, lease_until_ms,
       heartbeat_at_ms, deployment_id,
       lease_until_ms > ? AS lease_active
FROM gateway_ownership
WHERE lease_scope = ?`;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
    throw new TypeError(name + "_invalid");
  }
  return value.trim();
}

function requiredTtl(value = DEFAULT_TTL_SECONDS) {
  if (!Number.isInteger(value) || value < MIN_TTL_SECONDS || value > MAX_TTL_SECONDS) {
    throw new RangeError("lease_ttl_seconds_must_be_10_to_120");
  }
  return value;
}

function requiredEpoch(value) {
  const text = String(value ?? "");
  if (!/^\\d{1,16}$/.test(text)) throw new TypeError("fencing_epoch_invalid");
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError("fencing_epoch_invalid");
  }
  return number;
}

function first(cursor) {
  const rows = cursor?.toArray ? cursor.toArray() : Array.from(cursor || []);
  return rows.length ? rows[0] : null;
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export class GatewayLeaseCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.now = () => Date.now();

    // Do not serve any request until the durable schema is ready.
    ctx.blockConcurrencyWhile(() => {
      this.sql.exec(TABLE_SQL);
    });
  }

  acquire({ scope, ownerId, deploymentId, ttlSeconds = DEFAULT_TTL_SECONDS }) {
    const normalizedScope = requiredString(scope, "scope");
    if (normalizedScope !== LEASE_SCOPE) throw new TypeError("lease_scope_invalid");
    const owner = requiredString(ownerId, "owner_id");
    const deployment = requiredString(deploymentId, "deployment_id");
    const ttl = requiredTtl(ttlSeconds);
    const now = this.now();
    return first(this.sql.exec(
      ACQUIRE_SQL,
      normalizedScope,
      owner,
      now + ttl * 1000,
      now,
      deployment,
      now
    ));
  }

  renew({ scope, ownerId, fencingEpoch, deploymentId, ttlSeconds = DEFAULT_TTL_SECONDS }) {
    const normalizedScope = requiredString(scope, "scope");
    if (normalizedScope !== LEASE_SCOPE) throw new TypeError("lease_scope_invalid");
    const owner = requiredString(ownerId, "owner_id");
    const deployment = requiredString(deploymentId, "deployment_id");
    const ttl = requiredTtl(ttlSeconds);
    const epoch = requiredEpoch(fencingEpoch);
    const now = this.now();
    return first(this.sql.exec(
      RENEW_SQL,
      now + ttl * 1000,
      now,
      deployment,
      normalizedScope,
      owner,
      Number(epoch),
      now
    ));
  }

  release({ scope, ownerId, fencingEpoch }) {
    const normalizedScope = requiredString(scope, "scope");
    if (normalizedScope !== LEASE_SCOPE) throw new TypeError("lease_scope_invalid");
    const owner = requiredString(ownerId, "owner_id");
    const epoch = requiredEpoch(fencingEpoch);
    const now = this.now();
    return first(this.sql.exec(
      RELEASE_SQL,
      now - 1,
      now,
      normalizedScope,
      owner,
      Number(epoch)
    ));
  }

  read(scope = LEASE_SCOPE) {
    const normalizedScope = requiredString(scope, "scope");
    if (normalizedScope !== LEASE_SCOPE) throw new TypeError("lease_scope_invalid");
    return first(this.sql.exec(READ_SQL, this.now(), normalizedScope));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ status: "ok", service: "momentum-movement-gateway-lease", mode: "control-plane-only" });
    }

    if (url.pathname === "/lease/state") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return json({ lease: this.read() });
    }

    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const paths = {
      "/lease/acquire": value => this.acquire(value),
      "/lease/renew": value => this.renew(value),
      "/lease/release": value => this.release(value)
    };
    const action = paths[url.pathname];
    if (!action) return json({ error: "not_found" }, 404);

    let body;
    try {
      const raw = await request.text();
      if (raw.length > 4096) return json({ error: "request_too_large" }, 413);
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    try {
      const result = action(body);
      if (url.pathname === "/lease/acquire" && !result) {
        return json({ ok: false, reason: "lease_unavailable" }, 409);
      }
      if ((url.pathname === "/lease/renew" || url.pathname === "/lease/release") && !result) {
        return json({ ok: false, reason: "lease_not_owned" }, 409);
      }
      return json({ ok: true, lease: result });
    } catch (error) {
      const reason = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
        ? error.message
        : "lease_request_invalid";
      return json({ error: reason }, 400);
    }
  }
}

export const leaseCoordinatorSqlForTests = Object.freeze({
  TABLE_SQL,
  ACQUIRE_SQL,
  RENEW_SQL,
  RELEASE_SQL,
  READ_SQL
});

export const GATEWAY_LEASE_SCOPE = LEASE_SCOPE;
