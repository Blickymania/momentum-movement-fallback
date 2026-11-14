import postgres from "postgres@3.4.7";

const SERVICE = "Momentum Movement Core Shadow";
const COMMUNITY = "Momentum Movement";
const MODE = "shadow-preflight";
const TEST_LOCK_CLASS = 19789;
const TEST_LOCK_KEY = 20261114;
const startedAt = Date.now();
let cached = null;
let cacheTime = 0;
let inFlight = null;

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}

async function testDatabaseAndAdvisoryLock() {
  const url = Bun.env.DATABASE_URL || "";
  if (!url) return { ok: false, reason: "database_url_missing" };

  const options = {
    max: 1,
    connect_timeout: 8,
    idle_timeout: 2,
    ssl: "require"
  };
  const first = postgres(url, options);
  const second = postgres(url, options);
  let firstHeld = false;
  let secondHeld = false;

  try {
    const ping = await first.unsafe("SELECT 1 AS ok");
    if (Number(ping[0]?.ok) !== 1) throw new Error("database_ping_failed");

    const acquiredFirst = await first.unsafe(
      "SELECT pg_try_advisory_lock(" + TEST_LOCK_CLASS + ", " + TEST_LOCK_KEY + ") AS acquired"
    );
    firstHeld = acquiredFirst[0]?.acquired === true;
    if (!firstHeld) throw new Error("diagnostic_lock_unexpectedly_busy");

    const acquiredSecond = await second.unsafe(
      "SELECT pg_try_advisory_lock(" + TEST_LOCK_CLASS + ", " + TEST_LOCK_KEY + ") AS acquired"
    );
    secondHeld = acquiredSecond[0]?.acquired === true;
    if (secondHeld) {
      await second.unsafe(
        "SELECT pg_advisory_unlock(" + TEST_LOCK_CLASS + ", " + TEST_LOCK_KEY + ")"
      );
      secondHeld = false;
      throw new Error("advisory_lock_not_exclusive");
    }

    const releasedFirst = await first.unsafe(
      "SELECT pg_advisory_unlock(" + TEST_LOCK_CLASS + ", " + TEST_LOCK_KEY + ") AS released"
    );
    firstHeld = false;
    if (releasedFirst[0]?.released !== true) throw new Error("advisory_lock_release_failed");

    const acquiredAfterRelease = await second.unsafe(
      "SELECT pg_try_advisory_lock(" + TEST_LOCK_CLASS + ", " + TEST_LOCK_KEY + ") AS acquired"
    );
    secondHeld = acquiredAfterRelease[0]?.acquired === true;
    if (!secondHeld) throw new Error("advisory_lock_not_reusable");

    await second.unsafe(
      "SELECT pg_advisory_unlock(" + TEST_LOCK_CLASS + ", " + TEST_LOCK_KEY + ")"
    );
    secondHeld = false;

    return {
      ok: true,
      databasePing: true,
      exclusiveOwnership: true,
      releaseAndReacquire: true,
      testLockNamespace: "diagnostic-only"
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.name : "database_test_failed"
    };
  } finally {
    if (firstHeld) {
      await first.unsafe(
        "SELECT pg_advisory_unlock(" + TEST_LOCK_CLASS + ", " + TEST_LOCK_KEY + ")"
      ).catch(() => {});
    }
    if (secondHeld) {
      await second.unsafe(
        "SELECT pg_advisory_unlock(" + TEST_LOCK_CLASS + ", " + TEST_LOCK_KEY + ")"
      ).catch(() => {});
    }
    await Promise.all([
      first.end({ timeout: 5 }).catch(() => {}),
      second.end({ timeout: 5 }).catch(() => {})
    ]);
  }
}

async function probePrimary() {
  const target = Bun.env.PRIMARY_HEALTH_URL || "";
  if (!target) return { configured: false, reachable: false, gatewayReady: false };

  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(2500) });
    const body = await response.json().catch(() => ({}));
    const gatewayReady = response.ok &&
      body.gatewayReady === true &&
      body.guildVerified === true;
    return {
      configured: true,
      reachable: response.ok,
      httpStatus: response.status,
      gatewayReady
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      gatewayReady: false,
      reason: "primary_probe_unavailable"
    };
  }
}

async function runReadiness() {
  const [database, primary] = await Promise.all([
    testDatabaseAndAdvisoryLock(),
    probePrimary()
  ]);
  return {
    checkedAt: new Date().toISOString(),
    ok: database.ok,
    state: database.ok ? "standby_preflight_ready" : "database_preflight_failed",
    service: SERVICE,
    community: COMMUNITY,
    mode: MODE,
    database,
    primary,
    gatewayEnabled: false,
    takeoverEnabled: false,
    discordWritesEnabled: false,
    note: "Preflight only. Bot 005 remains the sole Gateway owner until both services implement the same production lease protocol."
  };
}

async function readiness() {
  if (cached && Date.now() - cacheTime < 30000) return cached;
  if (!inFlight) {
    inFlight = runReadiness()
      .then(value => {
        cached = value;
        cacheTime = Date.now();
        return value;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

Bun.serve({
  hostname: "0.0.0.0",
  port: Number(Bun.env.PORT || 3000),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== "GET") return json({ error: "read_only_shadow" }, 405);

    if (path === "/healthz") {
      return json({
        status: "ok",
        service: SERVICE,
        community: COMMUNITY,
        mode: MODE,
        gatewayEnabled: false,
        takeoverEnabled: false,
        discordWritesEnabled: false,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
      });
    }

    if (path === "/readyz" || path === "/preflight") {
      const result = await readiness();
      return json(result, result.ok ? 200 : 503);
    }

    return json({ error: "not_found" }, 404);
  }
});

console.log(JSON.stringify({
  event: "momentum_core_shadow_preflight_started",
  mode: MODE,
  gatewayEnabled: false,
  takeoverEnabled: false,
  discordWritesEnabled: false
}));

void readiness().then(result => {
  console.log(JSON.stringify({
    event: "momentum_core_shadow_preflight_result",
    ok: result.ok,
    state: result.state,
    database: result.database,
    primary: result.primary,
    checkedAt: result.checkedAt
  }));
}).catch(error => {
  console.error(JSON.stringify({
    event: "momentum_core_shadow_preflight_error",
    kind: error instanceof Error ? error.name : "unknown"
  }));
});
