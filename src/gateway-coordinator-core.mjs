import {
  parseGatewayFrame,
  createIdentify,
  createResume,
  createHeartbeat,
  heartbeatJitterDelay,
  decideGatewayFrame,
  decideGatewayClose,
  boundedReconnectDelay,
} from "./gateway-protocol.mjs";
import { DurableGatewayInbox, InboxFullError } from "./durable-gateway-inbox.mjs";

const SESSION_PREFIX = "gateway:coordinator:client:";
const COORDINATOR_META_KEY = "gateway:coordinator:meta";
const DEFAULT_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

function validateDefinitions(definitions) {
  if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > 12) {
    throw new RangeError("Gateway coordinator requires between 1 and 12 client definitions");
  }
  const ids = new Set();
  const tokenReferences = new Set();
  for (const def of definitions) {
    if (!def || typeof def !== "object" ||
        typeof def.id !== "string" || !/^[A-Za-z0-9_-]{1,48}$/.test(def.id) ||
        typeof def.guildId !== "string" || !/^\d{15,22}$/.test(def.guildId) ||
        typeof def.applicationId !== "string" || !/^\d{15,22}$/.test(def.applicationId) ||
        !Number.isSafeInteger(def.intents) || def.intents < 0) {
      throw new TypeError("Gateway client definition has invalid identity or intents");
    }
    if (ids.has(def.id)) throw new TypeError("Gateway client IDs must be unique");
    if (tokenReferences.has(def.tokenRef)) {
      throw new TypeError("Each Gateway identity must have a unique token reference");
    }
    tokenReferences.add(def.tokenRef);
    if (def.enabled !== true && def.enabled !== false) {
      throw new TypeError("Gateway client enabled must be an explicit boolean");
    }
    if (typeof def.tokenRef !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(def.tokenRef)) {
      throw new TypeError("Gateway token references must be environment variable names, never token values");
    }
    ids.add(def.id);
  }
  return definitions.map((def) => Object.freeze({ ...def }));
}

function sessionKey(id) {
  return SESSION_PREFIX + id;
}

function initialSession(id) {
  return {
    clientId: id,
    status: "stopped",
    generation: 0,
    reconnectAttempt: 0,
    reconnectAt: null,
    heartbeatAt: null,
    heartbeatAckDeadline: null,
    heartbeatInterval: null,
    awaitingHeartbeatAck: false,
    pendingHeartbeatAcks: 0,
    pendingAuthAction: null,
    lastGatewayCode: null,
    lastError: null,
    updatedAt: 0,
  };
}

function parseSocketData(event) {
  return event && typeof event === "object" && "data" in event ? event.data : event;
}

function eventMethod(socket, type, handler) {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(type, handler);
    return;
  }
  const property = "on" + type;
  socket[property] = handler;
}

function wssUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "wss:" || url.username || url.password || url.hash) {
    throw new TypeError("Discord Gateway URL must be a secure WebSocket URL");
  }
  url.searchParams.set("v", "10");
  url.searchParams.set("encoding", "json");
  return url.toString();
}

/**
 * One serialized project coordinator with one durable alarm for every session.
 *
 * Socket construction and token resolution are injected. This keeps credential
 * access out of persistence and permits deterministic tests without opening a
 * real Discord connection. A Durable Object wrapper supplies storage.setAlarm
 * as scheduleAlarm and a WebSocket client as connectSocket.
 */
