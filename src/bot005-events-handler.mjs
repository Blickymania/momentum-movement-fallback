function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
function safeEventName(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "@\u200b").replace(/[\\\x60*_~|>]/g, "\\$&")
    .trim().slice(0, 70) || "Untitled event";
}
export function createBot005EventsHandler({ revealInteraction, editDeferredReply, getScheduledEvents, guildId, applicationId } = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      typeof getScheduledEvents !== "function" || !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 events handler dependencies are invalid");
  }
  return async function handleBot005Events(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" || String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_events_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    const userId = interaction?.member?.user?.id ?? interaction?.user?.id;
    if (Number(interaction?.type) !== 2 || String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId || interaction?.data?.name !== "events" ||
        !validSnowflake(interaction?.id) || !validSnowflake(userId) || typeof interaction.token !== "string") {
      throw new Error("bot005_events_interaction_invalid");
    }
    let content;
    try {
      const records = await getScheduledEvents(guildId);
      if (!Array.isArray(records)) throw new Error("discord_events_response_invalid");
      const active = records.filter((record) => record && String(record.guild_id ?? "") === guildId &&
        [1, 2].includes(Number(record.status)) && typeof record.name === "string")
        .map((record) => ({ name: safeEventName(record.name), time: Date.parse(record.scheduled_start_time) }))
        .filter((record) => Number.isFinite(record.time)).sort((a, b) => a.time - b.time).slice(0, 8);
      content = active.length ? "**Server events**\n" + active.map((record) =>
        "• " + record.name + " — " + new Date(record.time).toISOString()).join("\n")
        : "No scheduled server events were returned.";
    } catch {
      content = "Server events could not be retrieved with the current bot permissions. No changes were made.";
    }
    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-events-" + interaction.id };
  };
}
