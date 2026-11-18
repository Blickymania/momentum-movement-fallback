function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
export function createBot005HelpHandler({ revealInteraction, editDeferredReply, guildId, applicationId } = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 help handler dependencies are invalid");
  }
  return async function handleBot005Help(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" || String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_help_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    if (Number(interaction?.type) !== 2 || String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId || interaction?.data?.name !== "help" ||
        !validSnowflake(interaction?.id) || typeof interaction.token !== "string") {
      throw new Error("bot005_help_interaction_invalid");
    }
    const content = "**Momentum Movement — Bot 005 candidate status**\n" +
      "Coded slash-command names: /ping, /bot-status, /botstatus, /rules, /statsstatus, /events, /member, /server, /dashboard, /help.\n" +
      "The other 26 of the 36 recovered command names are not coded in this candidate.\n" +
      "All candidate feature flags are off. Production remains on Railway; this response does not indicate a live cutover.";
    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-help-" + interaction.id };
  };
}
