const CORE_COMMANDS = Object.freeze([
  "addtocase","announce","audit","automod","ban","bot-status","botconfig","botstatus",
  "channelorder","channelposition","chatfirst","closecase","eventcreate","events","help",
  "kick","lock","member","ping","poll","purge","report","role","rules","server","slowmode",
  "statsset","statsstatus","support","tiktok","timeout","unban","warn","dashboard",
  "bot-test","forum-admin",
]);

const HANDLERS = Object.freeze([
  "bot005",
  "bot005-profile-modal",
  "bot005-ping",
  "bot005-status",
  "bot005-rules",
  "bot005-statsstatus",
  "bot005-events",
  "bot005-member",
  "bot005-server",
  "bot005-help",
  "bot005-tiktok",
  "bot005-forum-diagnose",
  "bot005-forum-inspect",
  "social-owner-console",
  "fan-club-level-up",
  "discord-engagement-engine",
  "gift-assist",
  "live-events-listener",
  "live-now-v2",
]);

const BOT005_PREFIXES = Object.freeze([
  "coach:","membercard:","memberdir:","profilev7:","mp26:",
  "memberdata:","dcp:","mm005:",
]);

const SOCIAL_BOOKS = Object.freeze({
  birthday: { channelId: "1565643958665740288", messageId: "1566062901419180154" },
  anniversary: { channelId: "1565643992178237474", messageId: "1566062910386479189" },
});

const FAN_CLUB_PROFILE_HUB = Object.freeze({
  channelId: "1565643954811052057",
  messageId: "1566063315191595019",
});

function safeId(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

function interactionTarget(interaction) {
  return {
    guildId: interaction.guild_id ?? null,
    channelId: interaction.channel_id ?? null,
    messageId: interaction.message?.id ?? null,
    applicationId: interaction.application_id ?? null,
  };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("Gateway handler manifest must be an object");
  }
  if (!safeId(manifest.guildId) || !safeId(manifest.applicationId)) {
    throw new TypeError("Gateway handler manifest requires a verified guild and application ID");
  }
  const livePublisher = manifest.livePublisher ?? "none";
  if (!["none","live-events-listener","live-now-v2"].includes(livePublisher)) {
    throw new TypeError("Select at most one LIVE publisher");
  }
  if (!Array.isArray(manifest.enabledHandlers)) {
    throw new TypeError("enabledHandlers must be an explicit array");
  }
  const enabled = new Set(manifest.enabledHandlers);
  for (const id of enabled) {
    if (!HANDLERS.includes(id) || id === "live-events-listener" || id === "live-now-v2") {
      throw new TypeError("Unknown handler or invalid LIVE publisher configuration: " + id);
    }
  }
  if (manifest.liveChannelId !== undefined && !safeId(manifest.liveChannelId)) {
    throw new TypeError("liveChannelId must be a Discord snowflake when configured");
  }
  return Object.freeze({
    guildId: manifest.guildId,
    applicationId: manifest.applicationId,
    liveChannelId: manifest.liveChannelId ?? null,
    livePublisher,
    enabledHandlers: enabled,
  });
}

function enabled(config, id) {
  if (id === "live-events-listener" || id === "live-now-v2") {
    return config.livePublisher === id;
  }
  return config.enabledHandlers.has(id);
}

