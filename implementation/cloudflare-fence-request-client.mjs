function validateBaseUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new TypeError("fence_request_url_invalid");
  let url;
  try { url = new URL(raw); } catch { throw new TypeError("fence_request_url_invalid"); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || !host || host.includes("railway") ||
      host.endsWith(".rlwy.net") || host === "localhost" ||
      host.endsWith(".localhost") || host.endsWith(".local") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      url.username || url.password || url.search || url.hash) {
    throw new TypeError("fence_request_url_must_be_public_https");
  }
  return { origin: url.origin, pathname: url.pathname.replace(/\/+$/, "") };
}

function requiredToken(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 512) {
    throw new TypeError("fence_request_token_invalid");
  }
  return value;
}

function requiredIdentity(value, name) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200) {
    throw new TypeError(name + "_invalid");
  }
  return value.trim();
}

export function createCloudflareFenceRequester({
  baseUrl,
  requestToken,
  fetchFn = globalThis.fetch,
  timeoutMs = 30000
}) {
  const base = validateBaseUrl(baseUrl);
  const token = requiredToken(requestToken);
  if (typeof fetchFn !== "function") throw new TypeError("fetch_function_required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30000) {
    throw new RangeError("fence_request_timeout_invalid");
  }

  async function requestFence({ candidateOwnerId, candidateDeploymentId }) {
    const input = {
      candidateOwnerId: requiredIdentity(candidateOwnerId, "candidate_owner_id"),
      candidateDeploymentId: requiredIdentity(candidateDeploymentId, "candidate_deployment_id")
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(new URL(base.pathname + "/fence", base.origin), {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify(input),
        signal: controller.signal
      });
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error("fence_request_response_invalid"); }
      if (!response.ok || payload?.ok !== true || payload?.fenced !== true ||
          payload.candidateOwnerId !== input.candidateOwnerId ||
          payload.candidateDeploymentId !== input.candidateDeploymentId ||
          payload.stopProof?.state !== "suspended") {
        const reason = typeof payload?.reason === "string" &&
          /^[a-z0-9_]{1,80}$/.test(payload.reason)
          ? payload.reason
          : "fence_request_http_" + response.status;
        throw new Error("fence_request_" + reason);
      }
      return payload;
    } catch (error) {
      if (error instanceof Error &&
          /^fence_request_(response_invalid|[a-z0-9_]+)$/.test(error.message)) {
        throw error;
      }
      if (controller.signal.aborted) throw new Error("fence_request_timeout");
      throw new Error("fence_request_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ requestFence });
}

export function createRemoteFencedCloudflareLeaseStore({
  baseLeaseStore,
  fenceRequester
}) {
  if (!baseLeaseStore || typeof baseLeaseStore.acquire !== "function" ||
      typeof baseLeaseStore.renew !== "function" ||
      typeof baseLeaseStore.release !== "function" ||
      typeof baseLeaseStore.read !== "function") {
    throw new TypeError("cloudflare_lease_store_contract_invalid");
  }
  if (!fenceRequester || typeof fenceRequester.requestFence !== "function") {
    throw new TypeError("fence_requester_contract_invalid");
  }

  return Object.freeze({
    async acquire(input) {
      try {
        return await baseLeaseStore.acquire(input);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "lease_coordinator_hard_fence_required") {
          throw error;
        }
        await fenceRequester.requestFence({
          candidateOwnerId: input.ownerId,
          candidateDeploymentId: input.deploymentId
        });
        return baseLeaseStore.acquire(input);
      }
    },
    renew(input) {
      return baseLeaseStore.renew(input);
    },
    release(input) {
      return baseLeaseStore.release(input);
    },
    read() {
      return baseLeaseStore.read();
    }
  });
}
