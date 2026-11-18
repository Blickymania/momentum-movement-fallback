function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

const STATUS_COMMANDS = new Set(["bot-status", "botstatus"]);
const SAFE_STATES = new Set([
  "stopped", "connecting", "identifying", "resuming", "ready", "connected",
  "reconnect_wait", "auth_wait", "fatal", "heartbeat_unacknowledged", "queue_full",
]);

export function createBot005StatusHandler({
  revealInteraction,
  editDeferredReply,
  getStatus,
  guildId,
  applicationId,
} = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getStatus !== "function" || !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 status handler dependencies are invalid");
  }

  return async function handleBot005Status(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" ||
        String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_status_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    const userId = interaction?.member?.user?.id ?? interaction?.user?.id;
    if (Number(interaction?.type) !== 2 ||
        String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId ||
        !STATUS_COMMANDS.has(interaction?.data?.name) ||
        !validSnowflake(interaction?.id) || !validSnowflake(userId) ||
        typeof interaction.token !== "string") {
      throw new Error("bot005_status_interaction_invalid");
    }

    const snapshot = await getStatus();
    const identity = snapshot?.clients?.find((client) =>
      client.guildId === guildId && client.applicationId === applicationId
    );
    const state = SAFE_STATES.has(identity?.status) ? identity.status : "unavailable";
    const content = "Momentum Movement migration candidate Gateway state: " + state +
      ". This reports connection state only; Bot 005 feature parity is not verified.";
    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-status-" + interaction.id };
  };
}
