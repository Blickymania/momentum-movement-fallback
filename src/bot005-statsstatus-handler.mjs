const STATS_CHANNEL_ID = "1566030504635924600";

function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

function safeChannelName(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/@/g, "@\u200b").trim().slice(0, 100) || "unavailable";
}

export function createBot005StatsStatusHandler({
  revealInteraction,
  editDeferredReply,
  getStatsChannel,
  guildId,
  applicationId,
} = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getStatsChannel !== "function" || !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 statsstatus handler dependencies are invalid");
  }

  return async function handleBot005StatsStatus(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" ||
        String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_statsstatus_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    const userId = interaction?.member?.user?.id ?? interaction?.user?.id;
    if (Number(interaction?.type) !== 2 ||
        String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId ||
        interaction?.data?.name !== "statsstatus" ||
        !validSnowflake(interaction?.id) || !validSnowflake(userId) ||
        typeof interaction.token !== "string") {
      throw new Error("bot005_statsstatus_interaction_invalid");
    }

    let content;
    try {
      const channel = await getStatsChannel(STATS_CHANNEL_ID);
      if (String(channel?.id ?? "") !== STATS_CHANNEL_ID ||
          String(channel?.guild_id ?? channel?.guildId ?? "") !== guildId ||
          Number(channel?.type) !== 2) {
        throw new Error("discord_stats_channel_identity_mismatch");
      }
      content = "**Momentum Movement — Verified Statistics**\n" +
        "LIVE display: " + safeChannelName(channel.name) + "\n" +
        "Member and role counts update through the independent Community Stats Sync.\n" +
        "TikTok coin and diamond totals are withheld until creator-confirmed values are available.";
    } catch {
      content = "The verified statistics display is temporarily unavailable. No values were invented.";
    }

    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-statsstatus-" + interaction.id };
  };
}
