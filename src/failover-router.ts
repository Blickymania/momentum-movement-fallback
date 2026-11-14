type RouterEnv = {
  NORTHFLANK_MANAGER_ORIGIN?: string;
  RAILWAY_FALLBACK_ORIGIN?: string;
  CLOUDFLARE_WORKER_FALLBACK_ORIGIN?: string;
  RENDER_FALLBACK_ORIGIN?: string;
};

type Candidate = { name: string; value?: string; timeoutMs: number; allowLegacyReadiness?: boolean };
type ProbeResult = { name: string; ready: boolean; reason: string };

const MANAGER_NAME = "Dawn Dotta Discord Manager";

function cleanOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function candidates(env: RouterEnv): Candidate[] {
  return [
    // Preferred independent persistent Bun host; requires explicit DB readiness.
    { name: "northflank-primary", value: env.NORTHFLANK_MANAGER_ORIGIN, timeoutMs: 15000 },
    // Existing working production origin; legacy /readyz does not yet report DB verification.
    { name: "railway-legacy-secondary", value: env.RAILWAY_FALLBACK_ORIGIN, timeoutMs: 15000, allowLegacyReadiness: true },
    // Optional Worker port; only eligible after its real Hyperdrive/D1 dependencies are provisioned and tested.
    { name: "cloudflare-worker-tertiary", value: env.CLOUDFLARE_WORKER_FALLBACK_ORIGIN, timeoutMs: 12000 },
    // Render Free may sleep; this is an emergency cold fallback, not an always-on host.
    { name: "render-cold-fallback", value: env.RENDER_FALLBACK_ORIGIN, timeoutMs: 70000 }
  ];
}

async function probe(candidate: Candidate): Promise<ProbeResult> {
  const origin = cleanOrigin(candidate.value);
  if (!origin) return { name: candidate.name, ready: false, reason: "origin_not_configured" };

  try {
    const response = await fetch(new URL("/readyz", origin), {
      method: "GET",
      headers: { accept: "application/json", "cache-control": "no-cache" },
      redirect: "manual",
      signal: AbortSignal.timeout(candidate.timeoutMs)
    });
    const body = await response.json().catch(() => null);
    const databaseReady = body?.oauthDatabaseVerified === true
      || (candidate.allowLegacyReadiness === true && body?.oauthDatabaseVerified === undefined);
    const ready = response.status === 200
      && body?.status === "ready"
      && body?.manager === MANAGER_NAME
      && body?.discordVerified === true
      && databaseReady;
    if (response.body) await response.body.cancel().catch(() => {});
    return {
      name: candidate.name,
      ready,
      reason: ready ? "ready" : body?.oauthDatabaseVerified === false ? "oauth_database_unverified" : "readiness_rejected"
    };
  } catch (error) {
    return {
      name: candidate.name,
      ready: false,
      reason: error instanceof Error && error.name === "TimeoutError" ? "probe_timeout" : "origin_unreachable"
    };
  }
}

async function chooseOrigin(env: RouterEnv, excluded: Set<string> = new Set()): Promise<{ name: string; origin: string } | null> {
  for (const candidate of candidates(env)) {
    if (excluded.has(candidate.name)) continue;
    const origin = cleanOrigin(candidate.value);
    if (!origin) continue;
    const status = await probe(candidate);
    if (status.ready) return { name: candidate.name, origin };
  }
  return null;
}

async function inspectOrigins(env: RouterEnv): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const candidate of candidates(env)) results.push(await probe(candidate));
  return results;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function forwardUrl(incomingUrl: string, origin: string): string {
  const target = new URL(incomingUrl);
  const upstream = new URL(origin);
  target.protocol = upstream.protocol;
  target.host = upstream.host;
  target.username = "";
  target.password = "";
  return target.toString();
}

const RETRYABLE_READ_STATUSES = new Set([502, 503, 504]);

export default {
  async fetch(request: Request, env: RouterEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" && request.method === "GET") {
      return json({ status: "ok", service: "dawn-dotta-failover-router" });
    }

    if (url.pathname === "/_failover/status" && request.method === "GET") {
      const results = await inspectOrigins(env);
      const ready = results.some(x => x.ready);
      return json({ status: ready ? "ready" : "not_ready", origins: results }, ready ? 200 : 503);
    }

    const selected = await chooseOrigin(env);
    if (!selected) return json({ error: "no_verified_manager_origin_available" }, 503);

    if (url.pathname === "/readyz" && request.method === "GET") {
      return json({
        status: "ready",
        manager: MANAGER_NAME,
        discordVerified: true,
        oauthDatabaseVerified: true,
        selectedOrigin: selected.name
      });
    }

    // Writes are sent to exactly one verified origin and are never replayed.
    // Only safe GET/HEAD requests can move to another origin after transport
    // errors or transient gateway errors.
    const safeRead = request.method === "GET" || request.method === "HEAD";
    const excluded = new Set<string>();
    let current: { name: string; origin: string } | null = selected;
    let lastRetryableResponse: Response | null = null;

    while (current) {
      excluded.add(current.name);
      try {
        const response = await fetch(new Request(forwardUrl(request.url, current.origin), request));
        if (safeRead && RETRYABLE_READ_STATUSES.has(response.status)) {
          lastRetryableResponse = response;
          if (response.body) await response.body.cancel().catch(() => {});
          current = await chooseOrigin(env, excluded);
          if (current) continue;
          return lastRetryableResponse;
        }
        return response;
      } catch (error) {
        console.error(JSON.stringify({
          event: "manager_origin_transport_failed",
          selectedOrigin: current.name,
          safeRead,
          errorType: error instanceof Error ? error.name : "unknown"
        }));
        if (!safeRead) break;
        current = await chooseOrigin(env, excluded);
      }
    }

    if (lastRetryableResponse) return lastRetryableResponse;
    return json({ error: "selected_manager_origin_transport_failed", selectedOrigin: selected.name }, 502);
  }
};
