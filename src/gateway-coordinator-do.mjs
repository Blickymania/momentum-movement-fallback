import { GatewayCoordinatorCore } from "./gateway-coordinator-core.mjs";
import { createGatewayHandlerRegistry } from "./gateway-handler-registry.mjs";
import { createInteractionTokenVault } from "./interaction-token-vault.mjs";
import { createBot005InteractionAckPlanner } from "./bot005-interaction-ack-plan.mjs";
import { createDiscordInteractionAcknowledger } from "./discord-interaction-ack.mjs";
import { createBot005ProfileModalHandler } from "./bot005-profile-handler.mjs";
import { createBot005PingHandler } from "./bot005-ping-handler.mjs";
import { createBot005StatusHandler } from "./bot005-status-handler.mjs";
import { createBot005RulesHandler } from "./bot005-rules-handler.mjs";
import { createBot005StatsStatusHandler } from "./bot005-statsstatus-handler.mjs";
import { DurableBot005ProfileStore, createBot005ProfileCipher } from "./durable-bot005-profile-store.mjs";
import { createDiscordDeferredReplyEditor } from "./discord-deferred-reply.mjs";
import { GatewayEventDispatcher, DurableGatewayDeliveryLedger } from "./durable-gateway-dispatcher.mjs";
import { DurableEngagementLedger, createEngagementMessageHandler } from "./durable-engagement-ledger.mjs";
import { createDiscordEngagementChannelResolver } from "./discord-engagement-channel-policy.mjs";

const CONTROL_SECRET_MIN_LENGTH = 32;
const DEFINITIONS_MAX_BYTES = 12 * 1024;
const REQUEST_MAX_BYTES = 4096;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function equalSecret(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string" ||
      actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function readDefinitions(raw) {
  if (typeof raw !== "string" || raw.length === 0 ||
      new TextEncoder().encode(raw).byteLength > DEFINITIONS_MAX_BYTES) {
    throw new TypeError("Gateway client definitions are not configured or exceed the size limit");
  }
  let definitions;
  try { definitions = JSON.parse(raw); }
  catch { throw new TypeError("Gateway client definitions must be valid JSON"); }
  if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > 12) {
    throw new TypeError("Gateway client definitions must contain between 1 and 12 entries");
  }
  return definitions;
}

function readHandlerRegistry(raw, definitions) {
  if (typeof raw !== "string" || raw.length === 0 ||
      new TextEncoder().encode(raw).byteLength > DEFINITIONS_MAX_BYTES) {
    throw new TypeError("Gateway handler manifest is not configured or exceeds the size limit");
  }
  let manifest;
  try { manifest = JSON.parse(raw); }
  catch { throw new TypeError("Gateway handler manifest must be valid JSON"); }
  const registry = createGatewayHandlerRegistry(manifest);
  if (definitions.some((definition) =>
    definition.guildId !== registry.manifest.guildId ||
    definition.applicationId !== registry.manifest.applicationId
  )) {
    throw new TypeError("Gateway handler manifest identity does not match its client definitions");
  }
  return registry;
}

export function validateGatewayFeatureCapabilities(handlerRegistry, env = {}) {
  const enabled = handlerRegistry?.manifest?.enabledHandlers;
  if (!Array.isArray(enabled)) throw new TypeError("Gateway handler manifest is invalid");
  const declaresProfileModal = enabled.includes("bot005-profile-modal");
  const profileFlagEnabled = env.BOT005_PROFILE_MODAL_ENABLED === "true";
  const declaresPing = enabled.includes("bot005-ping");
  const pingFlagEnabled = env.BOT005_PING_ENABLED === "true";
  const declaresStatus = enabled.includes("bot005-status");
  const statusFlagEnabled = env.BOT005_STATUS_ENABLED === "true";
  const declaresRules = enabled.includes("bot005-rules");
  const rulesFlagEnabled = env.BOT005_RULES_ENABLED === "true";
  const declaresStatsStatus = enabled.includes("bot005-statsstatus");
  const statsStatusFlagEnabled = env.BOT005_STATSSTATUS_ENABLED === "true";
  if (declaresProfileModal !== profileFlagEnabled || declaresPing !== pingFlagEnabled ||
      declaresStatus !== statusFlagEnabled || declaresRules !== rulesFlagEnabled || declaresStatsStatus !== statsStatusFlagEnabled) {
    throw new TypeError("Bot 005 isolated capability manifest and runtime flags must explicitly agree");
  }
  if (enabled.some((id) => !["discord-engagement-engine", "bot005-profile-modal", "bot005-ping", "bot005-status", "bot005-rules", "bot005-statsstatus"].includes(id))) {
    throw new TypeError("Gateway feature handler adapter is unavailable");
  }
  return Object.freeze({
    profileModalEnabled: declaresProfileModal,
    pingEnabled: declaresPing,
    statusEnabled: declaresStatus,
    rulesEnabled: declaresRules,
    statsStatusEnabled: declaresStatsStatus,
  });
}

