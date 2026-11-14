import {
  GatewayLeaseCoordinator,
  GATEWAY_LEASE_SCOPE
} from "./gateway-lease-coordinator.mjs";

export { GatewayLeaseCoordinator };

async function sameSecret(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string" ||
      candidate.length < 32 || candidate.length > 512 ||
      expected.length < 32 || expected.length > 512) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/healthz") {
      return json({
        status: "ok",
        service: "momentum-movement-gateway-lease",
        mode: "control-plane-only"
      });
    }

    const standardRoutes = new Set([
      "/lease/state", "/lease/acquire", "/lease/renew", "/lease/release"
    ]);
    const bootstrapRoute = path === "/lease/bootstrap";
    const fenceRoute = path === "/lease/fence/confirm";

    if (!standardRoutes.has(path) && !bootstrapRoute && !fenceRoute) {
      return json({ error: "not_found" }, 404);
    }

    if (path === "/lease/state" && request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405);
    }
    if (path !== "/lease/state" && request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    // Bootstrap and hard-fence confirmation use different credentials from
    // ordinary lease operations. Candidate bot processes must never possess them.
    const token = bootstrapRoute
      ? env.LEASE_BOOTSTRAP_TOKEN || ""
      : fenceRoute
        ? env.FENCE_CONTROLLER_TOKEN || ""
        : env.LEASE_SERVICE_TOKEN || "";

    if (typeof token !== "string" || token.length < 32 || token.length > 512) {
      return json({ error: "lease_route_not_configured" }, 503);
    }

    const authorization = request.headers.get("authorization") || "";
    const prefix = "Bearer ";
    const candidate = authorization.startsWith(prefix) ? authorization.slice(prefix.length) : "";
    if (!await sameSecret(candidate, token)) {
      return json({ error: "unauthorized" }, 401);
    }

    const namespace = env.GATEWAY_LEASE_COORDINATOR;
    if (!namespace) {
      return json({ error: "lease_coordinator_binding_missing" }, 503);
    }

    const id = namespace.idFromName(GATEWAY_LEASE_SCOPE);
    const stub = namespace.get(id);
    return stub.fetch(request);
  }
};
