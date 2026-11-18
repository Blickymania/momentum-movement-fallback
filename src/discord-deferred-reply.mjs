const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_CONTENT_LENGTH = 2_000;

function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

function validateToken(token) {
  return typeof token === "string" && token.length >= 16 && token.length <= 256 &&
    !/[\u0000-\u0020\u007f]/.test(token);
}

/**
 * Idempotently replace the deferred original interaction response.
 * No retry is performed here; dispatcher retry uses the same PATCH target.
 */
export function createDiscordDeferredReplyEditor({
  fetchImpl = fetch,
  timeoutSignal = (ms) => AbortSignal.timeout(ms),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function" || typeof timeoutSignal !== "function" ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 10_000) {
    throw new TypeError("Deferred interaction reply editor configuration is invalid");
  }

  return async function editDeferredReply({ applicationId, token, content, components } = {}) {
    if (!validSnowflake(applicationId) || !validateToken(token) ||
        typeof content !== "string" || content.length < 1 ||
        content.length > MAX_CONTENT_LENGTH ||
        (components !== undefined && (!Array.isArray(components) || components.length !== 0))) {
      throw new TypeError("Deferred interaction reply edit is invalid");
    }

    const url = "https://discord.com/api/v10/webhooks/" +
      applicationId + "/" + encodeURIComponent(token) + "/messages/@original";
    let result;
    try {
      result = await fetchImpl(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          ...(components === undefined ? {} : { components }),
          allowed_mentions: { parse: [] },
        }),
        signal: timeoutSignal(timeoutMs),
      });
    } catch {
      const error = new Error("discord_deferred_reply_edit_transport_failed");
      error.code = "discord_deferred_reply_edit_transport_failed";
      throw error;
    }

    if (!result || !result.ok) {
      const status = Number(result?.status || 0);
      const code = status === 429 ? "discord_deferred_reply_edit_rate_limited"
        : status >= 500 ? "discord_deferred_reply_edit_service_error"
        : "discord_deferred_reply_edit_rejected";
      const error = new Error(code);
      error.code = code;
      error.status = Number.isInteger(status) ? status : 0;
      throw error;
    }

    return { updated: true, status: result.status };
  };
}
