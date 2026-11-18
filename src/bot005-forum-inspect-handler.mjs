function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
function safeTagName(value) {
  return String(value ?? "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "@\u200b")
    .replace(/[*_~|\\]/g, "")
    .split(String.fromCharCode(96)).join("")
    .trim()
    .slice(0, 20);
}
export function createBot005ForumInspectHandler({
  revealInteraction, editDeferredReply, getGuildOwnerId, getForumChannel, guildId, applicationId,
} = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getGuildOwnerId !== "function" || typeof getForumChannel !== "function" ||
      !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 forum inspect dependencies are invalid");
  }
  return async function handleBot005ForumInspect(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" || String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_forum_inspect_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    const subcommand = interaction?.data?.options?.[0];
    const forumOption = Array.isArray(subcommand?.options)
      ? subcommand.options.find((option) => option?.name === "forum")
      : null;
    const forumId = forumOption?.value;
    if (Number(interaction?.type) !== 2 || String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId ||
        interaction?.data?.name !== "forum-admin" || subcommand?.name !== "inspect" ||
        !validSnowflake(interaction?.id) || typeof interaction.token !== "string" ||
        !validSnowflake(forumId)) {
      throw new Error("bot005_forum_inspect_interaction_invalid");
    }
    const ownerId = await getGuildOwnerId(guildId);
    if (!validSnowflake(ownerId)) throw new Error("discord_forum_inspect_owner_unavailable");
    const userId = interaction.member?.user?.id ?? interaction.user?.id;
    let content = "Forum inspection is restricted to the server owner.";
    if (String(userId ?? "") === ownerId) {
      const channel = await getForumChannel(forumId);
      if (String(channel?.id ?? "") !== forumId || String(channel?.guild_id ?? "") !== guildId ||
          Number(channel?.type) !== 15) {
        throw new Error("discord_forum_inspect_channel_identity_mismatch");
      }
      if (!Array.isArray(channel.available_tags) || channel.available_tags.length > 20) {
        throw new Error("discord_forum_inspect_tags_invalid");
      }
      const tags = channel.available_tags.map((tag) => {
        if (!validSnowflake(tag?.id) || typeof tag?.name !== "string" || typeof tag?.moderated !== "boolean") {
          throw new Error("discord_forum_inspect_tag_invalid");
        }
        return { name: safeTagName(tag.name), moderated: tag.moderated };
      });
      const rows = tags.length
        ? tags.map((tag) => "• " + tag.name + (tag.moderated ? " (moderated)" : "")).join("\n")
        : "No configured tags were returned.";
      content = "**Forum tag inspection (read-only)**\n" + rows +
        "\nOnly the selected same-guild forum was read. No tags, threads, or channel settings were changed.";
    }
    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-forum-inspect-" + interaction.id };
  };
}
