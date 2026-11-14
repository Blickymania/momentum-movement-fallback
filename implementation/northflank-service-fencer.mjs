function requiredText(value, name, max = 200) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new TypeError(name + "_invalid");
  }
  return value.trim();
}

function validateNorthflankId(value, name) {
  const id = requiredText(value, name, 39);
  if (!/^[a-zA-Z](-?[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*)?$/.test(id) || id.length < 3) {
    throw new TypeError(name + "_invalid");
  }
  return id;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isStopped(containers) {
  return containers.every(container => container.terminated === true);
}

export function createNorthflankServiceFencer({
  apiToken,
  projectId,
  serviceIdsByDeployment,
  fetchFn = globalThis.fetch,
  timeoutMs = 15000,
  pollIntervalMs = 500,
  requestTimeoutMs = 5000
}) {
  if (typeof apiToken !== "string" || apiToken.length < 20 || apiToken.length > 512) {
    throw new TypeError("northflank_api_token_invalid");
  }
  const project = validateNorthflankId(projectId, "northflank_project_id");
  if (!serviceIdsByDeployment || typeof serviceIdsByDeployment !== "object" ||
      Array.isArray(serviceIdsByDeployment)) {
    throw new TypeError("northflank_service_map_invalid");
  }
  if (typeof fetchFn !== "function") throw new TypeError("northflank_fetch_function_required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new RangeError("northflank_fence_timeout_invalid");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 5000) {
    throw new RangeError("northflank_fence_poll_interval_invalid");
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 250 || requestTimeoutMs > 10000) {
    throw new RangeError("northflank_request_timeout_invalid");
  }

  const serviceMap = new Map();
  for (const [deployment, id] of Object.entries(serviceIdsByDeployment)) {
    serviceMap.set(requiredText(deployment, "deployment_id"),
      validateNorthflankId(id, "northflank_service_id"));
  }
  const mappedIds = [...serviceMap.values()];
  if (mappedIds.length < 2 || new Set(mappedIds).size !== mappedIds.length) {
    throw new TypeError("northflank_service_ids_must_be_distinct");
  }

  async function request(method, path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchFn("https://api.northflank.com/v1/projects/" +
        encodeURIComponent(project) + "/services/" + path, {
        method,
        headers: {
          authorization: "Bearer " + apiToken,
          accept: "application/json",
          "content-type": "application/json"
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error("northflank_api_http_" + response.status);
      if (response.status === 204) return {};
      try { return await response.json(); }
      catch { throw new Error("northflank_api_response_invalid"); }
    } catch (error) {
      if (error instanceof Error && /^northflank_api_(http_\d{3}|response_invalid)$/.test(error.message)) {
        throw error;
      }
      if (controller.signal.aborted) throw new Error("northflank_api_timeout");
      throw new Error("northflank_api_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  function validateServiceId(serviceId) {
    return validateNorthflankId(serviceId, "northflank_service_id");
  }

  async function getCurrentContainers(serviceId) {
    const id = validateServiceId(serviceId);
    const response = await request("GET", encodeURIComponent(id) + "/health");
    const current = response?.data?.current;
    if (!current || !Array.isArray(current.containers) || current.hasMore === true) {
      throw new Error("northflank_service_state_unverified");
    }
    for (const container of current.containers) {
      if (!container || typeof container.terminated !== "boolean" ||
          typeof container.status !== "string") {
        throw new Error("northflank_service_state_unverified");
      }
    }
    return current.containers;
  }

  async function getServiceHealth(serviceId) {
    const containers = await getCurrentContainers(serviceId);
    return {
      serviceId: validateServiceId(serviceId),
      containers,
      runningCount: containers.filter(container => container.terminated === false).length,
      stopped: isStopped(containers)
    };
  }

  async function ensurePaused(serviceId) {
    const id = validateServiceId(serviceId);
    const initial = await getServiceHealth(id);
    if (initial.stopped) {
      return {
        serviceId: id,
        state: "paused",
        alreadyPaused: true,
        verifiedAt: new Date().toISOString(),
        remainingRunningContainers: 0,
        observedContainerCount: initial.containers.length
      };
    }

    await request("POST", encodeURIComponent(id) + "/pause");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await delay(pollIntervalMs);
      const current = await getServiceHealth(id);
      if (current.stopped) {
        return {
          serviceId: id,
          state: "paused",
          alreadyPaused: false,
          verifiedAt: new Date().toISOString(),
          remainingRunningContainers: 0,
          observedContainerCount: current.containers.length
        };
      }
    }
    throw new Error("northflank_pause_state_unverified");
  }

  async function assertServiceRunning(serviceId) {
    const health = await getServiceHealth(serviceId);
    if (health.runningCount < 1 ||
        health.containers.some(container => container.terminated !== false || container.status !== "TASK_RUNNING")) {
      throw new Error("northflank_candidate_service_not_running");
    }
    return health;
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
    if (!candidateOwner.startsWith(candidateDeployment + ":")) {
      throw new TypeError("candidate_owner_id_must_be_bound_to_deployment");
    }
    const current = await leaseStore.read();
    if (!current) throw new Error("lease_bootstrap_required");
    if (current.lease_active === true || current.lease_active === 1) {
      throw new Error("lease_still_active");
    }
    const oldDeployment = requiredText(current.deployment_id, "previous_deployment_id");
    const oldOwner = requiredText(current.owner_id, "previous_owner_id");
    if (!oldOwner.startsWith(oldDeployment + ":")) {
      throw new Error("previous_owner_id_not_bound_to_deployment");
    }
    const previousServiceId = serviceMap.get(oldDeployment);
    const candidateServiceId = serviceMap.get(candidateDeployment);
    if (!previousServiceId || !candidateServiceId) {
      throw new Error("northflank_deployment_mapping_missing");
    }
    if (previousServiceId === candidateServiceId) {
      throw new Error("northflank_owner_services_must_be_distinct");
    }

    // The candidate must be alive and capable of acquiring the lease before
    // the former owner is paused. A paused candidate is never promoted.
    await assertServiceRunning(candidateServiceId);
    const stopProof = await ensurePaused(previousServiceId);
    const proofMaterial = [
      "northflank-pause-v1",
      oldDeployment,
      current.owner_id,
      current.fencing_epoch,
      candidateDeployment,
      candidateOwner,
      stopProof.serviceId
    ].join("\n");
    const digest = new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(proofMaterial)
    ));
    const proofId = "northflank-pause-v1:" +
      Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");

    const confirmed = await confirmFence({
      scope: current.lease_scope,
      expectedOwnerId: current.owner_id,
      expectedFencingEpoch: current.fencing_epoch,
      candidateOwnerId: candidateOwner,
      candidateDeploymentId: candidateDeployment,
      provider: "northflank-service-paused",
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
    getServiceHealth,
    ensurePaused,
    assertServiceRunning,
    fenceExpiredOwner
  });
}