export class GatewayCoordinatorCore {
  constructor({
    storage,
    definitions,
    connectSocket,
    tokenProvider,
    inboxOptions = {},
    now = () => Date.now(),
    random = Math.random,
    scheduleAlarm,
    verifyIdentity = async () => true,
    fingerprintToken,
    log = () => {},
  } = {}) {
    if (!storage || typeof storage.get !== "function" ||
        typeof storage.put !== "function" || typeof storage.setAlarm !== "function") {
      throw new TypeError("Durable Object storage with get, put and setAlarm is required");
    }
    if (typeof connectSocket !== "function" || typeof tokenProvider !== "function" ||
        typeof scheduleAlarm !== "function" || typeof now !== "function" ||
        typeof random !== "function" || typeof verifyIdentity !== "function" ||
        (fingerprintToken !== undefined && typeof fingerprintToken !== "function") ||
        typeof log !== "function") {
      throw new TypeError("Gateway coordinator dependencies are incomplete");
    }
    this.storage = storage;
    this.definitions = validateDefinitions(definitions);
    this.connectSocket = connectSocket;
    this.tokenProvider = tokenProvider;
    this.inboxOptions = inboxOptions;
    this.now = now;
    this.random = random;
    this.scheduleAlarm = scheduleAlarm;
    this.verifyIdentity = verifyIdentity;
    this.fingerprintToken = fingerprintToken ?? (async (token) => {
      const cryptoImpl = globalThis.crypto;
      if (!cryptoImpl?.subtle) throw new Error("Web Crypto is required for credential isolation");
      const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(token));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    });
    this.log = log;
    this.credentialOwners = new Map();
    this.fingerprintsByClient = new Map();
    this.sessions = new Map();
    this.sockets = new Map();
    this.inboxes = new Map();
    this.initialized = false;
    this.stopped = false;
    this.serial = Promise.resolve();
  }

  serialize(operation) {
    const run = this.serial.then(operation, operation);
    this.serial = run.catch(() => {});
    return run;
  }

  async initialize() {
    return this.serialize(async () => {
      if (this.initialized) return this.snapshot();
      const coordinatorMeta = await this.storage.get(COORDINATOR_META_KEY);
      this.stopped = coordinatorMeta?.stopped === true;
      for (const def of this.definitions) {
        const inbox = new DurableGatewayInbox(this.storage, {
          ...this.inboxOptions,
          namespace: "gw-" + def.id,
        });
        await inbox.initialize();
        this.inboxes.set(def.id, inbox);
        const persisted = await this.storage.get(sessionKey(def.id));
        const defaults = initialSession(def.id);
        const state = persisted && persisted.clientId === def.id
          ? { ...defaults, ...persisted }
          : defaults;
        // A Durable Object restart invalidates all in-memory sockets. Keep only
        // resume/heartbeat metadata and let start() acquire a new generation.
        if (state.status !== "fatal") {
          state.status = !def.enabled ? "disabled" : this.stopped ? "stopped" : "disconnected";
        }
        state.heartbeatAt = null;
        state.heartbeatAckDeadline = null;
        state.awaitingHeartbeatAck = false;
        state.pendingHeartbeatAcks = 0;
        if (!def.enabled || this.stopped) {
          state.reconnectAt = null;
          state.pendingAuthAction = null;
        } else if (state.reconnectAt === null) {
          state.reconnectAt = this.now();
        }
        await this.persistSession(def.id, state);
        this.sessions.set(def.id, state);
      }
      this.initialized = true;
      return this.snapshot();
    });
  }

  async persistSession(id, state) {
    state.updatedAt = this.now();
    await this.storage.put(sessionKey(id), { ...state });
  }

  getDefinition(id) {
    return this.definitions.find((def) => def.id === id) ?? null;
  }

  getInbox(id) {
    const inbox = this.inboxes.get(id);
    if (!inbox) throw new Error("Unknown Gateway client: " + id);
    return inbox;
  }

  async start() {
    return this.serialize(async () => {
      if (!this.initialized) await this.initializeUnlocked();
      this.stopped = false;
      await this.storage.put(COORDINATOR_META_KEY, { stopped: false, updatedAt: this.now() });
      for (const def of this.definitions) {
        if (!def.enabled) continue;
        const session = this.sessions.get(def.id);
        if (session?.status === "fatal") continue;
        if (this.sockets.has(def.id)) continue;
        if (session.reconnectAt !== null && session.reconnectAt > this.now()) continue;
        await this.openSocket(def.id);
      }
      await this.scheduleNextAlarm();
      return this.snapshot();
    });
  }

  async initializeUnlocked() {
    if (this.initialized) return;
    const coordinatorMeta = await this.storage.get(COORDINATOR_META_KEY);
    this.stopped = coordinatorMeta?.stopped === true;
    for (const def of this.definitions) {
      const inbox = new DurableGatewayInbox(this.storage, {
        ...this.inboxOptions,
        namespace: "gw-" + def.id,
      });
      await inbox.initialize();
      this.inboxes.set(def.id, inbox);
      const persisted = await this.storage.get(sessionKey(def.id));
      const state = persisted && persisted.clientId === def.id
        ? { ...initialSession(def.id), ...persisted }
        : initialSession(def.id);
      if (state.status !== "fatal") {
        state.status = !def.enabled ? "disabled" : this.stopped ? "stopped" : "disconnected";
      }
      state.heartbeatAt = null;
      state.heartbeatAckDeadline = null;
      state.awaitingHeartbeatAck = false;
      state.pendingHeartbeatAcks = 0;
      if (!def.enabled || this.stopped) {
        state.reconnectAt = null;
        state.pendingAuthAction = null;
      } else if (state.reconnectAt === null) {
        state.reconnectAt = this.now();
      }
      await this.persistSession(def.id, state);
      this.sessions.set(def.id, state);
    }
    this.initialized = true;
  }

  async openSocket(id) {
    const def = this.getDefinition(id);
    const state = this.sessions.get(id);
    if (!def || !state || !def.enabled || this.stopped) return false;
    if (this.sockets.has(id)) return false;

    let token;
    try {
      token = await this.tokenProvider(def.tokenRef, def);
      if (typeof token !== "string" || token.trim().length === 0) {
        const error = new Error("configured_discord_token_missing");
        error.code = "GATEWAY_TOKEN_MISSING";
        throw error;
      }
      token = token.trim();
      const fingerprint = await this.fingerprintToken(token);
      const existingOwner = this.credentialOwners.get(fingerprint);
      if (existingOwner && existingOwner !== id) {
        const error = new Error("duplicate_discord_credential");
        error.code = "GATEWAY_DUPLICATE_TOKEN";
        throw error;
      }
      const previousFingerprint = this.fingerprintsByClient.get(id);
      if (previousFingerprint && previousFingerprint !== fingerprint) {
        this.credentialOwners.delete(previousFingerprint);
      }
      this.credentialOwners.set(fingerprint, id);
      this.fingerprintsByClient.set(id, fingerprint);
      const identityVerified = await this.verifyIdentity(token, def);
      if (identityVerified === false) {
        const error = new Error("discord_identity_mismatch");
        error.code = "GATEWAY_IDENTITY_MISMATCH";
        throw error;
      }
      const saved = await this.getInbox(id).getState();
      const resume = state.pendingAuthAction !== "identify" &&
        typeof saved.sessionId === "string" && saved.sessionId.length > 0 &&
        Number.isSafeInteger(saved.sequence) && saved.sequence >= 0 &&
        typeof saved.resumeGatewayUrl === "string" && saved.resumeGatewayUrl.startsWith("wss://");
      const base = resume ? saved.resumeGatewayUrl : await this.resolveGatewayUrl(def, token);
      const url = wssUrl(base);
      state.generation += 1;
      state.status = "connecting";
      state.lastError = null;
      state.reconnectAt = null;
      state.heartbeatAt = null;
      state.heartbeatInterval = null;
      state.heartbeatAckDeadline = null;
      state.awaitingHeartbeatAck = false;
      state.pendingHeartbeatAcks = 0;
      const generation = state.generation;
      await this.persistSession(id, state);
      const socket = await this.connectSocket(url, { id, generation, definition: def });
      if (!socket || typeof socket.send !== "function" || typeof socket.close !== "function") {
        throw new TypeError("Gateway socket adapter returned an invalid socket");
      }
      this.sockets.set(id, socket);
      const isCurrent = () =>
        this.sockets.get(id) === socket &&
        this.sessions.get(id)?.generation === generation;

      eventMethod(socket, "open", () => {
        void this.serialize(async () => {
          if (!isCurrent()) return;
          state.status = "open";
          state.reconnectAttempt = 0;
          await this.persistSession(id, state);
          this.log("gateway_socket_open", { clientId: id, generation });
          await this.scheduleNextAlarm();
        }).catch(() => {});
      });
      eventMethod(socket, "message", (event) => {
        void this.serialize(() => this.handleMessage(id, socket, generation, parseSocketData(event)))
          .catch((error) => this.log("gateway_frame_failed", { clientId: id, error: error?.name || "unknown" }));
      });
      eventMethod(socket, "close", (event) => {
        void this.serialize(() => this.handleClose(id, socket, generation, event?.code ?? 1006))
          .catch(() => {});
      });
      eventMethod(socket, "error", () => {
        void this.serialize(async () => {
          if (!isCurrent()) return;
          state.lastError = "gateway_socket_error";
          await this.persistSession(id, state);
          this.log("gateway_socket_error", { clientId: id, generation });
        }).catch(() => {});
      });
      this.log("gateway_socket_connecting", { clientId: id, generation, resume });
      return true;
    } catch (error) {
      const failedSocket = this.sockets.get(id);
      if (failedSocket) {
        this.sockets.delete(id);
        try { failedSocket.close(1011, "Gateway adapter initialization failed"); } catch {}
      }
      if (error?.code === "GATEWAY_TOKEN_MISSING") {
        state.lastError = "gateway_token_missing";
        state.status = "fatal";
        state.reconnectAt = null;
        state.pendingAuthAction = null;
      } else if (error?.code === "GATEWAY_DUPLICATE_TOKEN" ||
                 error?.code === "GATEWAY_IDENTITY_MISMATCH") {
        state.lastError = error.code === "GATEWAY_DUPLICATE_TOKEN"
          ? "duplicate_discord_credential"
          : "discord_identity_mismatch";
        state.status = "fatal";
        state.reconnectAt = null;
        state.pendingAuthAction = null;
      } else {
        state.lastError = "gateway_connect_failed";
        state.status = "reconnect_wait";
        state.reconnectAttempt += 1;
        state.reconnectAt = this.now() + boundedReconnectDelay(state.reconnectAttempt, this.random());
      }
      await this.persistSession(id, state);
      this.log("gateway_connect_failed", { clientId: id, reason: state.lastError });
      return false;
    }
  }

  async resolveGatewayUrl(definition, token) {
    if (typeof definition.gatewayUrl === "string") return definition.gatewayUrl;
    // The standard Discord Gateway endpoint is sufficient for protocol v10.
    // Shard/session-limit discovery can be supplied by a later REST adapter.
    return DEFAULT_GATEWAY_URL;
  }

  async handleMessage(id, socket, generation, raw) {
    const state = this.sessions.get(id);
    if (!state || this.sockets.get(id) !== socket || state.generation !== generation) return;
    const frame = parseGatewayFrame(raw);
    if (frame.op === 0 && (!Number.isSafeInteger(frame.s) || frame.s < 0)) {
      state.status = "reconnect_wait";
      state.lastError = "gateway_dispatch_sequence_missing";
      state.reconnectAttempt += 1;
      state.reconnectAt = this.now() + boundedReconnectDelay(state.reconnectAttempt, this.random());
      await this.persistSession(id, state);
      socket.close(4002, "Gateway dispatch sequence missing");
      await this.scheduleNextAlarm();
      return;
    }
    const inbox = this.getInbox(id);
    const saved = await inbox.getState();
    const decision = decideGatewayFrame(frame, saved);

    switch (decision.action) {
      case "fatal":
        state.status = "fatal";
        state.lastError = decision.reason;
        await this.persistSession(id, state);
        socket.close(4004, "Gateway protocol configuration failure");
        break;
      case "identify":
      case "resume": {
        state.heartbeatInterval = decision.heartbeatInterval;
        state.heartbeatAt = this.now() + heartbeatJitterDelay(
          decision.heartbeatInterval,
          this.random(),
        );
        state.heartbeatAckDeadline = null;
        state.awaitingHeartbeatAck = false;
        state.pendingHeartbeatAcks = 0;
        await this.persistSession(id, state);
        if (decision.action === "resume") await this.sendResume(id, socket);
        else await this.sendIdentify(id, socket);
        break;
      }
      case "send_heartbeat":
        await this.sendHeartbeat(id, socket, saved.sequence, true);
        break;
      case "heartbeat_ack": {
        state.pendingHeartbeatAcks = Math.max(
          0,
          (Number.isSafeInteger(state.pendingHeartbeatAcks) ? state.pendingHeartbeatAcks : 0) - 1,
        );
        state.awaitingHeartbeatAck = state.pendingHeartbeatAcks > 0;
        if (!state.awaitingHeartbeatAck) state.heartbeatAckDeadline = null;
        await this.persistSession(id, state);
        break;
      }
      case "reconnect":
        state.status = "reconnect_wait";
        state.pendingAuthAction = null;
        state.reconnectAt = this.now() + boundedReconnectDelay(0, this.random(), 1000, 5000);
        await this.persistSession(id, state);
        socket.close(4000, "Discord requested reconnect");
        break;
      case "resume_after_invalid_session":
      case "identify_after_invalid_session":
        if (decision.clearSession) await inbox.clearSession();
        state.pendingAuthAction = decision.action === "resume_after_invalid_session" ? "resume" : "identify";
        state.heartbeatAt = null;
        state.heartbeatAckDeadline = null;
        state.awaitingHeartbeatAck = false;
        state.pendingHeartbeatAcks = 0;
        state.reconnectAt = this.now() + 1000 + Math.floor(this.random() * 4000);
        state.status = "auth_wait";
        await this.persistSession(id, state);
        break;
      case "dispatch":
        if (decision.ready && decision.session) {
          await inbox.saveReadySession(decision.session);
        } else {
          const session = await inbox.getState();
          if (!session.sessionId || !Number.isSafeInteger(decision.sequence)) {
            throw new Error("gateway_dispatch_without_ready_session");
          }
          try {
            await inbox.enqueueDispatch({
              guildId: this.getDefinition(id).guildId,
              sessionId: session.sessionId,
              sequence: decision.sequence,
              eventType: decision.eventType,
              payload: frame.d ?? {},
            });
          } catch (error) {
            if (error instanceof InboxFullError) {
              state.status = "queue_full";
              state.lastError = "durable_gateway_inbox_full";
              await this.persistSession(id, state);
              socket.close(4000, "Durable event inbox full; reconnect for replay");
              break;
            }
            throw error;
          }
        }
        break;
      default:
        break;
    }
    await this.persistSession(id, state);
    await this.scheduleNextAlarm();
  }

  async sendIdentify(id, socket) {
    const def = this.getDefinition(id);
    const token = await this.tokenProvider(def.tokenRef, def);
    socket.send(JSON.stringify(createIdentify(token, def.intents, def.properties ?? {})));
    const state = this.sessions.get(id);
    state.pendingAuthAction = null;
    state.status = "identifying";
    await this.persistSession(id, state);
  }

  async sendResume(id, socket) {
    const def = this.getDefinition(id);
    const saved = await this.getInbox(id).getState();
    const token = await this.tokenProvider(def.tokenRef, def);
    socket.send(JSON.stringify(createResume(token, saved.sessionId, saved.sequence)));
    const state = this.sessions.get(id);
    state.pendingAuthAction = null;
    state.status = "resuming";
    await this.persistSession(id, state);
  }

  async sendHeartbeat(id, socket, sequence, serverRequested = false) {
    const state = this.sessions.get(id);
    const pending = Number.isSafeInteger(state.pendingHeartbeatAcks)
      ? state.pendingHeartbeatAcks
      : 0;
    if (pending > 0 && !serverRequested) {
      state.status = "heartbeat_unacknowledged";
      state.lastError = "heartbeat_ack_timeout";
      await this.persistSession(id, state);
      socket.close(4000, "Gateway heartbeat acknowledgement missing");
      return;
    }
    if (pending >= 4) {
      state.status = "heartbeat_unacknowledged";
      state.lastError = "too_many_unacknowledged_heartbeats";
      await this.persistSession(id, state);
      socket.close(4000, "Too many unacknowledged Gateway heartbeats");
      return;
    }
    const interval = Math.max(1000, state.heartbeatInterval ?? 1000);
    socket.send(JSON.stringify(createHeartbeat(sequence)));
    state.pendingHeartbeatAcks = pending + 1;
    state.awaitingHeartbeatAck = true;
    state.heartbeatAckDeadline = this.now() + interval;
    state.heartbeatAt = this.now() + interval;
    await this.persistSession(id, state);
  }

  async handleClose(id, socket, generation, code) {
    if (this.sockets.get(id) !== socket) return;
    const state = this.sessions.get(id);
    if (!state || state.generation !== generation) return;
    this.sockets.delete(id);
    const decision = decideGatewayClose(code);
    state.lastGatewayCode = code;
    state.heartbeatAt = null;
    state.heartbeatAckDeadline = null;
    state.awaitingHeartbeatAck = false;
    state.pendingHeartbeatAcks = 0;
    if (decision.clearSession) await this.getInbox(id).clearSession();
    if (decision.action === "fatal") {
      state.status = "fatal";
      state.lastError = decision.reason;
      state.reconnectAt = null;
      state.pendingAuthAction = null;
    } else {
      state.status = "reconnect_wait";
      state.reconnectAttempt += 1;
      if (state.reconnectAt === null || state.reconnectAt <= this.now()) {
        const baseDelay = decision.rateLimited ? 10_000 : 1_000;
        const maxDelay = decision.rateLimited ? 120_000 : 60_000;
        state.reconnectAt = this.now() + boundedReconnectDelay(
          state.reconnectAttempt,
          this.random(),
          baseDelay,
          maxDelay,
        );
      }
    }
    await this.persistSession(id, state);
    this.log("gateway_socket_closed", { clientId: id, code, action: decision.action });
    await this.scheduleNextAlarm();
  }

  async alarm() {
    return this.serialize(async () => {
      if (!this.initialized) await this.initializeUnlocked();
      if (this.stopped) return this.scheduleNextAlarm();
      const now = this.now();
      for (const def of this.definitions) {
        if (!def.enabled) continue;
        const state = this.sessions.get(def.id);
        if (!state) continue;
        const socket = this.sockets.get(def.id);
        if (state.pendingAuthAction && state.reconnectAt !== null && state.reconnectAt <= now && socket) {
          if (state.pendingAuthAction === "resume") await this.sendResume(def.id, socket);
          else await this.sendIdentify(def.id, socket);
          state.reconnectAt = null;
          await this.persistSession(def.id, state);
          continue;
        }
        if (state.reconnectAt !== null && state.reconnectAt <= now && !socket) {
          await this.openSocket(def.id);
          continue;
        }
        if (state.heartbeatAckDeadline !== null && state.heartbeatAckDeadline <= now && socket) {
          state.status = "heartbeat_unacknowledged";
          socket.close(4000, "Gateway heartbeat acknowledgement missing");
          continue;
        }
        if (state.heartbeatAt !== null && state.heartbeatAt <= now && socket) {
          await this.sendHeartbeat(def.id, socket, (await this.getInbox(def.id).getState()).sequence);
        }
      }
      await this.scheduleNextAlarm();
      return this.snapshot();
    });
  }

  async resetFatalClient(id) {
    return this.serialize(async () => {
      const def = this.getDefinition(id);
      const state = this.sessions.get(id);
      if (!def || !state) throw new Error("Unknown Gateway client: " + id);
      if (this.sockets.has(id)) throw new Error("Close the active Gateway socket before resetting its state");
      if (state.status !== "fatal") return { reset: false, status: state.status };
      state.status = def.enabled ? "disconnected" : "disabled";
      state.lastError = null;
      state.reconnectAt = null;
      state.pendingAuthAction = null;
      state.reconnectAttempt = 0;
      await this.persistSession(id, state);
      await this.scheduleNextAlarm();
      return { reset: true, status: state.status };
    });
  }

  async scheduleNextAlarm() {
    if (this.stopped) return null;
    const due = [];
    for (const state of this.sessions.values()) {
      if (state.pendingAuthAction && state.reconnectAt !== null) due.push(state.reconnectAt);
      if (state.reconnectAt !== null && !this.sockets.has(state.clientId)) due.push(state.reconnectAt);
      if (state.heartbeatAt !== null) due.push(state.heartbeatAt);
      if (state.heartbeatAckDeadline !== null) due.push(state.heartbeatAckDeadline);
    }
    if (due.length === 0) {
      if (typeof this.storage.deleteAlarm === "function") await this.storage.deleteAlarm();
      return null;
    }
    const next = Math.max(this.now() + 100, Math.min(...due));
    await this.scheduleAlarm(next);
    return next;
  }

  async stop() {
    return this.serialize(async () => {
      this.stopped = true;
      await this.storage.put(COORDINATOR_META_KEY, { stopped: true, updatedAt: this.now() });
      for (const socket of this.sockets.values()) {
        try { socket.close(1000, "Coordinator stopped"); } catch {}
      }
      this.sockets.clear();
      for (const state of this.sessions.values()) {
        state.status = "stopped";
        state.heartbeatAt = null;
        state.heartbeatAckDeadline = null;
        state.awaitingHeartbeatAck = false;
        state.pendingHeartbeatAcks = 0;
        state.reconnectAt = null;
        await this.persistSession(state.clientId, state);
      }
      if (typeof this.storage.deleteAlarm === "function") await this.storage.deleteAlarm();
      return this.snapshot();
    });
  }

  async snapshot() {
    const result = [];
    for (const def of this.definitions) {
      const state = this.sessions.get(def.id) ?? initialSession(def.id);
      const inbox = this.inboxes.get(def.id);
      result.push({
        clientId: def.id,
        enabled: def.enabled,
        guildId: def.guildId,
        applicationId: def.applicationId,
        intents: def.intents,
        status: state.status,
        reconnectAttempt: state.reconnectAttempt,
        reconnectAt: state.reconnectAt,
        heartbeatAt: state.heartbeatAt,
        awaitingHeartbeatAck: state.awaitingHeartbeatAck,
        lastGatewayCode: state.lastGatewayCode,
        lastError: state.lastError,
        inbox: inbox ? await inbox.getMetrics() : null,
      });
    }
    return { clients: result, scheduler: "one-centralized-alarm", alarmCount: 1 };
  }
}
