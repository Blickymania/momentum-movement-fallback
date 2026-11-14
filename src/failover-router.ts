type RouterEnv = {
  MANAGER_PRIMARY_ORIGIN?: string;
  RAILWAY_FALLBACK_ORIGIN?: string;
  RENDER_FALLBACK_ORIGIN?: string;
};

type Candidate = { name: string; value?: string; timeoutMs: number };
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
    { name: "cloudflare-primary", value: env.MANAGER_PRIMARY_ORIGIN, timeoutMs: 4000 },
    { name: "railway-secondary", value: env.RAILWAY_FALLBACK_ORIGIN, timeoutMs: 5000 },
    // Render Free sleeps after inactivity; allow its documented cold-start window.
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
    const ready = response.status === 200
      && body?.status === "ready"
      && body?.manager === MANAGER_NAME
      && body?.discordVerified === true;
    if (response.body) await response.body.cancel().catch(() => {});
    return { name: candidate.name, ready, reason: ready ? "ready" : "readiness_rejected" };
  } catch (error) {
    return {
      name: candidate.name,
      ready: false,
      reason: error instanceof Error && error.name === "TimeoutError" ? "probe_timeout" : "origin_unreachable"
    };
  }
}

async function chooseOrigin(env: RouterEnv): Promise<{ name: string; origin: string } | null> {
  for (const candidate of candidates(env)) {
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

export default {
  async fetch(request: Request, env: RouterEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" && request.method === "GET") {
      return json({ status: "ok", service: "dawn-dotta-failover-router" });
    }

    if (url.pathname === "/_failover/status" && request.method === "GET") {
      const results = await inspectOrigins(env);
      return json({ status: results.some(x => x.ready) ? "ready" : "not_ready", origins: results }, results.some(x => x.ready) ? 200 : 503);
    }

    const selected = await chooseOrigin(env);
    if (!selected) return json({ error: "no_verified_manager_origin_available" }, 503);

    if (url.pathname === "/readyz" && request.method === "GET") {
      return json({ status: "ready", manager: MANAGER_NAME, selectedOrigin: selected.name });
    }

    // Forward the incoming MCP/OAuth request to one selected origin exactly
    // once. Never retry a timed-out POST: Discord may already have applied it.
    try {
      return await fetch(new Request(forwardUrl(request.url, selected.origin), request));
    } catch (error) {
      console.error(JSON.stringify({
        event: "manager_origin_transport_failed",
        selectedOrigin: selected.name,
        errorType: error instanceof Error ? error.name : "unknown"
      }));
      return json({ error: "selected_manager_origin_transport_failed", selectedOrigin: selected.name }, 502);
    }
  }
};