/**
 * One SQLite-backed Durable Object for all verified Discord Gateway identities.
 *
 * Outbound sockets do not use WebSocket Hibernation. The coordinator therefore
 * uses one durable alarm for all heartbeat/reconnect deadlines and keeps all
 * protocol cursors and queues in SQLite storage. Do not activate this class
 * until the no-card platform quota and 24-hour lifecycle test have passed.
 */
export class GatewayCoordinatorDurableObject {
  constructor(state, env) {
    if (!state?.storage || typeof state.storage.setAlarm !== "function") {
      throw new TypeError("SQLite-backed Durable Object storage is required");
    }
    this.state = state;
    this.env = env;
    this.corePromise = null;
    this.tokenVault = null;
    this.dispatchers = new Map();
    this.engagementLedger = null;
  }

  async createCore() {
    const definitions = readDefinitions(this.env.GATEWAY_CLIENT_DEFINITIONS);
    const handlerRegistry = readHandlerRegistry(this.env.GATEWAY_HANDLER_MANIFEST, definitions);
    const capabilities = validateGatewayFeatureCapabilities(handlerRegistry, this.env);
    if (handlerRegistry.manifest.livePublisher !== "none") {
      throw new TypeError("Gateway feature handler adapter is unavailable");
    }
    const tokenVault = createInteractionTokenVault(this.env.GATEWAY_INTERACTION_ENCRYPTION_KEY);
    const planInteractionAck = createBot005InteractionAckPlanner();
    const acknowledgeInteraction = createDiscordInteractionAcknowledger();
    this.tokenVault = tokenVault;
    const core = new GatewayCoordinatorCore({
      storage: this.state.storage,
      definitions,
      handlerRegistry,
      protectInteraction: (payload) => tokenVault.encryptPayload(payload),
      revealInteraction: (payload) => tokenVault.decryptPayload(payload),
      planInteractionAck,
      acknowledgeInteraction,
      tokenProvider: async (reference) => this.env[reference],
      fingerprintToken: async (token) => {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      },
      verifyIdentity: async (token, definition) => {
        const headers = { authorization: "Bot " + token };
        const [botResponse, guildResponse] = await Promise.all([
          fetch("https://discord.com/api/v10/users/@me", {
            headers,
            signal: AbortSignal.timeout(9000),
          }),
          fetch("https://discord.com/api/v10/guilds/" + definition.guildId, {
            headers,
            signal: AbortSignal.timeout(9000),
          }),
        ]);
        if (botResponse.status === 401 || botResponse.status === 403 ||
            guildResponse.status === 401 || guildResponse.status === 403 ||
            guildResponse.status === 404) return false;
        if (botResponse.status === 429 || guildResponse.status === 429 ||
            botResponse.status >= 500 || guildResponse.status >= 500) {
          throw new Error("discord_identity_check_temporarily_unavailable");
        }
        if (!botResponse.ok || !guildResponse.ok) {
          throw new Error("discord_identity_check_failed");
        }
        const [bot, guild] = await Promise.all([
          botResponse.json(),
          guildResponse.json(),
        ]);
        return bot?.bot === true &&
          String(bot?.id) === definition.applicationId &&
          String(guild?.id) === definition.guildId;
      },
      connectSocket: async (url) => new WebSocket(url),
      scheduleAlarm: async (timestamp) => this.state.storage.setAlarm(timestamp),
      onDispatch: async () => this.scheduleEarlierAlarm(Date.now() + 100),
      now: () => Date.now(),
      random: () => Math.random(),
      log: (event, metadata = {}) => {
        console.log(JSON.stringify({
          subsystem: "momentum-gateway-coordinator",
          event,
          ...metadata,
        }));
      },
    });
    await core.initialize();
    this.dispatchers.clear();
    const needsDispatcher = handlerRegistry.manifest.enabledHandlers.length > 0;
    if (needsDispatcher) {
      const enabledDefinitions = definitions.filter((definition) => definition.enabled);
      if (enabledDefinitions.length !== 1) {
        throw new TypeError("Gateway feature handlers require exactly one explicitly enabled Gateway identity");
      }
      const definition = enabledDefinitions[0];
      const token = this.env[definition.tokenRef];
      if (typeof token !== "string" || token.trim().length < 20) {
        throw new TypeError("Gateway feature handler token reference is unavailable");
      }
      const handlers = {};
      if (handlerRegistry.manifest.enabledHandlers.includes("discord-engagement-engine")) {
        this.engagementLedger = new DurableEngagementLedger(this.state.storage, {
          guildId: handlerRegistry.manifest.guildId,
          namespace: "momentum",
        });
        await this.engagementLedger.initialize();
        handlers["discord-engagement-engine"] = createEngagementMessageHandler({
          ledger: this.engagementLedger,
          channelResolver: createDiscordEngagementChannelResolver({
            token,
            guildId: handlerRegistry.manifest.guildId,
          }),
        });
      }
      if (capabilities.pingEnabled) {
        handlers["bot005-ping"] = createBot005PingHandler({
          revealInteraction: (payload) => tokenVault.decryptPayload(payload),
          editDeferredReply: createDiscordDeferredReplyEditor(),
          guildId: handlerRegistry.manifest.guildId,
          applicationId: handlerRegistry.manifest.applicationId,
        });
      }

      if (capabilities.statusEnabled) {
        handlers["bot005-status"] = createBot005StatusHandler({
          revealInteraction: (payload) => tokenVault.decryptPayload(payload),
          editDeferredReply: createDiscordDeferredReplyEditor(),
          getStatus: () => core.snapshot(),
          guildId: handlerRegistry.manifest.guildId,
          applicationId: handlerRegistry.manifest.applicationId,
        });
      }
      if (capabilities.rulesEnabled) {
        handlers["bot005-rules"] = createBot005RulesHandler({
          revealInteraction: (payload) => tokenVault.decryptPayload(payload),
          editDeferredReply: createDiscordDeferredReplyEditor(),
          getGuildChannels: async (guildId) => {
            const response = await fetch("https://discord.com/api/v10/guilds/" + guildId + "/channels", {
              method: "GET",
              headers: { authorization: "Bot " + token, "user-agent": "DiscordManager/1.0" },
              signal: AbortSignal.timeout(12_000),
            });
            if (!response.ok) throw new Error("discord_rules_channel_read_failed");
            const channels = await response.json();
            if (!Array.isArray(channels)) throw new Error("discord_rules_channel_response_invalid");
            return channels;
          },
          guildId: handlerRegistry.manifest.guildId,
          applicationId: handlerRegistry.manifest.applicationId,
        });
      }
      if (capabilities.statsStatusEnabled) {
        handlers["bot005-statsstatus"] = createBot005StatsStatusHandler({
          revealInteraction: (payload) => tokenVault.decryptPayload(payload),
          editDeferredReply: createDiscordDeferredReplyEditor(),
          getStatsChannel: async (channelId) => {
            const response = await fetch("https://discord.com/api/v10/channels/" + channelId, {
              method: "GET",
              headers: { authorization: "Bot " + token, "user-agent": "DiscordManager/1.0" },
              signal: AbortSignal.timeout(12_000),
            });
            if (!response.ok) throw new Error("discord_stats_channel_read_failed");
            return response.json();
          },
          guildId: handlerRegistry.manifest.guildId,
          applicationId: handlerRegistry.manifest.applicationId,
        });
      }
      if (capabilities.profileModalEnabled) {
        const profileCipher = createBot005ProfileCipher(this.env.BOT005_PROFILE_ENCRYPTION_KEY);
        const profileStore = new DurableBot005ProfileStore(this.state.storage, {
          guildId: handlerRegistry.manifest.guildId,
          applicationId: handlerRegistry.manifest.applicationId,
          cipher: profileCipher,
        });
        handlers["bot005-profile-modal"] = createBot005ProfileModalHandler({
          store: profileStore,
          revealInteraction: (payload) => tokenVault.decryptPayload(payload),
          editDeferredReply: createDiscordDeferredReplyEditor(),
          guildId: handlerRegistry.manifest.guildId,
          applicationId: handlerRegistry.manifest.applicationId,
        });
      }
      const deliveryLedger = new DurableGatewayDeliveryLedger(this.state.storage, {
        namespace: "gateway-dispatch-" + definition.id,
      });
      this.dispatchers.set(definition.id, new GatewayEventDispatcher({
        inbox: core.getInbox(definition.id),
        registry: handlerRegistry,
        ledger: deliveryLedger,
        handlers,
      }));
    }
    return core;
  }

