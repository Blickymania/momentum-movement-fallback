import { parseBot005ProfileModal } from "./bot005-profile-modal.mjs";

const SAVED_MESSAGE = "Your profile details were saved. Public profile and milestone display is not enabled in this migration candidate.";

function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

/**
 * Durable dispatcher adapter for Bot 005 profile modal submits.
 * The deferred original interaction response is edited only after the profile
 * store commits; retries repeat the same idempotent PATCH.
 */
export function createBot005ProfileModalHandler({
  store,
  revealInteraction,
  editDeferredReply,
  guildId,
  applicationId,
} = {}) {
  if (!store || typeof store.apply !== "function" ||
      typeof revealInteraction !== "function" ||
      typeof editDeferredReply !== "function" ||
      !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 profile handler dependencies are invalid");
  }

  return async function handleBot005ProfileModal(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" ||
        String(event.guildId ?? "") !== guildId ||
        String(event.payload?.application_id ?? "") !== applicationId) {
      throw new Error("bot005_profile_event_identity_mismatch");
    }

    const interaction = await revealInteraction(event.payload);
    const submission = parseBot005ProfileModal(interaction, { guildId, applicationId });
    if (submission.status !== "ready") throw new Error(submission.reason);

    const receipt = await store.apply(submission);
    if (receipt?.committed !== true || typeof receipt.receiptId !== "string") {
      throw new Error("bot005_profile_store_receipt_missing");
    }

    await editDeferredReply({
      applicationId,
      token: interaction.token,
      content: SAVED_MESSAGE,
    });
    return { committed: true, receiptId: receipt.receiptId };
  };
}

export { SAVED_MESSAGE };
