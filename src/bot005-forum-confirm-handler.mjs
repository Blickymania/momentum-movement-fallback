function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
function safeText(value, max = 300) {
  return String(value ?? "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "@\u200b")
    .replace(/[*_~|\\]/g, "")
    .split(String.fromCharCode(96)).join("")
    .trim().slice(0, max);
}
function parseConfirmation(customId) {
  const match = /^mm005:forum-confirm:(confirm|cancel):([A-Za-z0-9_-]{16,64})$/.exec(customId ?? "");
  return match ? { action: match[1], id: match[2] } : null;
}

export function createBot005ForumConfirmHandler({
  confirmationStore, revealInteraction, editDeferredReply, getGuildOwnerId,
  executeConfirmed, guildId, applicationId,
} = {}) {
  if (!confirmationStore || typeof confirmationStore.claim !== "function" ||
      typeof confirmationStore.cancel !== "function" || typeof confirmationStore.finish !== "function" ||
      typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getGuildOwnerId !== "function" || typeof executeConfirmed !== "function" ||
      !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 forum confirmation dependencies are invalid");
  }
  return async function handleBot005ForumConfirm(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" ||
        String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_forum_confirm_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    const parsed = parseConfirmation(interaction?.data?.custom_id);
    const userId = interaction?.member?.user?.id ?? interaction?.user?.id;
    const channelId = interaction?.channel_id;
    const messageId = interaction?.message?.id;
    if (Number(interaction?.type) !== 3 || String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId ||
        !validSnowflake(interaction?.id) || typeof interaction?.token !== "string" ||
        !validSnowflake(userId) || !validSnowflake(channelId) || !validSnowflake(messageId) ||
        String(interaction?.message?.author?.id ?? "") !== applicationId || !parsed) {
      throw new Error("bot005_forum_confirm_interaction_invalid");
    }
    const ownerId = await getGuildOwnerId(guildId);
    if (!validSnowflake(ownerId)) throw new Error("discord_forum_confirm_owner_unavailable");
    let content = "This confirmation is not valid for this owner, message, or channel. No change was made.";
    if (String(userId) === ownerId) {
      const actor = { actorId: userId, guildId, channelId, messageId };
      if (parsed.action === "cancel") {
        const cancelled = await confirmationStore.cancel(parsed.id, actor);
        content = cancelled.status === "cancelled"
          ? "Operation cancelled. No changes were made."
          : "This confirmation is expired or already used. No change was made.";
      } else {
        const claimed = await confirmationStore.claim(parsed.id, actor);
        if (claimed.status === "claimed") {
          let result;
          try {
            result = await executeConfirmed(claimed.plan);
            if (!result || !["completed", "failed", "unknown"].includes(result.state)) {
              result = { state: "unknown", code: "invalid_executor_result" };
            }
          } catch {
            result = { state: "unknown", code: "executor_outcome_unknown" };
          }
          await confirmationStore.finish(parsed.id, result);
          content = result.state === "completed"
            ? "The confirmed change completed and was verified."
            : result.state === "unknown"
              ? "The change outcome could not be verified. Check the current Discord state before retrying."
              : "The change was not applied. No additional action was attempted.";
        } else if (claimed.status === "binding_mismatch") {
          content = "This confirmation is not valid for this message or channel. No change was made.";
        } else {
          content = "This confirmation is expired or already used. No change was made.";
        }
      }
    }
    await editDeferredReply({ applicationId, token: interaction.token, content: safeText(content, 500), components: [] });
    return { committed: true, receiptId: "bot005-forum-confirm-" + interaction.id };
  };
}
