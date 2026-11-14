const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS coaching_interaction_claims (
  interaction_id TEXT PRIMARY KEY
    CHECK (length(interaction_id) BETWEEN 17 AND 22),
  source TEXT NOT NULL
    CHECK (source IN ('bot005', 'coaching-relay')),
  claimed_at_ms INTEGER NOT NULL
)`;

const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS coaching_interaction_claims_claimed_at_idx
ON coaching_interaction_claims (claimed_at_ms)`;

const CLAIM_SQL = `
INSERT INTO coaching_interaction_claims (interaction_id, source, claimed_at_ms)
VALUES (?, ?, ?)
ON CONFLICT (interaction_id) DO NOTHING
RETURNING interaction_id, source, claimed_at_ms`;

const PRUNE_SQL = `
DELETE FROM coaching_interaction_claims
WHERE claimed_at_ms <= ?`;

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function first(cursor) {
  const rows = cursor?.toArray ? cursor.toArray() : Array.from(cursor || []);
  return rows.length ? rows[0] : null;
}

function requiredInteractionId(value) {
  if (typeof value !== "string" || !/^\d{17,22}$/.test(value)) {
    throw new TypeError("interaction_id_invalid");
  }
  return value;
}

function requiredSource(value) {
  if (value !== "bot005" && value !== "coaching-relay") {
    throw new TypeError("coaching_source_invalid");
  }
  return value;
}

export class CoachingInteractionIdempotency {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.now = () => Date.now();
    ctx.blockConcurrencyWhile(() => {
      this.sql.exec(TABLE_SQL);
      this.sql.exec(INDEX_SQL);
    });
  }

  claim({ interactionId, source }) {
    const id = requiredInteractionId(interactionId);
    const sender = requiredSource(source);
    const now = this.now();
    this.sql.exec(PRUNE_SQL, now - RETENTION_MS);
    const row = first(this.sql.exec(CLAIM_SQL, id, sender, now));
    return Object.freeze({ claimed: Boolean(row) });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({
        status: "ok",
        service: "coaching-interaction-idempotency",
        ready: true
      });
    }
    if (request.method !== "POST" || url.pathname !== "/claim") {
      return json({ error: "not_found" }, 404);
    }

    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 2048) {
        return json({ error: "request_too_large" }, 413);
      }
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).sort().join(",") !== "interactionId,source") {
      return json({ error: "coaching_claim_invalid" }, 400);
    }

    try {
      const result = this.claim({
        interactionId: body.interactionId,
        source: body.source
      });
      return json({ ok: true, claimed: result.claimed, duplicate: !result.claimed });
    } catch (error) {
      const reason = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
        ? error.message
        : "coaching_claim_invalid";
      return json({ ok: false, reason }, 400);
    }
  }
}

export const coachingInteractionIdempotencySqlForTests = Object.freeze({
  TABLE_SQL,
  INDEX_SQL,
  CLAIM_SQL,
  PRUNE_SQL
});
