import { signCoachingRequest } from "./coaching-workflow-auth.mjs";

function validateCoachingEndpoint(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new TypeError("coaching_workflow_url_required");
  }

  let url;
  try { url = new URL(raw); }
  catch { throw new TypeError("coaching_workflow_url_invalid"); }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const ipV6 = host.startsWith("[") && host.endsWith("]");
  if (url.protocol !== "https:" || !host ||
      host.includes("railway") || host.endsWith(".rlwy.net") ||
      host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") ||
      host.endsWith(".lan") || host.endsWith(".home") ||
      host.endsWith(".test") || host.endsWith(".invalid") ||
      host.endsWith(".example") || host.endsWith(".onion") || !host.includes(".") ||
      ipV4 || ipV6 || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/interaction") {
    throw new TypeError("coaching_workflow_url_must_be_public_https_interaction");
  }

  return url;
}

function validateTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15000) {
    throw new RangeError("coaching_workflow_timeout_invalid");
  }
  return timeoutMs;
}

export function createCoachingWorkflowClient({
  endpoint,
  authSource,
  authSecret,
  fetchFn = (input, init) => globalThis.fetch(input, init),
  timeoutMs = 5000,
  maxPayloadBytes = 262144
}) {
  const url = validateCoachingEndpoint(endpoint);
  const timeout = validateTimeout(timeoutMs);
  if ((authSource !== "bot005" && authSource !== "coaching-relay") ||
      typeof authSecret !== "string" || authSecret.length < 32 || authSecret.length > 512) {
    throw new TypeError("coaching_workflow_authentication_required");
  }

  if (typeof fetchFn !== "function") {
    throw new TypeError("coaching_workflow_fetch_function_required");
  }
  if (!Number.isSafeInteger(maxPayloadBytes) ||
      maxPayloadBytes < 1024 || maxPayloadBytes > 1048576) {
    throw new RangeError("coaching_workflow_payload_limit_invalid");
  }

  return Object.freeze({
    endpoint: url.origin + url.pathname,

    async checkReady() {
      const readyUrl = new URL("/readyz", url.origin);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetchFn(readyUrl, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal
        });
        if (!response || typeof response.ok !== "boolean") {
          throw new Error("coaching_workflow_response_invalid");
        }
        let body = null;
        try { body = await response.json(); }
        catch { throw new Error("coaching_workflow_response_invalid"); }
        return Object.freeze({
          ok: response.ok,
          status: response.status,
          ready: response.ok && body?.ready === true
        });
      } catch (error) {
        if (error instanceof Error &&
            /^coaching_workflow_(http_\\d{3}|response_invalid)$/.test(error.message)) {
          throw error;
        }
        if (controller.signal.aborted) throw new Error("coaching_workflow_timeout");
        throw new Error("coaching_workflow_unavailable");
      } finally {
        clearTimeout(timer);
      }
    },

    async forward(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError("coaching_interaction_payload_invalid");
      }
      const body = JSON.stringify(payload);
      const size = new TextEncoder().encode(body).byteLength;
      if (size > maxPayloadBytes) {
        throw new RangeError("coaching_interaction_payload_too_large");
      }

      const signedHeaders = await signCoachingRequest({ source: authSource, secret: authSecret, body });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetchFn(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...signedHeaders
          },
          body,
          signal: controller.signal
        });

        if (!response || typeof response.ok !== "boolean") {
          throw new Error("coaching_workflow_response_invalid");
        }
        if (!response.ok) {
          throw new Error("coaching_workflow_http_" + response.status);
        }

        return Object.freeze({
          ok: true,
          status: response.status
        });
      } catch (error) {
        if (error instanceof Error &&
            /^coaching_workflow_(http_\d{3}|response_invalid)$/.test(error.message)) {
          throw error;
        }
        if (controller.signal.aborted) {
          throw new Error("coaching_workflow_timeout");
        }
        throw new Error("coaching_workflow_unavailable");
      } finally {
        clearTimeout(timer);
      }
    }
  });
}

export function createCoachingWorkflowClientFromEnv({
  env = globalThis.process?.env || {},
  ...options
} = {}) {
  return createCoachingWorkflowClient({
    endpoint: env.COACHING_WORKFLOW_URL,
    authSource: env.COACHING_WORKFLOW_SOURCE,
    authSecret: env.COACHING_WORKFLOW_AUTH_SECRET,
    ...options
  });
}
