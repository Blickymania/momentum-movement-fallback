const ACKABLE_TYPES = new Set([1, 4, 5, 6, 7, 8, 9]);
const REQUIRED_DATA_TYPES = new Set([4, 7, 8, 9]);
const DEFAULT_TIMEOUT_MS = 2_100;
const MAX_RESPONSE_BYTES = 64 * 1024;

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateInteraction(id, token) {
  if (typeof id !== "string" || !/^\d{15,22}$/.test(id)) {
    throw new TypeError("interactionId must be a Discord snowflake");
  }
  if (typeof token !== "string" || token.length < 16 || token.length > 256 ||
      /[\u0000-\u0020\u007f]/.test(token)) {
    throw new TypeError("interaction token is invalid");
  }
}

function serializeResponse(response) {
  if (!plainObject(response) || !Number.isInteger(response.type) ||
      !ACKABLE_TYPES.has(response.type) ||
      (response.data !== undefined && !plainObject(response.data)) ||
      (REQUIRED_DATA_TYPES.has(response.type) && !plainObject(response.data))) {
    throw new TypeError("Discord interaction response plan is invalid");
  }
  let body;
  try { body = JSON.stringify(response); }
  catch { throw new TypeError("Discord interaction response plan is not serializable"); }
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > MAX_RESPONSE_BYTES) {
    throw new RangeError("Discord interaction response plan exceeds the size limit");
  }
  return body;
}

/**
 * Send one handler-selected initial Discord interaction response.
 *
 * The caller must choose the correct response type for the owning feature
 * (for example, defer reply, defer update, or a modal response). This transport
 * does not guess handler behavior, retry ambiguous failures, store the token,
 * or log request data. A short deadline leaves room for the surrounding
 * Gateway event path to persist its durable receipt.
 */
export function createDiscordInteractionAcknowledger({
  fetchImpl = fetch,
  timeoutSignal = (ms) => AbortSignal.timeout(ms),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function" || typeof timeoutSignal !== "function" ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 2_500) {
    throw new TypeError("Discord interaction acknowledger configuration is invalid");
  }

  return async function acknowledgeInteraction({ interactionId, token, response } = {}) {
    validateInteraction(interactionId, token);
    const body = serializeResponse(response);
    const url = "https://discord.com/api/v10/interactions/" +
      interactionId + "/" + encodeURIComponent(token) + "/callback";
    let result;
    try {
      result = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: timeoutSignal(timeoutMs),
      });
    } catch {
      const error = new Error("discord_interaction_ack_transport_failed");
      error.code = "discord_interaction_ack_transport_failed";
      throw error;
    }

    if (!result || !result.ok) {
      const status = Number(result?.status || 0);
      const code = status === 429 ? "discord_interaction_ack_rate_limited"
        : status >= 500 ? "discord_interaction_ack_service_error"
        : "discord_interaction_ack_rejected";
      const error = new Error(code);
      error.code = code;
      error.status = Number.isInteger(status) ? status : 0;
      throw error;
    }

    return { acknowledged: true, responseType: response.type, status: result.status };
  };
}
