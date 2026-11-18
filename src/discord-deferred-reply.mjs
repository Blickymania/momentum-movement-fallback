const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_CONTENT_LENGTH = 2_000;

function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

function validateToken(token) {
  return typeof token === "string" && token.length >= 16 && token.length <= 256 &&
    !/[\u0000-\u0020\u007f]/.test(token);
}

function validConfirmationComponents(components) {
  if (!Array.isArray(components)) return false;
  if (components.length === 0) return true;
  if (components.length !== 1) return false;
  const row = components[0];
  if (!row || row.type !== 1 || !Array.isArray(row.components) || row.components.length !== 2) return false;
  const [confirm, cancel] = row.components;
  const confirmId = /^mm005:forum-confirm:confirm:([A-Za-z0-9_-]{16,64})$/.exec(confirm?.custom_id ?? "");
  const cancelId = /^mm005:forum-confirm:cancel:([A-Za-z0-9_-]{16,64})$/.exec(cancel?.custom_id ?? "");
  return confirm?.type === 2 && confirm.style === 3 && confirm.label === "Confirm" &&
    cancel?.type === 2 && cancel.style === 4 && cancel.label === "Cancel" &&
    !!confirmId && !!cancelId && confirmId[1] === cancelId[1];
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
        (components !== undefined && !validConfirmationComponents(components))) {
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

    let messageId = null;
    if (result.status !== 204 && typeof result.json === "function") {
      const message = await result.json().catch(() => null);
      if (validSnowflake(message?.id)) messageId = message.id;
    }
    return { updated: true, status: result.status, messageId };
  };
}
