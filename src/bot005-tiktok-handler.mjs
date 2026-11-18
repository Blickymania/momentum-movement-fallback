function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
function trustedTikTokUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol !== "https:" || !["tiktok.com", "www.tiktok.com"].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || !/^\/@[A-Za-z0-9._-]+\/?$/.test(url.pathname)) return null;
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch { return null; }
}
export function createBot005TikTokHandler({ revealInteraction, editDeferredReply, configuredUrl = "", guildId, applicationId } = {}) {
  if (typeof revealInteraction !== "function" || typeof editDeferredReply !== "function" ||
      !validSnowflake(guildId) || !validSnowflake(applicationId)) {
    throw new TypeError("Bot 005 TikTok handler dependencies are invalid");
  }
  return async function handleBot005TikTok(event) {
    if (!event || event.eventType !== "INTERACTION_CREATE" || String(event.guildId ?? "") !== guildId) {
      throw new Error("bot005_tiktok_event_identity_mismatch");
    }
    const interaction = await revealInteraction(event.payload);
    if (Number(interaction?.type) !== 2 || String(interaction?.guild_id ?? "") !== guildId ||
        String(interaction?.application_id ?? "") !== applicationId || interaction?.data?.name !== "tiktok" ||
        !validSnowflake(interaction?.id) || typeof interaction.token !== "string") {
      throw new Error("bot005_tiktok_interaction_invalid");
    }
    const url = trustedTikTokUrl(configuredUrl);
    const content = url ? "Official TikTok profile: " + url
      : "Official TikTok URL is not configured for Momentum Movement.";
    await editDeferredReply({ applicationId, token: interaction.token, content });
    return { committed: true, receiptId: "bot005-tiktok-" + interaction.id };
  };
}
