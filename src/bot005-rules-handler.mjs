function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

export function createBot005RulesHandler({
  revealInteraction,
  editDeferredReply,
  getGuildChannels,
  guildId,
  applicationId,
} = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getGuildChannels !== "function" || !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 rules handler dependencies are invalid");
  }

  return async function handleBot005Rules(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" ||
        String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_rules_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    const userId = interaction?.member?.user?.id ?? interaction?.user?.id;
    if (Number(interaction?.type) !== 2 ||
        String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId ||
        interaction?.data?.name !== "rules" ||
        !validSnowflake(interaction?.id) || !validSnowflake(userId) ||
        typeof interaction.token !== "string") {
      throw new Error("bot005_rules_interaction_invalid");
    }

    let content;
    try {
      const channels = await getGuildChannels(guildId);
      if (!Array.isArray(channels)) throw new Error("discord_rules_channel_response_invalid");
      const rulesChannel = channels.find((channel) => {
        if (!channel || Number(channel.type) !== 0 || !validSnowflake(channel.id)) return false;
        if (String(channel.guild_id ?? channel.guildId ?? "") !== guildId) return false;
        const name = typeof channel.name === "string" ? channel.name.normalize("NFKC").toLowerCase() : "";
        return /rules|guidelines/.test(name);
      });
      content = rulesChannel
        ? "Community rules: <#" + rulesChannel.id + ">"
        : "The rules channel was not found automatically. No channel was created.";
    } catch {
      content = "The rules channel could not be checked right now. No channels were changed.";
    }

    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-rules-" + interaction.id };
  };
}
