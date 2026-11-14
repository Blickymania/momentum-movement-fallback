const VIEW_CHANNEL = 1n << 10n;
const PRIVATE_THREAD_TYPES = new Set([12]);

function snowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

function jsonHeaders(token) {
  return { authorization: "Bot " + token };
}

function responseJson(value) {
  return value && typeof value === "object" ? value : {};
}

function viewChannelForEveryone(channel, everyoneRole) {
  let permissions = 0n;
  try { permissions = BigInt(everyoneRole?.permissions ?? "0"); }
  catch { return false; }
  const overwrite = (channel.permission_overwrites || []).find((item) =>
    String(item.id) === String(channel.guild_id) && Number(item.type) === 0
  );
  if (!overwrite) return (permissions & VIEW_CHANNEL) === VIEW_CHANNEL;
  let allow = 0n;
  let deny = 0n;
  try {
    allow = BigInt(overwrite.allow ?? "0");
    deny = BigInt(overwrite.deny ?? "0");
  } catch { return false; }
  permissions = (permissions & ~deny) | allow;
  return (permissions & VIEW_CHANNEL) === VIEW_CHANNEL;
}

/**
 * Resolve a Gateway message to a verified public text channel.
 *
 * Fetches Discord channel metadata and the guild @everyone role. Cache only
 * role permissions, never content or member data. Private threads, NSFW rooms,
 * cross-guild channels and named sensitive rooms are excluded.
 */
export function createDiscordEngagementChannelResolver({
  token,
  guildId = "1565048205970767992",
  fetchImpl = fetch,
  now = () => Date.now(),
  cacheMs = 5 * 60_000,
  timeoutSignal = (ms) => AbortSignal.timeout(ms),
} = {}) {
  if (typeof token !== "string" || token.trim().length < 20 ||
      !snowflake(guildId) || typeof fetchImpl !== "function" ||
      typeof now !== "function" || !Number.isSafeInteger(cacheMs) || cacheMs < 0 ||
      typeof timeoutSignal !== "function") {
    throw new TypeError("Engagement channel resolver configuration is invalid");
  }
  const secret = token.trim();
  let rolesCache = null;
  let rolesExpiry = 0;

  async function fetchDiscord(path) {
    const response = await fetchImpl("https://discord.com/api/v10" + path, {
      headers: jsonHeaders(secret),
      signal: timeoutSignal(9000),
    });
    const value = responseJson(await response.json().catch(() => ({})));
    if (response.status === 401 || response.status === 403) {
      return { denied: true, status: response.status, value };
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Error("discord_channel_policy_temporarily_unavailable");
    }
    if (!response.ok) return { denied: true, status: response.status, value };
    return { denied: false, status: response.status, value };
  }

  async function everyoneRole() {
    if (rolesCache && rolesExpiry > now()) return rolesCache;
    const response = await fetchDiscord("/guilds/" + guildId + "/roles");
    if (response.denied) return null;
    if (!Array.isArray(response.value)) throw new Error("discord_roles_response_invalid");
    const role = response.value.find((item) => String(item.id) === guildId);
    if (!role) throw new Error("discord_everyone_role_missing");
    rolesCache = role;
    rolesExpiry = now() + cacheMs;
    return role;
  }

  return async function resolveEngagementChannel(message) {
    if (!message || String(message.guild_id ?? "") !== guildId ||
        !snowflake(String(message.channel_id ?? ""))) {
      return { eligible: false, reason: "guild_or_channel_mismatch" };
    }
    const channelResponse = await fetchDiscord("/channels/" + message.channel_id);
    if (channelResponse.denied) return { eligible: false, reason: "channel_not_visible" };
    const channel = channelResponse.value;
    if (String(channel.guild_id ?? "") !== guildId || !snowflake(String(channel.id ?? ""))) {
      return { eligible: false, reason: "channel_scope_mismatch" };
    }
    if (PRIVATE_THREAD_TYPES.has(Number(channel.type))) {
      return { eligible: false, reason: "private_thread" };
    }

    const isThread = Boolean(channel.parent_id);
    const base = isThread
      ? await (async () => {
          const parent = await fetchDiscord("/channels/" + channel.parent_id);
          return parent.denied ? null : parent.value;
        })()
      : channel;
    if (!base || String(base.guild_id ?? "") !== guildId ||
        !snowflake(String(base.id ?? ""))) {
      return { eligible: false, reason: "parent_channel_scope_mismatch" };
    }
    if (isThread && ![10, 11].includes(Number(channel.type))) {
      return { eligible: false, reason: "unsupported_thread_type" };
    }
    if (!isThread && ![0, 5].includes(Number(channel.type))) {
      return { eligible: false, reason: "not_a_public_text_channel" };
    }
    if (channel.nsfw === true || base.nsfw === true) {
      return { eligible: false, reason: "nsfw_channel" };
    }

    const role = await everyoneRole();
    if (!role || !viewChannelForEveryone(base, role)) {
      return { eligible: false, reason: "everyone_cannot_view_channel" };
    }
    const nameContext = [
      base.name || "",
      base.parent?.name || "",
      channel.name || "",
    ].join(" ").normalize("NFKC").toLowerCase();
    if (/safe.space|moderator|staff|admin|conference|meeting.room|recruit|incident|owner|security|private|prayer|faith|birthday|medical|crisis|system.health|server.tools|case.review|help.desk|coaching.request|support.case|mod.only/i.test(nameContext)) {
      return { eligible: false, reason: "sensitive_channel_name" };
    }
    return {
      eligible: true,
      guildId,
      channelId: String(channel.id),
      baseChannelId: String(base.id),
      nameContext,
      everyoneCanView: true,
      nsfw: false,
      isThread,
    };
  };
}
