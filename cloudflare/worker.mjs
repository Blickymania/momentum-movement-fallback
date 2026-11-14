import {
  GatewayLeaseCoordinator,
  GATEWAY_LEASE_SCOPE
} from "./gateway-lease-coordinator.mjs";
import { CoachingInteractionIdempotency } from "./coaching-interaction-idempotency.mjs";
import { createRenderServiceFencer } from "../implementation/render-service-fencer.mjs";

export { GatewayLeaseCoordinator, CoachingInteractionIdempotency };

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

function objectStub(env) {
  const namespace = env.GATEWAY_LEASE_COORDINATOR;
  if (!namespace) throw new Error("lease_coordinator_binding_missing");
  const id = namespace.idFromName(GATEWAY_LEASE_SCOPE);
  return namespace.get(id);
}

function coachingIdempotencyStub(env) {
  const namespace = env.COACHING_IDEMPOTENCY_STORE;
  if (!namespace) throw new Error("coaching_idempotency_binding_missing");
  const id = namespace.idFromName("momentum-movement:coaching-interaction-idempotency");
  return namespace.get(id);
}

async function internalLeaseRead(stub) {
  const response = await stub.fetch(new Request("https://lease.internal/lease/state"));
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error("lease_state_response_invalid"); }
  if (!response.ok || payload?.ok !== true) throw new Error("lease_state_unavailable");
  return payload.lease;
}

