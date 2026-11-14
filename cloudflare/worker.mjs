import {
  GatewayLeaseCoordinator,
  GATEWAY_LEASE_SCOPE
} from "./gateway-lease-coordinator.mjs";

export { GatewayLeaseCoordinator };

async function sameSecret(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string" ||
      candidate.length === 0 || expected.length === 0) return false;
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return Response.json({
        status: "ok",
        service: "momentum-movement-gateway-lease",
        mode: "control-plane-only"
      }, { headers: { "cache-control": "no-store" } });
    }

    if (!["GET", "POST"].includes(request.method)) {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }

    const token = env.LEASE_SERVICE_TOKEN || "";
    if (!token) {
      return Response.json({ error: "lease_service_not_configured" }, { status: 503 });
    }
    const authorization = request.headers.get("authorization") || "";
    const prefix = "Bearer ";
    const candidate = authorization.startsWith(prefix) ? authorization.slice(prefix.length) : "";
    if (!await sameSecret(candidate, token)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    if (!["/lease/state", "/lease/acquire", "/lease/renew", "/lease/release"].includes(url.pathname)) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const namespace = env.GATEWAY_LEASE_COORDINATOR;
    if (!namespace) {
      return Response.json({ error: "lease_coordinator_binding_missing" }, { status: 503 });
    }

    const id = namespace.idFromName(GATEWAY_LEASE_SCOPE);
    const stub = namespace.get(id);
    return stub.fetch(request);
  }
};
