const LEASE_SCOPE = "momentum-movement:bot-005-gateway";
const DEFAULT_TTL_SECONDS = 30;
const MIN_TTL_SECONDS = 10;
const MAX_TTL_SECONDS = 120;
const COACHING_INTERACTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const COACHING_IDEMPOTENCY_SQL = `
CREATE TABLE IF NOT EXISTS coaching_interaction_claims (
  interaction_id TEXT PRIMARY KEY
    CHECK (length(interaction_id) BETWEEN 17 AND 22),
  source TEXT NOT NULL
    CHECK (source IN ('bot005', 'coaching-relay')),
  claimed_at_ms INTEGER NOT NULL
)`;

const COACHING_CLAIM_SQL = `
INSERT INTO coaching_interaction_claims (interaction_id, source, claimed_at_ms)
VALUES (?, ?, ?)
ON CONFLICT (interaction_id) DO NOTHING
RETURNING interaction_id, source, claimed_at_ms`;

const COACHING_CLAIM_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS coaching_interaction_claims_claimed_at_idx
ON coaching_interaction_claims (claimed_at_ms)`;

const COACHING_CLAIM_PRUNE_SQL = `
DELETE FROM coaching_interaction_claims
WHERE claimed_at_ms <= ?`;

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS gateway_ownership (
  lease_scope TEXT PRIMARY KEY
    CHECK (length(lease_scope) BETWEEN 1 AND 200),
  owner_id TEXT NOT NULL
    CHECK (length(owner_id) BETWEEN 1 AND 200),
  fencing_epoch INTEGER NOT NULL
    CHECK (fencing_epoch >= 0),
  lease_until_ms INTEGER NOT NULL,
  heartbeat_at_ms INTEGER NOT NULL,
  deployment_id TEXT NOT NULL
    CHECK (length(deployment_id) BETWEEN 1 AND 200),
  fenced_owner_id TEXT,
  fenced_epoch INTEGER,
  fence_target_owner_id TEXT,
  fence_target_deployment_id TEXT,
  fence_verified_at_ms INTEGER,
  fence_provider TEXT,
  fence_proof_id TEXT
)`;

const ACQUIRE_SQL = `
UPDATE gateway_ownership
SET owner_id = ?,
    fencing_epoch = fencing_epoch + 1,
    lease_until_ms = ?,
    heartbeat_at_ms = ?,
    deployment_id = ?,
    fenced_owner_id = NULL,
    fenced_epoch = NULL,
    fence_target_owner_id = NULL,
    fence_target_deployment_id = NULL,
    fence_verified_at_ms = NULL,
    fence_provider = NULL,
    fence_proof_id = NULL
WHERE lease_scope = ?
  AND lease_until_ms <= ?
  AND fenced_owner_id = owner_id
  AND fenced_epoch = fencing_epoch
  AND fence_target_owner_id = ?
  AND fence_target_deployment_id = ?
RETURNING lease_scope, owner_id, CAST(fencing_epoch AS TEXT) AS fencing_epoch,
          lease_until_ms, heartbeat_at_ms, deployment_id,
          fenced_owner_id, CAST(fenced_epoch AS TEXT) AS fenced_epoch,
          fence_target_owner_id, fence_target_deployment_id,
          fence_verified_at_ms, fence_provider, fence_proof_id`;

const BOOTSTRAP_SQL = `
INSERT INTO gateway_ownership
  (lease_scope, owner_id, fencing_epoch, lease_until_ms, heartbeat_at_ms,
   deployment_id, fenced_owner_id, fenced_epoch, fence_target_owner_id,
   fence_target_deployment_id, fence_verified_at_ms, fence_provider, fence_proof_id)
VALUES
  (?, '__bootstrap__', 0, ?, ?, '__bootstrap__',
   '__bootstrap__', 0, ?, ?, ?, 'operator_attested', ?)
ON CONFLICT (lease_scope) DO NOTHING
RETURNING lease_scope, owner_id, CAST(fencing_epoch AS TEXT) AS fencing_epoch,
          lease_until_ms, heartbeat_at_ms, deployment_id,
          fenced_owner_id, CAST(fenced_epoch AS TEXT) AS fenced_epoch,
          fence_target_owner_id, fence_target_deployment_id,
          fence_verified_at_ms, fence_provider, fence_proof_id`;

