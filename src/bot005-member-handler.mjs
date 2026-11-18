function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
function safeUsername(value) {
  return String(value ?? "unknown").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "@\u200b").replace(/[\\\x60*_~|>]/g, "\\$&").trim().slice(0, 120) || "unknown";
}
export function createBot005MemberHandler({ revealInteraction, editDeferredReply, getGuildMember, guildId, applicationId } = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getGuildMember !== "function" || !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 member handler dependencies are invalid");
  }
  return async function handleBot005Member(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" || String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_member_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    if (Number(interaction?.type) !== 2 || String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId || interaction?.data?.name !== "member" ||
        !validSnowflake(interaction?.id) || typeof interaction.token !== "string") {
      throw new Error("bot005_member_interaction_invalid");
    }
    const options = interaction.data?.options;
    const userOption = Array.isArray(options) ? options.find((option) => option?.name === "user") : null;
    const userId = userOption?.type === 6 ? userOption.value : null;
    const user = validSnowflake(userId) ? interaction.data?.resolved?.users?.[userId] : null;
    if (!validSnowflake(userId) || String(user?.id ?? "") !== userId || typeof user.username !== "string") {
      throw new Error("bot005_member_target_invalid");
    }

    let member = null;
    try {
      member = await getGuildMember(guildId, userId);
      if (member && String(member?.user?.id ?? "") !== userId) member = null;
    } catch { member = null; }
    const joinedAt = Date.parse(member?.joined_at);
    const joined = Number.isFinite(joinedAt) ? new Date(joinedAt).toISOString().slice(0, 10) : "not available";
    const content = "**Member**: " + safeUsername(user.username) + "\nJoined: " + joined +
      "\nBot account: " + (user.bot === true ? "Yes" : "No");
    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-member-" + interaction.id };
  };
}