function interactionRoute(config, interaction) {
  const target = interactionTarget(interaction);
  if (target.applicationId && target.applicationId !== config.applicationId) {
    return { status: "ignored", reason: "application_mismatch", handlers: [] };
  }
  if (target.guildId && target.guildId !== config.guildId) {
    return { status: "ignored", reason: "guild_mismatch", handlers: [] };
  }

  const data = interaction.data ?? {};
  const customId = typeof data.custom_id === "string" ? data.custom_id : "";
  if (customId) {
    let owner = null;

    if (interaction.type === 5 && ["memberdata:profile", "memberdata:birthday", "memberdata:anniversary"].includes(customId)) {
      owner = "bot005-profile-modal";
    } else if (customId.startsWith("cw:")) {
      owner = "live-events-listener";
    } else if (customId.startsWith("ln2:")) {
      owner = "live-now-v2";
    } else if (customId.startsWith("ddxp:")) {
      owner = "discord-engagement-engine";
    } else if (customId.startsWith("gift:")) {
      owner = "gift-assist";
    } else if (customId.startsWith("fclub:") || customId.startsWith("ums:")) {
      owner = "fan-club-level-up";
    } else if (customId === "uniprof:member") {
      owner = target.channelId === FAN_CLUB_PROFILE_HUB.channelId &&
        target.messageId === FAN_CLUB_PROFILE_HUB.messageId
        ? "fan-club-level-up"
        : "bot005";
    } else if (customId.startsWith("uniprof:")) {
      owner = "bot005";
    } else if (customId.startsWith("mompass:")) {
      const socialBook = Object.values(SOCIAL_BOOKS).some((book) =>
        target.channelId === book.channelId && target.messageId === book.messageId
      );
      owner = socialBook ? "social-owner-console" : "bot005";
    } else if (customId.startsWith("social3:") || customId.startsWith("db10:")) {
      owner = "social-owner-console";
    } else if (BOT005_PREFIXES.some((prefix) => customId.startsWith(prefix))) {
      owner = "bot005";
    }

    if (!owner) return { status: "unhandled", reason: "unknown_component", handlers: [] };
    if (!enabled(config, owner)) {
      return { status: "disabled", reason: "handler_disabled", handler: owner, handlers: [] };
    }
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: [owner], routeKey: customId.split(":")[0] };
  }

  if (data.name === "tiktok" && enabled(config, "bot005-tiktok")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-tiktok"], routeKey: "command:tiktok" };
  }

  if (data.name === "forum-admin" && data.options?.[0]?.name === "inspect" && enabled(config, "bot005-forum-inspect")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-forum-inspect"], routeKey: "command:forum-admin:inspect" };
  }

  if (data.name === "forum-admin" && data.options?.[0]?.name === "diagnose" && enabled(config, "bot005-forum-diagnose")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-forum-diagnose"], routeKey: "command:forum-admin:diagnose" };
  }

  if (data.name === "help" && enabled(config, "bot005-help")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-help"], routeKey: "command:help" };
  }

  if (["server", "dashboard"].includes(data.name) && enabled(config, "bot005-server")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-server"], routeKey: "command:" + data.name };
  }

  if (data.name === "member" && enabled(config, "bot005-member")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-member"], routeKey: "command:member" };
  }

  if (data.name === "events" && enabled(config, "bot005-events")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-events"], routeKey: "command:events" };
  }

  if (data.name === "statsstatus" && enabled(config, "bot005-statsstatus")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-statsstatus"], routeKey: "command:statsstatus" };
  }

  if (data.name === "rules" && enabled(config, "bot005-rules")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-rules"], routeKey: "command:rules" };
  }

  if (data.name === "ping" && enabled(config, "bot005-ping")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-ping"], routeKey: "command:ping" };
  }

  if (["bot-status", "botstatus"].includes(data.name) && enabled(config, "bot005-status")) {
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005-status"], routeKey: "command:" + data.name };
  }

  if (typeof data.name === "string" && CORE_COMMANDS.includes(data.name)) {
    if (!enabled(config, "bot005")) {
      return { status: "disabled", reason: "handler_disabled", handler: "bot005", handlers: [] };
    }
    return { status: "routed", eventType: "INTERACTION_CREATE", handlers: ["bot005"], routeKey: "command:" + data.name };
  }

  return { status: "unhandled", reason: "unknown_interaction", handlers: [] };
}

/**
 * Resolve a Discord Gateway dispatch to its original feature owner(s).
 *
 * This module only classifies ownership. It never calls Discord, acknowledges
 * an interaction, sends messages, mutates data or activates a source service.
 */
export function createGatewayHandlerRegistry(manifest) {
  const config = validateManifest(manifest);

  return Object.freeze({
    manifest: Object.freeze({
      guildId: config.guildId,
      applicationId: config.applicationId,
      liveChannelId: config.liveChannelId,
      livePublisher: config.livePublisher,
      enabledHandlers: [...config.enabledHandlers].sort(),
    }),

    route(event) {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new TypeError("Gateway dispatch event must be an object");
      }
      const eventType = event.eventType;
      const payload = event.payload;
      if (typeof eventType !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError("Gateway dispatch event is missing its type or payload");
      }

      if (eventType === "INTERACTION_CREATE") return interactionRoute(config, payload);

      if (eventType === "MESSAGE_CREATE") {
        if (String(payload.guild_id ?? "") !== config.guildId) {
          return { status: "ignored", reason: "guild_mismatch", handlers: [] };
        }
        const handlers = [];
        if (enabled(config, "discord-engagement-engine")) handlers.push("discord-engagement-engine");
        const publisher = config.livePublisher;
        if (publisher !== "none" && enabled(config, publisher) &&
            config.liveChannelId && String(payload.channel_id ?? "") === config.liveChannelId) {
          handlers.push(publisher);
        }
        return handlers.length
          ? { status: "routed", eventType, handlers, routeKey: "MESSAGE_CREATE" }
          : { status: "unhandled", reason: "no_message_consumer", handlers: [] };
      }

      return { status: "ignored", reason: "event_not_consumed", handlers: [] };
    },
  });
}

export { CORE_COMMANDS, HANDLERS, FAN_CLUB_PROFILE_HUB, SOCIAL_BOOKS };
