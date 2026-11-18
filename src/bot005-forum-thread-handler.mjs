function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
function safeDisplay(value, maxLength = 100) {
  return String(value ?? "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "@\u200b")
    .replace(/[*_~|\\]/g, "")
    .split(String.fromCharCode(96)).join("")
    .trim()
    .slice(0, maxLength);
}
export function createBot005ForumThreadHandler({
  revealInteraction, editDeferredReply, getGuildOwnerId, getChannel, guildId, applicationId,
} = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getGuildOwnerId !== "function" || typeof getChannel !== "function" ||
      !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 forum thread dependencies are invalid");
  }
  return async function handleBot005ForumThread(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" || String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_forum_thread_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    const subcommand = interaction?.data?.options?.[0];
    const threadId = Array.isArray(subcommand?.options)
      ? subcommand.options.find((option) => option?.name === "thread_id")?.value
      : null;
    if (Number(interaction?.type) !== 2 || String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId ||
        interaction?.data?.name !== "forum-admin" || subcommand?.name !== "thread" ||
        !validSnowflake(interaction?.id) || typeof interaction.token !== "string" ||
        !validSnowflake(threadId)) {
      throw new Error("bot005_forum_thread_interaction_invalid");
    }
    const ownerId = await getGuildOwnerId(guildId);
    if (!validSnowflake(ownerId)) throw new Error("discord_forum_thread_owner_unavailable");
    const userId = interaction.member?.user?.id ?? interaction.user?.id;
    let content = "Forum discussion inspection is restricted to the server owner.";
    if (String(userId ?? "") === ownerId) {
      const thread = await getChannel(threadId);
      if (!thread) {
        content = "That forum discussion is not available to this bot.";
      } else {
        if (String(thread.id ?? "") !== threadId || String(thread.guild_id ?? "") !== guildId ||
            Number(thread.type) !== 11 || !validSnowflake(thread.parent_id)) {
          throw new Error("discord_forum_thread_identity_mismatch");
        }
        const parent = await getChannel(thread.parent_id);
        if (!parent) {
          content = "The parent forum is not available to this bot.";
        } else {
          if (String(parent.id ?? "") !== String(thread.parent_id) ||
              String(parent.guild_id ?? "") !== guildId || Number(parent.type) !== 15 ||
              !Array.isArray(parent.available_tags) || parent.available_tags.length > 20 ||
              !Array.isArray(thread.applied_tags) ||
              !thread.applied_tags.every(validSnowflake) ||
              !thread.thread_metadata || typeof thread.thread_metadata.archived !== "boolean" ||
              typeof thread.thread_metadata.locked !== "boolean") {
            throw new Error("discord_forum_thread_parent_or_metadata_invalid");
          }
          const tagNames = new Map(parent.available_tags.map((tag) => {
            if (!validSnowflake(tag?.id) || typeof tag?.name !== "string") {
              throw new Error("discord_forum_thread_tag_invalid");
            }
            return [tag.id, safeDisplay(tag.name, 20)];
          }));
          const names = thread.applied_tags.map((id) => tagNames.get(id) ?? "unavailable tag");
          const state = (thread.thread_metadata.archived ? "archived" : "active") +
            (thread.thread_metadata.locked ? ", locked" : ", unlocked");
          content = "**Forum discussion (read-only)**\n" +
            "Title: " + safeDisplay(thread.name) + "\n" +
            "State: " + state + "\n" +
            "Applied tags: " + (names.length ? names.join(", ") : "none") + ".\n" +
            "Metadata only; thread messages were not read. No discussion or forum settings were changed.";
        }
      }
    }
    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-forum-thread-" + interaction.id };
  };
}
