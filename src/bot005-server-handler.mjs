function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
export function createBot005ServerHandler({ revealInteraction, editDeferredReply, getGuildSummary, guildId, applicationId } = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getGuildSummary !== "function" || !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 server handler dependencies are invalid");
  }
  return async function handleBot005Server(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" || String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_server_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    if (Number(interaction?.type) !== 2 || String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId ||
        !["server", "dashboard"].includes(interaction?.data?.name) ||
        !validSnowflake(interaction?.id) || typeof interaction.token !== "string") {
      throw new Error("bot005_server_interaction_invalid");
    }
    let approximateCount = null;
    try {
      const guild = await getGuildSummary(guildId);
      if (String(guild?.id ?? "") === guildId &&
          Number.isSafeInteger(guild?.approximate_member_count) && guild.approximate_member_count >= 0) {
        approximateCount = guild.approximate_member_count;
      }
    } catch {}
    const countText = approximateCount === null ? "unavailable" : "~" + approximateCount.toLocaleString("en-US");
    const content = "**Momentum Movement**\nApprox. members: " + countText +
      "\nGuild identity: verified.\nCommunity Stats and LIVE services operate independently.";
    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-server-" + interaction.id };
  };
}
