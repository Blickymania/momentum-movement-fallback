function requiredText(value, name, max = 200) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new TypeError(name + "_invalid");
  }
  return value.trim();
}

function validateServiceId(value) {
  const id = requiredText(value, "render_service_id", 100);
  if (!/^srv-[a-z0-9-]{8,80}$/i.test(id)) throw new TypeError("render_service_id_invalid");
  return id;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createRenderServiceFencer({
  apiKey,
  serviceIdsByDeployment,
  fetchFn = globalThis.fetch,
  timeoutMs = 15000,
  pollIntervalMs = 500,
  requestTimeoutMs = 5000
}) {
  if (typeof apiKey !== "string" || apiKey.length < 20 || apiKey.length > 512) {
    throw new TypeError("render_api_key_invalid");
  }
  if (!serviceIdsByDeployment || typeof serviceIdsByDeployment !== "object" ||
      Array.isArray(serviceIdsByDeployment)) {
    throw new TypeError("render_service_map_invalid");
  }
  if (typeof fetchFn !== "function") throw new TypeError("render_fetch_function_required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new RangeError("render_fence_timeout_invalid");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 5000) {
    throw new RangeError("render_fence_poll_interval_invalid");
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 250 || requestTimeoutMs > 10000) {
    throw new RangeError("render_request_timeout_invalid");
  }

  const serviceMap = new Map();
  for (const [deployment, id] of Object.entries(serviceIdsByDeployment)) {
    serviceMap.set(requiredText(deployment, "deployment_id"), validateServiceId(id));
  }
  const mappedIds = [...serviceMap.values()];
  if (new Set(mappedIds).size !== mappedIds.length) {
    throw new TypeError("render_service_ids_must_be_unique");
  }

  async function request(method, path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchFn("https://api.render.com/v1" + path, {
        method,
        headers: {
          authorization: "Bearer " + apiKey,
          accept: "application/json"
        },
        signal: controller.signal
      });
      if (method === "POST" && response.status === 202) return { accepted: true };
      if (!response.ok) throw new Error("render_api_http_" + response.status);
      if (response.status === 204) return {};
      try { return await response.json(); }
      catch { throw new Error("render_api_response_invalid"); }
    } catch (error) {
      if (error instanceof Error && /^render_api_(http_\d{3}|response_invalid)$/.test(error.message)) {
        throw error;
      }
      if (controller.signal.aborted) throw new Error("render_api_timeout");
      throw new Error("render_api_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  async function getService(serviceId) {
    const id = validateServiceId(serviceId);
    const service = await request("GET", "/services/" + encodeURIComponent(id));
    if (!service || service.id !== id ||
        !["suspended", "not_suspended"].includes(service.suspended)) {
      throw new Error("render_service_state_unverified");
    }
    return service;
  }

  async function ensureSuspended(serviceId) {
    const id = validateServiceId(serviceId);
    const initial = await getService(id);
    if (initial.suspended === "suspended") {
      return {
        serviceId: id,
        state: "suspended",
        alreadySuspended: true,
        verifiedAt: new Date().toISOString(),
        renderUpdatedAt: initial.updatedAt || null
      };
    }

    const response = await request("POST", "/services/" + encodeURIComponent(id) + "/suspend");
    if (!response?.accepted) throw new Error("render_suspend_not_accepted");

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await delay(pollIntervalMs);
      const current = await getService(id);
      if (current.suspended === "suspended") {
        return {
          serviceId: id,
          state: "suspended",
          alreadySuspended: false,
          verifiedAt: new Date().toISOString(),
          renderUpdatedAt: current.updatedAt || null
        };
      }
    }
    throw new Error("render_suspend_state_unverified");
  }

  async function assertServiceRunning(serviceId) {
    const service = await getService(serviceId);
    if (service.suspended !== "not_suspended") {
      throw new Error("render_candidate_service_suspended");
    }
    return service;
  }

  async function fenceExpiredOwner({
    leaseStore,
    candidateOwnerId,
    candidateDeploymentId,
    confirmFence
  }) {
    if (!leaseStore || typeof leaseStore.read !== "function") {
      throw new TypeError("lease_state_reader_required");
    }
    if (typeof confirmFence !== "function") throw new TypeError("fence_confirmation_callback_required");
    const candidateOwner = requiredText(candidateOwnerId, "candidate_owner_id");
    const candidateDeployment = requiredText(candidateDeploymentId, "candidate_deployment_id");
    const current = await leaseStore.read();
    if (!current) throw new Error("lease_bootstrap_required");
    if (current.lease_active === true || current.lease_active === 1) {
      throw new Error("lease_still_active");
    }
    const oldDeployment = requiredText(current.deployment_id, "previous_deployment_id");
    const previousServiceId = serviceMap.get(oldDeployment);
    const candidateServiceId = serviceMap.get(candidateDeployment);
    if (!previousServiceId || !candidateServiceId) {
      throw new Error("render_deployment_mapping_missing");
    }
    if (previousServiceId === candidateServiceId) {
      throw new Error("render_owner_services_must_be_distinct");
    }

    // Do not grant a lease to a candidate that is already suspended. Its process
    // must be running without a Gateway so it can receive the lease and log in.
    await assertServiceRunning(candidateServiceId);
    const stopProof = await ensureSuspended(previousServiceId);
    // Deterministic for this exact former owner/epoch and candidate so a
    // retried confirmation is idempotent after an HTTP response is lost.
    const proofMaterial = [
      "render-suspend-v1",
      oldDeployment,
      current.owner_id,
      current.fencing_epoch,
      candidateDeployment,
      candidateOwner,
      stopProof.serviceId
    ].join("\\n");
    const digest = new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(proofMaterial)
    ));
    const proofId = "render-suspend-v1:" +
      Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");

    const confirmed = await confirmFence({
      scope: current.lease_scope,
      expectedOwnerId: current.owner_id,
      expectedFencingEpoch: current.fencing_epoch,
      candidateOwnerId: candidateOwner,
      candidateDeploymentId: candidateDeployment,
      provider: "render-service-suspended",
      proofId
    });

    return {
      previousDeploymentId: oldDeployment,
      candidateDeploymentId: candidateDeployment,
      previousServiceId,
      candidateServiceId,
      stopProof,
      fenceConfirmation: confirmed
    };
  }

  return Object.freeze({
    getService,
    ensureSuspended,
    assertServiceRunning,
    fenceExpiredOwner
  });
}