  async scheduleEarlierAlarm(timestamp) {
    const existing = await this.state.storage.getAlarm?.();
    const next = existing === null || existing === undefined
      ? timestamp
      : Math.min(Number(existing), timestamp);
    await this.state.storage.setAlarm(next);
    return next;
  }

  async getCore() {
    if (!this.corePromise) {
      this.corePromise = this.createCore().catch((error) => {
        this.corePromise = null;
        throw error;
      });
    }
    return this.corePromise;
  }

  async alarm() {
    if (this.env.GATEWAY_COORDINATOR_ENABLED !== "true") {
      await this.state.storage.deleteAlarm?.();
      return;
    }
    const core = await this.getCore();
    await core.alarm();
    if (core.stopped) return;
    for (const [clientId, dispatcher] of this.dispatchers) {
      const inbox = core.getInbox(clientId);
      for (const event of await inbox.listPending(25)) {
        if (event.eventType !== "INTERACTION_CREATE") continue;
        const recovery = await core.recoverInteractionAcknowledgement(clientId, event);
        if (Number.isSafeInteger(recovery.retryAt)) {
          await this.scheduleEarlierAlarm(recovery.retryAt);
        }
      }
      const summary = await dispatcher.drain({ limit: 25 });
      if (summary.status === "retry_wait" && Number.isFinite(summary.retryAt)) {
        await this.scheduleEarlierAlarm(summary.retryAt);
        continue;
      }
      if (summary.status === "ok" && summary.processed === 25) {
        const metrics = await core.getInbox(clientId).getMetrics();
        if (metrics.pendingEvents > 0) await this.scheduleEarlierAlarm(Date.now() + 100);
      }
    }
  }

