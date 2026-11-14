import { GatewayCoordinatorCore } from "./gateway-coordinator-core.mjs";

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
  }

  async createCore() {
    const definitions = readDefinitions(this.env.GATEWAY_CLIENT_DEFINITIONS);
    const core = new GatewayCoordinatorCore({
      storage: this.state.storage,
      definitions,
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
    return core;
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
