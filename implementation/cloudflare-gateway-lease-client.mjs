function validateBaseUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new TypeError("lease_coordinator_url_invalid");
  let url;
  try { url = new URL(raw); } catch { throw new TypeError("lease_coordinator_url_invalid"); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || !host || host.includes("railway") ||
      host.endsWith(".rlwy.net") || host === "localhost" ||
      host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".lan") ||
      host.endsWith(".home") || host.endsWith(".test") ||
      host.endsWith(".invalid") || host.endsWith(".example") ||
      host.endsWith(".onion") || !host.includes(".") ||
      host.startsWith("[") && host.endsWith("]") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      url.username || url.password || url.search || url.hash) {
    throw new TypeError("lease_coordinator_url_must_be_public_https");
  }
  return {
    origin: url.origin,
    pathname: url.pathname.replace(/\/+$/, "")
  };
}

function validateTimeout(value) {
  if (!Number.isInteger(value) || value < 250 || value > 30000) {
    throw new RangeError("lease_coordinator_timeout_invalid");
  }
  return value;
}

export function createCloudflareGatewayLeaseStore({
  baseUrl,
  serviceToken,
  fetchFn = globalThis.fetch,
  timeoutMs = 5000
}) {
  const base = validateBaseUrl(baseUrl);
  if (typeof serviceToken !== "string" || serviceToken.length < 32 || serviceToken.length > 512) {
    throw new TypeError("lease_coordinator_token_invalid");
  }
  if (typeof fetchFn !== "function") throw new TypeError("fetch_function_required");
  const timeout = validateTimeout(timeoutMs);

  async function call(path, method, body) {
    let signal;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    signal = controller.signal;

    try {
      const response = await fetchFn(new URL(base.pathname + path, base.origin), {
        method,
        headers: {
          authorization: "Bearer " + serviceToken,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal
      });

      let payload;
      try { payload = await response.json(); }
      catch { throw new Error("lease_coordinator_response_invalid"); }

      if (response.status === 409) {
        if (payload?.reason === "lease_unavailable" || payload?.reason === "lease_not_owned") return null;
        const reason = typeof payload?.reason === "string" &&
          /^[a-z0-9_]{1,80}$/.test(payload.reason)
          ? payload.reason
          : "conflict";
        throw new Error("lease_coordinator_" + reason);
      }
      if (!response.ok) throw new Error("lease_coordinator_http_" + response.status);

      if (payload?.ok !== true || (payload.lease !== null && typeof payload.lease !== "object")) {
        throw new Error("lease_coordinator_response_invalid");
      }
      return payload.lease;
    } catch (error) {
      if (error instanceof Error &&
          /^lease_coordinator_(http_\d{3}|response_invalid|[a-z0-9_]{1,80})$/.test(error.message)) {
        throw error;
      }
      if (controller.signal.aborted) throw new Error("lease_coordinator_timeout");
      throw new Error("lease_coordinator_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    acquire(input) {
      return call("/lease/acquire", "POST", input);
    },
    renew(input) {
      return call("/lease/renew", "POST", input);
    },
    release(input) {
      return call("/lease/release", "POST", input);
    },
    read() {
      return call("/lease/state", "GET");
    }
  });
}