async function claimCoachingInteraction(request, env) {
  const token = env.COACHING_IDEMPOTENCY_TOKEN || "";
  if (typeof token !== "string" || token.length < 32 || token.length > 512) {
    return json({ error: "coaching_idempotency_not_configured" }, 503);
  }
  const authorization = request.headers.get("authorization") || "";
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!await sameSecret(candidate, token)) return json({ error: "unauthorized" }, 401);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "request_too_large" }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "interactionId,source" ||
      typeof body.interactionId !== "string" || !/^\d{17,22}$/.test(body.interactionId) ||
      (body.source !== "bot005" && body.source !== "coaching-relay")) {
    return json({ error: "coaching_claim_invalid" }, 400);
  }
  let stub;
  try { stub = coachingIdempotencyStub(env); }
  catch { return json({ error: "coaching_idempotency_binding_missing" }, 503); }
  try {
    const response = await stub.fetch(new Request("https://coaching-idempotency.internal/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }));
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error("coaching_claim_response_invalid"); }
    if (!response.ok || payload?.ok !== true || typeof payload.claimed !== "boolean") {
      throw new Error("coaching_claim_unavailable");
    }
    return json({ ok: true, claimed: payload.claimed, duplicate: !payload.claimed });
  } catch { return json({ error: "coaching_claim_unavailable" }, 503); }
}
async function internalFenceConfirm(stub, input) {
  const response = await stub.fetch(new Request("https://lease.internal/lease/fence/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }));
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error("lease_fence_response_invalid"); }
  if (!response.ok || payload?.ok !== true) {
    const reason = typeof payload?.reason === "string" && /^[a-z0-9_]{1,80}$/.test(payload.reason)
      ? payload.reason
      : "lease_fence_not_confirmed";
    throw new Error(reason);
  }
  return payload.lease;
}

async function fenceCandidate(request, env) {
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: "request_too_large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "candidateDeploymentId,candidateOwnerId" ||
      typeof body.candidateDeploymentId !== "string" ||
      typeof body.candidateOwnerId !== "string" ||
      body.candidateDeploymentId.length > 100 ||
      body.candidateOwnerId.length > 200 ||
      !body.candidateOwnerId.startsWith(body.candidateDeploymentId + ":")) {
    return json({ error: "fence_request_invalid" }, 400);
  }

  // Each runtime deployment gets its own token. A primary process cannot use
  // its credential to request a promotion for the standby deployment.
  const requestTokensRaw = env.FENCE_REQUEST_TOKENS_JSON || "";
  if (typeof requestTokensRaw !== "string" || requestTokensRaw.length > 4096) {
    return json({ error: "fence_request_tokens_not_configured" }, 503);
  }

  let requestTokens;
  try {
    requestTokens = JSON.parse(requestTokensRaw);
  } catch {
    return json({ error: "fence_request_tokens_invalid" }, 503);
  }
  if (!requestTokens || typeof requestTokens !== "object" || Array.isArray(requestTokens)) {
    return json({ error: "fence_request_tokens_invalid" }, 503);
  }

  const requestToken = requestTokens[body.candidateDeploymentId] || "";
  if (typeof requestToken !== "string" || requestToken.length < 32 || requestToken.length > 512) {
    return json({ error: "fence_request_not_authorized_for_deployment" }, 401);
  }
  const authorization = request.headers.get("authorization") || "";
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!await sameSecret(candidate, requestToken)) return json({ error: "unauthorized" }, 401);

  const apiKey = env.RENDER_API_KEY || "";
  const serviceMapRaw = env.RENDER_SERVICE_IDS_JSON || "";
  if (typeof apiKey !== "string" || apiKey.length < 20 || apiKey.length > 512 ||
      typeof serviceMapRaw !== "string" || serviceMapRaw.length > 4096) {
    return json({ error: "render_fencer_not_configured" }, 503);
  }

  let serviceIdsByDeployment;
  try {
    serviceIdsByDeployment = JSON.parse(serviceMapRaw);
  } catch {
    return json({ error: "render_service_map_invalid" }, 503);
  }
  if (!serviceIdsByDeployment || typeof serviceIdsByDeployment !== "object" ||
      Array.isArray(serviceIdsByDeployment)) {
    return json({ error: "render_service_map_invalid" }, 503);
  }

  let stub;
  try { stub = objectStub(env); }
  catch { return json({ error: "lease_coordinator_binding_missing" }, 503); }

  try {
    const fencer = createRenderServiceFencer({
      apiKey,
      serviceIdsByDeployment,
      fetchFn: fetch,
      timeoutMs: 15000,
      pollIntervalMs: 500,
      requestTimeoutMs: 5000
    });
    const result = await fencer.fenceExpiredOwner({
      leaseStore: { read: () => internalLeaseRead(stub) },
      candidateOwnerId: body.candidateOwnerId,
      candidateDeploymentId: body.candidateDeploymentId,
      confirmFence: input => internalFenceConfirm(stub, input)
    });
    return json({
      ok: true,
      fenced: true,
      previousDeploymentId: result.previousDeploymentId,
      candidateDeploymentId: result.candidateDeploymentId,
      previousServiceId: result.previousServiceId,
      candidateServiceId: result.candidateServiceId,
      stopProof: {
        serviceId: result.stopProof.serviceId,
        state: result.stopProof.state,
        alreadySuspended: result.stopProof.alreadySuspended,
        verifiedAt: result.stopProof.verifiedAt,
        renderUpdatedAt: result.stopProof.renderUpdatedAt
      },
      fenceConfirmation: {
        fencedOwnerId: result.fenceConfirmation.fenced_owner_id,
        fencedEpoch: result.fenceConfirmation.fenced_epoch,
        candidateOwnerId: result.fenceConfirmation.fence_target_owner_id,
        candidateDeploymentId: result.fenceConfirmation.fence_target_deployment_id,
        provider: result.fenceConfirmation.fence_provider,
        proofId: result.fenceConfirmation.fence_proof_id
      }
    });
  } catch (error) {
    const reason = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
      ? error.message
      : "fence_operation_failed";
    const conflicts = new Set([
      "lease_bootstrap_required",
      "lease_still_active",
      "render_deployment_mapping_missing",
      "render_owner_services_must_be_distinct",
      "render_candidate_service_suspended",
      "render_suspend_state_unverified",
      "lease_fence_not_confirmed"
    ]);
    return json({ ok: false, reason }, conflicts.has(reason) ? 409 : 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/healthz") {
      return json({
        status: "ok",
        service: "momentum-movement-gateway-lease",
        mode: "control-plane-and-fencing-control"
      });
    }

    const standardRoutes = new Set([
      "/lease/state", "/lease/acquire", "/lease/renew", "/lease/release"
    ]);
    const bootstrapRoute = path === "/lease/bootstrap";
    const fenceRequestRoute = path === "/fence";
    const coachingClaimRoute = path === "/coaching/interaction/claim";

    if (!standardRoutes.has(path) && !bootstrapRoute && !fenceRequestRoute && !coachingClaimRoute) {
      return json({ error: "not_found" }, 404);
    }

    if (path === "/lease/state" && request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405);
    }
    if (path !== "/lease/state" && request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    if (fenceRequestRoute) return fenceCandidate(request, env);
    if (coachingClaimRoute) return claimCoachingInteraction(request, env);

    // Bootstrap is an operator-only path; Bot 005 and standby receive neither
    // this credential nor the Render API key.
    const token = bootstrapRoute
      ? env.LEASE_BOOTSTRAP_TOKEN || ""
      : env.LEASE_SERVICE_TOKEN || "";

    if (typeof token !== "string" || token.length < 32 || token.length > 512) {
      return json({ error: "lease_route_not_configured" }, 503);
    }

    const authorization = request.headers.get("authorization") || "";
    const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!await sameSecret(candidate, token)) return json({ error: "unauthorized" }, 401);

    let stub;
    try { stub = objectStub(env); }
    catch { return json({ error: "lease_coordinator_binding_missing" }, 503); }
    return stub.fetch(request);
  }
};