  async fetch(request) {
    const expectedSecret = this.env.MCP_INTERNAL_BEARER_TOKEN;
    if (typeof expectedSecret !== "string" || expectedSecret.length < CONTROL_SECRET_MIN_LENGTH) {
      return json({ error: "gateway_control_not_configured" }, 503);
    }
    const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!equalSecret(supplied, expectedSecret)) {
      return json({ error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    if (url.pathname === "/status" && request.method === "GET") {
      if (this.env.GATEWAY_COORDINATOR_ENABLED !== "true") {
        return json({ status: "disabled", reason: "feature_flag_off" });
      }
      try {
        const core = await this.getCore();
        return json(await core.snapshot());
      } catch {
        return json({ status: "not_configured", reason: "gateway_definitions_unavailable" }, 409);
      }
    }

    if (url.pathname === "/start" && request.method === "POST") {
      if (this.env.GATEWAY_COORDINATOR_ENABLED !== "true") {
        return json({ error: "gateway_coordinator_disabled" }, 404);
      }
      try {
        const core = await this.getCore();
        const snapshot = await core.start();
        const started = snapshot.clients.some((client) =>
          client.enabled && ["connecting", "open", "identifying", "resuming"].includes(client.status)
        );
        return json({ status: started ? "starting" : "not_started", coordinator: snapshot }, started ? 202 : 503);
      } catch {
        return json({ error: "gateway_coordinator_start_failed" }, 503);
      }
    }

    if (url.pathname === "/stop" && request.method === "POST") {
      if (!this.corePromise) {
        await this.state.storage.deleteAlarm?.();
        return json({ status: "stopped", alreadyStopped: true });
      }
      try {
        const core = await this.getCore();
        return json(await core.stop());
      } catch {
        return json({ error: "gateway_coordinator_stop_failed" }, 503);
      }
    }

    if (url.pathname === "/reset-fatal" && request.method === "POST") {
      const contentLength = Number(request.headers.get("content-length") || "0");
      if (Number.isFinite(contentLength) && contentLength > REQUEST_MAX_BYTES) {
        return json({ error: "request_too_large" }, 413);
      }
      let body;
      try { body = await request.json(); }
      catch { return json({ error: "invalid_json" }, 400); }
      if (typeof body?.clientId !== "string" || !/^[A-Za-z0-9_-]{1,48}$/.test(body.clientId)) {
        return json({ error: "invalid_client_id" }, 400);
      }
      try {
        const core = await this.getCore();
        const result = await core.resetFatalClient(body.clientId);
        return json(result, result.reset ? 200 : 409);
      } catch {
        return json({ error: "gateway_client_reset_failed" }, 503);
      }
    }

    return json({ error: "not_found" }, 404);
  }
}
