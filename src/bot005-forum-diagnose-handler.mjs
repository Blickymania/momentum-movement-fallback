function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
function forumCount(channels, guildId) {
  if (!Array.isArray(channels)) throw new Error("discord_forum_diagnose_channels_invalid");
  return channels.filter((channel) =>
    channel?.guild_id === guildId && Number(channel.type) === 15 && validSnowflake(channel.id)
  ).length;
}
export function createBot005ForumDiagnoseHandler({
  revealInteraction, editDeferredReply, getGuildOwnerId, getGuildChannels, guildId, applicationId,
} = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getGuildOwnerId !== "function" || typeof getGuildChannels !== "function" ||
      !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 forum diagnose dependencies are invalid");
  }
  return async function handleBot005ForumDiagnose(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" || String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_forum_diagnose_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    if (Number(interaction?.type) !== 2 || String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId ||
        interaction?.data?.name !== "forum-admin" ||
        interaction?.data?.options?.[0]?.name !== "diagnose" ||
        !validSnowflake(interaction?.id) || typeof interaction.token !== "string") {
      throw new Error("bot005_forum_diagnose_interaction_invalid");
    }
    const ownerId = await getGuildOwnerId(guildId);
    if (!validSnowflake(ownerId)) throw new Error("discord_forum_diagnose_owner_unavailable");
    const userId = interaction.member?.user?.id ?? interaction.user?.id;
    const authorized = String(userId ?? "") === ownerId;
    let content = "Forum diagnosis is restricted to the server owner.";
    if (authorized) {
      const count = forumCount(await getGuildChannels(guildId), guildId);
      content = "**Forum diagnosis (read-only)**\n" +
        "Forums visible to this bot: " + count + ".\n" +
        "Discord omits channels this bot cannot view, so this is not a complete forum or permission audit. " +
        "No channel settings, tags, or threads were changed.";
    }
    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-forum-diagnose-" + interaction.id };
  };
}
