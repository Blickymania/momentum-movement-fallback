import { DurableObject } from "cloudflare:workers";
import { acquireLeaseState, renewLeaseState, checkLeaseState, releaseLeaseState } from "../listener/lease-state.mjs";

const SERVICE = "momentum-movement-live-events-listener";
const MIN_TTL_SECONDS = 15;
const MAX_TTL_SECONDS = 90;
const PATHS = ["/v1/lease/acquire", "/v1/lease/renew", "/v1/lease/check", "/v1/lease/release"];

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const validInstanceId = value => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const validFence = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

export class MomentumMovementLease extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.ctx.blockConcurrencyWhile(() => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS listener_lease (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )`);
    });
  }

  #read() {
    const row = this.sql.exec("SELECT owner_id, fencing_token, expires_at_ms FROM listener_lease WHERE id = 1").toArray()[0];
    return row ? { ownerId: row.owner_id, fencingToken: Number(row.fencing_token), expiresAtMs: Number(row.expires_at_ms) } : null;
  }

  #write(state, nowMs) {
    this.sql.exec(`INSERT INTO listener_lease (id, owner_id, fencing_token, expires_at_ms, updated_at_ms)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id,
        fencing_token = excluded.fencing_token, expires_at_ms = excluded.expires_at_ms,
        updated_at_ms = excluded.updated_at_ms`,
      state.ownerId, state.fencingToken, state.expiresAtMs, nowMs);
  }

  async fetch(request) {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const path = new URL(request.url).pathname;
    if (!PATHS.includes(path)) return json({ error: "not_found" }, 404);
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
    if (!validInstanceId(body?.instanceId)) return json({ error: "invalid_instance_id" }, 400);
    const ttlSeconds = Number(body?.ttlSeconds ?? 60);
    if ((path === "/v1/lease/acquire" || path === "/v1/lease/renew") &&
        (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS)) {
      return json({ error: "invalid_ttl" }, 400);
    }
    if (path !== "/v1/lease/acquire" && !validFence(body?.fencingToken)) {
      return json({ error: "invalid_fencing_token" }, 400);
    }

    const nowMs = Date.now();
    const outcome = this.ctx.storage.transactionSync(() => {
      const current = this.#read();
      if (path === "/v1/lease/check") {
        return { valid: checkLeaseState(current, body.instanceId, body.fencingToken, nowMs) };
      }
      const transition = path === "/v1/lease/acquire"
        ? acquireLeaseState(current, body.instanceId, nowMs, ttlSeconds * 1_000)
        : path === "/v1/lease/renew"
          ? renewLeaseState(current, body.instanceId, body.fencingToken, nowMs, ttlSeconds * 1_000)
          : releaseLeaseState(current, body.instanceId, body.fencingToken, nowMs);
      if (transition.state && transition.state !== current) this.#write(transition.state, nowMs);
      return transition.result;
    });

    if (path === "/v1/lease/acquire") return json(outcome, outcome.acquired ? 200 : 409);
    if (path === "/v1/lease/renew") return json(outcome, outcome.valid ? 200 : 409);
    if (path === "/v1/lease/release") return json(outcome, outcome.released ? 200 : 409);
    return json(outcome, outcome.valid ? 200 : 409);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: SERVICE, version: 1 });
    }
    if (request.method !== "POST" || !PATHS.includes(url.pathname)) return json({ error: "not_found" }, 404);
    const expected = env.LEASE_CONTROL_TOKEN;
    const supplied = request.headers.get("authorization") || "";
    if (!expected || !safeEqual(supplied, `Bearer ${expected}`)) return json({ error: "unauthorized" }, 401);
    const id = env.LEASE_COORDINATOR.idFromName(SERVICE);
    return env.LEASE_COORDINATOR.get(id).fetch(request);
  },
};
