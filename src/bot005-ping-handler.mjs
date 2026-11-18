function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

export function createBot005PingHandler({
  revealInteraction,
  editDeferredReply,
  guildId,
  applicationId,
} = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 ping handler dependencies are invalid");
  }

  return async function handleBot005Ping(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" ||
        String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_ping_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    const userId = interaction?.member?.user?.id ?? interaction?.user?.id;
    if (Number(interaction?.type) !== 2 ||
        String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId ||
        interaction?.data?.name !== "ping" ||
        !validSnowflake(interaction?.id) || !validSnowflake(userId) ||
        typeof interaction.token !== "string") {
      throw new Error("bot005_ping_interaction_invalid");
    }
    await editDeferredReply({ applicationId, token: interaction.token, content: "Pong." });
    return { committed: true, receiptId: "bot005-ping-" + interaction.id };
  };
}