const FENCE_CONFIRM_SQL = `
UPDATE gateway_ownership
SET fenced_owner_id = owner_id,
    fenced_epoch = fencing_epoch,
    fence_target_owner_id = ?,
    fence_target_deployment_id = ?,
    fence_verified_at_ms = ?,
    fence_provider = ?,
    fence_proof_id = ?
WHERE lease_scope = ?
  AND owner_id = ?
  AND fencing_epoch = ?
  AND lease_until_ms <= ?
  AND (
    fenced_owner_id IS NULL OR
    (
      fence_target_owner_id = ? AND
      fence_target_deployment_id = ? AND
      fence_provider = ? AND
      fence_proof_id = ?
    )
  )
RETURNING lease_scope, owner_id, CAST(fencing_epoch AS TEXT) AS fencing_epoch,
          lease_until_ms, heartbeat_at_ms, deployment_id,
          fenced_owner_id, CAST(fenced_epoch AS TEXT) AS fenced_epoch,
          fence_target_owner_id, fence_target_deployment_id,
          fence_verified_at_ms, fence_provider, fence_proof_id`;

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
       fenced_owner_id, CAST(fenced_epoch AS TEXT) AS fenced_epoch,
       fence_target_owner_id, fence_target_deployment_id,
       fence_verified_at_ms, fence_provider, fence_proof_id,
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

function requireOwnerDeploymentBinding(owner, deployment, name) {
  if (!owner.startsWith(deployment + ":")) {
    throw new TypeError(name + "_must_be_bound_to_deployment");
  }
}

