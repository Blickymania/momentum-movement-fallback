function validateEndpoint(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new TypeError("lease_coordinator_url_invalid");
  let url;
  try { url = new URL(raw); } catch { throw new TypeError("lease_coordinator_url_invalid"); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || !host || host.includes("railway") ||
      host.endsWith(".rlwy.net") || host === "localhost" ||
      host.endsWith(".localhost") || host.endsWith(".local") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      url.username || url.password || url.search || url.hash) {
    throw new TypeError("lease_coordinator_url_must_be_public_https");
  }
  return { origin: url.origin, pathname: url.pathname.replace(/\/+$/, "") };
}

function requiredSecret(value, name) {
  if (typeof value !== "string" || value.length < 32 || value.length > 512) {
    throw new TypeError(name + "_invalid");
  }
  return value;
}

export function createCloudflareGatewayFencingClient({
  baseUrl,
  bootstrapToken,
  fenceControllerToken,
  fetchFn = globalThis.fetch,
  timeoutMs = 5000
}) {
  const endpoint = validateEndpoint(baseUrl);
  const bootstrapSecret = requiredSecret(bootstrapToken, "bootstrap_token");
  const fenceSecret = requiredSecret(fenceControllerToken, "fence_controller_token");
  if (typeof fetchFn !== "function") throw new TypeError("fetch_function_required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30000) {
    throw new RangeError("fencing_client_timeout_invalid");
  }

  async function post(path, secret, input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(new URL(endpoint.pathname + path, endpoint.origin), {
        method: "POST",
        headers: {
          authorization: "Bearer " + secret,
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify(input),
        signal: controller.signal
      });
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error("fencing_response_invalid"); }
      if (!response.ok || payload?.ok !== true) {
        const reason = typeof payload?.reason === "string" &&
          /^[a-z0-9_]{1,80}$/.test(payload.reason)
          ? payload.reason
          : "http_" + response.status;
        throw new Error("fencing_controller_" + reason);
      }
      return payload.lease;
    } catch (error) {
      if (error instanceof Error && /^fencing_(response_invalid|controller_[a-z0-9_]+)$/.test(error.message)) {
        throw error;
      }
      if (controller.signal.aborted) throw new Error("fencing_controller_timeout");
      throw new Error("fencing_controller_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    bootstrap(input) {
      return post("/lease/bootstrap", bootstrapSecret, input);
    },
    confirmFence(input) {
      return post("/lease/fence/confirm", fenceSecret, input);
    }
  });
}
