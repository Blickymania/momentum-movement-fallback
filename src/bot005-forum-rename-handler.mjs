function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
function cleanTitle(value) {
  return String(value ?? "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "@\u200b")
    .replace(/[*_~|\\]/g, "")
    .split(String.fromCharCode(96)).join("")
    .trim();
}
function display(value, max = 100) {
  return String(value ?? "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "@\u200b")
    .replace(/[*_~|\\]/g, "")
    .split(String.fromCharCode(96)).join("")
    .trim().slice(0, max);
}
function samePlan(plan, userId, guildId, channelId, threadId, forumId, before, title) {
  const p = plan?.payload;
  return plan?.kind === "forum-rename" && plan.actorId === userId &&
    plan.guildId === guildId && plan.channelId === channelId &&
    p?.threadId === threadId && p?.forumId === forumId &&
    p?.before === before && p?.title === title;
}
export function createBot005ForumRenameHandler({
  confirmationStore, revealInteraction, editDeferredReply, getGuildOwnerId, getChannel,
  guildId, applicationId,
} = {}) {
  if (!confirmationStore || typeof confirmationStore.create !== "function" ||
      typeof confirmationStore.get !== "function" || typeof confirmationStore.bindMessage !== "function" ||
      typeof confirmationStore.discardUnbound !== "function" ||
      typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getGuildOwnerId !== "function" || typeof getChannel !== "function" ||
      !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 forum rename dependencies are invalid");
  }
  return async function handleBot005ForumRename(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" || String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_forum_rename_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    const subcommand = interaction?.data?.options?.[0];
    const options = Array.isArray(subcommand?.options) ? subcommand.options : [];
    const threadId = options.find((option) => option?.name === "thread_id")?.value;
    const rawTitle = options.find((option) => option?.name === "title")?.value;
    if (Number(interaction?.type) !== 2 || String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId ||
        interaction?.data?.name !== "forum-admin" || subcommand?.name !== "rename" ||
        !validSnowflake(interaction?.id) || typeof interaction.token !== "string" ||
        !validSnowflake(interaction?.channel_id) || !validSnowflake(threadId) ||
        typeof rawTitle !== "string") {
      throw new Error("bot005_forum_rename_interaction_invalid");
    }
    const ownerId = await getGuildOwnerId(guildId);
    if (!validSnowflake(ownerId)) throw new Error("discord_forum_rename_owner_unavailable");
    const userId = interaction.member?.user?.id ?? interaction.user?.id;
    let content = "Forum changes are restricted to the server owner. No changes were made.";
    if (String(userId ?? "") === ownerId) {
      const title = cleanTitle(rawTitle);
      if (rawTitle.length < 3 || rawTitle.length > 100 || title.length < 3 || title.length > 100) {
        content = "Enter a different title between 3 and 100 characters. No changes were made.";
      } else {
        const thread = await getChannel(threadId);
        if (!thread || String(thread.id ?? "") !== threadId ||
            String(thread.guild_id ?? "") !== guildId || Number(thread.type) !== 11 ||
            !validSnowflake(thread.parent_id) || typeof thread.name !== "string" ||
            thread.name.length < 1 || thread.name.length > 100) {
          content = "That public forum discussion is unavailable or outside this server. No changes were made.";
        } else {
          const forum = await getChannel(thread.parent_id);
          if (!forum || String(forum.id ?? "") !== String(thread.parent_id) ||
              String(forum.guild_id ?? "") !== guildId || Number(forum.type) !== 15) {
            content = "The parent forum could not be verified. No changes were made.";
          } else if (thread.name === title) {
            content = "The discussion already has that title. No changes were made.";
          } else {
            const planId = interaction.id;
            const payload = { threadId, forumId: thread.parent_id, before: thread.name, title };
            const created = await confirmationStore.create({
              id: planId, kind: "forum-rename", actorId: String(userId), guildId,
              channelId: interaction.channel_id,
              expiresAt: Date.now() + 120_000, payload,
            });
            let plan = created.plan;
            if (created.status === "duplicate") plan = await confirmationStore.get(planId);
            if (created.status === "capacity") {
              content = "The confirmation queue is full. No changes were made; try again later.";
            } else if (!plan || !samePlan(plan, String(userId), guildId, interaction.channel_id, threadId, thread.parent_id, thread.name, title)) {
              throw new Error("bot005_forum_rename_plan_conflict");
            } else if (plan.state !== "pending") {
              content = "This rename confirmation is expired or already used. No changes were made.";
            } else {
              const prefix = "mm005:forum-confirm:";
              const components = [{ type: 1, components: [
                { type: 2, style: 3, label: "Confirm", custom_id: prefix + "confirm:" + planId },
                { type: 2, style: 4, label: "Cancel", custom_id: prefix + "cancel:" + planId },
              ] }];
              const summary = "**Forum rename — confirmation required**\n" +
                "Discussion: " + display(thread.name) + "\n" +
                "New title: " + display(title) + "\n" +
                "No forum content has changed. Confirm within two minutes or cancel.";
              const edited = await editDeferredReply({ applicationId, token: interaction.token, content: summary, components });
              if (!edited?.updated || !validSnowflake(edited.messageId)) {
                await editDeferredReply({ applicationId, token: interaction.token,
                  content: "The confirmation could not be securely bound to its message. No change was made.",
                  components: [] }).catch(() => {});
                await confirmationStore.discardUnbound(planId);
                content = "The confirmation could not be bound to its message. No changes were made.";
              } else {
                const bound = await confirmationStore.bindMessage(planId, edited.messageId);
                if (bound.status !== "bound") {
                  await editDeferredReply({ applicationId, token: interaction.token,
                    content: "The confirmation could not be securely bound. No change was made.",
                    components: [] }).catch(() => {});
                  await confirmationStore.discardUnbound(planId);
                  content = "The confirmation could not be bound. No changes were made.";
                } else {
                  return { committed: true, receiptId: "bot005-forum-rename-" + interaction.id };
                }
              }
            }
          }
        }
      }
    }
    await editDeferredReply({ applicationId, token: interaction.token, content, components: [] });
    return { committed: true, receiptId: "bot005-forum-rename-" + interaction.id };
  };
}