function requiredEpoch(value) {
  const text = String(value ?? "");
  if (!/^\d{1,16}$/.test(text)) throw new TypeError("fencing_epoch_invalid");
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
      this.sql.exec(COACHING_IDEMPOTENCY_SQL);
      this.sql.exec(COACHING_CLAIM_INDEX_SQL);
    });
  }

  acquire({ scope, ownerId, deploymentId, ttlSeconds = DEFAULT_TTL_SECONDS }) {
    const normalizedScope = requiredString(scope, "scope");
    if (normalizedScope !== LEASE_SCOPE) throw new TypeError("lease_scope_invalid");
    const owner = requiredString(ownerId, "owner_id");
    const deployment = requiredString(deploymentId, "deployment_id");
    requireOwnerDeploymentBinding(owner, deployment, "owner_id");
    const ttl = requiredTtl(ttlSeconds);
    const now = this.now();
    const current = this.read(normalizedScope);
    if (!current) throw new Error("lease_bootstrap_required");
    if (current.lease_active === 1 || current.lease_active === true) return null;
    if (current.fenced_owner_id !== current.owner_id ||
        String(current.fenced_epoch) !== String(current.fencing_epoch) ||
        current.fence_target_owner_id !== owner ||
        current.fence_target_deployment_id !== deployment) {
      throw new Error("hard_fence_required");
    }
    return first(this.sql.exec(
      ACQUIRE_SQL,
      owner,
      now + ttl * 1000,
      now,
      deployment,
      normalizedScope,
      now,
      owner,
      deployment
    ));
  }

  bootstrap({ scope, ownerId, deploymentId, proofId }) {
    const normalizedScope = requiredString(scope, "scope");
    if (normalizedScope !== LEASE_SCOPE) throw new TypeError("lease_scope_invalid");
    const owner = requiredString(ownerId, "owner_id");
    const deployment = requiredString(deploymentId, "deployment_id");
    requireOwnerDeploymentBinding(owner, deployment, "owner_id");
    const proof = requiredString(proofId, "proof_id");
    if (owner === "__bootstrap__" || deployment === "__bootstrap__") {
      throw new TypeError("bootstrap_identity_invalid");
    }
    const now = this.now();
    const row = first(this.sql.exec(
      BOOTSTRAP_SQL,
      normalizedScope,
      now - 1,
      now,
      owner,
      deployment,
      now,
      proof
    ));
    if (!row) throw new Error("lease_bootstrap_already_initialized");
    return row;
  }

  confirmFence({
    scope,
    expectedOwnerId,
    expectedFencingEpoch,
    candidateOwnerId,
    candidateDeploymentId,
    provider,
    proofId
  }) {
    const normalizedScope = requiredString(scope, "scope");
    if (normalizedScope !== LEASE_SCOPE) throw new TypeError("lease_scope_invalid");
    const expectedOwner = requiredString(expectedOwnerId, "expected_owner_id");
    const candidateOwner = requiredString(candidateOwnerId, "candidate_owner_id");
    const candidateDeployment = requiredString(candidateDeploymentId, "candidate_deployment_id");
    const fenceProvider = requiredString(provider, "fence_provider");
    const proof = requiredString(proofId, "proof_id");
    const epoch = requiredEpoch(expectedFencingEpoch);
    const current = this.read(normalizedScope);
    if (!current) throw new Error("lease_bootstrap_required");
    requireOwnerDeploymentBinding(expectedOwner, current.deployment_id, "expected_owner_id");
    requireOwnerDeploymentBinding(candidateOwner, candidateDeployment, "candidate_owner_id");
    const now = this.now();
    const row = first(this.sql.exec(
      FENCE_CONFIRM_SQL,
      candidateOwner,
      candidateDeployment,
      now,
      fenceProvider,
      proof,
      normalizedScope,
      expectedOwner,
      epoch,
      now,
      candidateOwner,
      candidateDeployment,
      fenceProvider,
      proof
    ));
    if (!row) throw new Error("lease_fence_not_confirmed");
    return row;
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

  claimCoachingInteraction({ interactionId, source }) {
    const id = requiredString(interactionId, "interaction_id");
    if (!/^\d{17,22}$/.test(id)) throw new TypeError("interaction_id_invalid");
    if (source !== "bot005" && source !== "coaching-relay") {
      throw new TypeError("coaching_source_invalid");
    }
    const now = this.now();
    this.sql.exec(COACHING_CLAIM_PRUNE_SQL, now - COACHING_INTERACTION_RETENTION_MS);
    const inserted = first(this.sql.exec(COACHING_CLAIM_SQL, id, source, now));
    return Object.freeze({ claimed: Boolean(inserted) });
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
      return json({ ok: true, lease: this.read() });
    }

    if (url.pathname === "/coaching/interaction/claim") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      let body;
      try {
        const raw = await request.text();
        if (raw.length > 4096) return json({ error: "request_too_large" }, 413);
        body = JSON.parse(raw);
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).sort().join(",") !== "interactionId,source") {
        return json({ error: "coaching_claim_invalid" }, 400);
      }
      try {
        const result = this.claimCoachingInteraction(body);
        return json({ ok: true, claimed: result.claimed });
      } catch (error) {
        const reason = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
          ? error.message
          : "coaching_claim_invalid";
        return json({ ok: false, reason }, 400);
      }
    }

    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const paths = {
      "/lease/bootstrap": value => this.bootstrap(value),
      "/lease/fence/confirm": value => this.confirmFence(value),
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
      const result = await action(body);
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
      const conflicts = new Set([
        "lease_bootstrap_required",
        "lease_bootstrap_already_initialized",
        "hard_fence_required",
        "lease_fence_not_confirmed"
      ]);
      return json({ ok: false, reason }, conflicts.has(reason) ? 409 : 400);
    }
  }
}

export const leaseCoordinatorSqlForTests = Object.freeze({
  TABLE_SQL,
  ACQUIRE_SQL,
  BOOTSTRAP_SQL,
  FENCE_CONFIRM_SQL,
  RENEW_SQL,
  RELEASE_SQL,
  READ_SQL,
  COACHING_IDEMPOTENCY_SQL,
  COACHING_CLAIM_SQL,
  COACHING_CLAIM_INDEX_SQL,
  COACHING_CLAIM_PRUNE_SQL
});

export const GATEWAY_LEASE_SCOPE = LEASE_SCOPE;
