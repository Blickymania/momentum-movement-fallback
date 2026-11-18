import test from "node:test";
import assert from "node:assert/strict";
import { GatewayCoordinatorCore } from "../src/gateway-coordinator-core.mjs";
import { createBot005InteractionAckPlanner } from "../src/bot005-interaction-ack-plan.mjs";

const GUILD_A = "1565048205970767992";
const GUILD_B = "1565048205970767993";
const APP_A = "1565304619838742598";
const APP_B = "1565304619838742599";

class MemoryDOStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
    this.alarmWrites = 0;
  }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async list({ prefix = "", limit = 1000, startAfter } = {}) {
    const result = new Map();
    const keys = [...this.values.keys()]
      .filter((key) => key.startsWith(prefix) && (startAfter === undefined || key > startAfter))
      .sort();
    for (const key of keys.slice(0, limit)) result.set(key, structuredClone(this.values.get(key)));
    return result;
  }
  async transaction(callback) {
    const snapshot = new Map([...this.values.entries()].map(([key, value]) => [key, structuredClone(value)]));
    const txn = {
      get: async (key) => snapshot.get(key),
      put: async (key, value) => snapshot.set(key, structuredClone(value)),
      delete: async (key) => snapshot.delete(key),
      list: async (options = {}) => {
        const result = new Map();
        const { prefix = "", limit = 1000, startAfter } = options;
        const keys = [...snapshot.keys()]
          .filter((key) => key.startsWith(prefix) && (startAfter === undefined || key > startAfter))
          .sort();
        for (const key of keys.slice(0, limit)) result.set(key, structuredClone(snapshot.get(key)));
        return result;
      },
    };
    const result = await callback(txn);
    this.values = snapshot;
    return result;
  }
  async setAlarm(timestamp) {
    this.alarmAt = Number(timestamp);
    this.alarmWrites += 1;
  }
  async deleteAlarm() { this.alarmAt = null; }
  async getAlarm() { return this.alarmAt; }
}

class MockSocket {
  constructor(label) {
    this.label = label;
    this.listeners = new Map();
    this.sent = [];
    this.closed = [];
    this.readyState = 1;
  }
  addEventListener(name, handler) {
    const list = this.listeners.get(name) ?? [];
    list.push(handler);
    this.listeners.set(name, list);
  }
  emit(name, event = {}) {
    for (const handler of this.listeners.get(name) ?? []) handler(event);
  }
  send(value) { this.sent.push(JSON.parse(String(value))); }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.closed.push({ code, reason });
    this.readyState = 3;
    this.emit("close", { code, reason });
  }
}

const definitions = [
  { id: "bot-alpha", guildId: GUILD_A, applicationId: APP_A, intents: 513, enabled: true, tokenRef: "BOT_ALPHA_TOKEN" },
  { id: "bot-beta", guildId: GUILD_B, applicationId: APP_B, intents: 513, enabled: true, tokenRef: "BOT_BETA_TOKEN" },
  { id: "bot-disabled", guildId: "1565304619838742500", applicationId: "1565304619838742501", intents: 1, enabled: false, tokenRef: "BOT_DISABLED_TOKEN" },
];

function makeHarness({ random = () => 0.25, verifyIdentity = async () => true, fingerprintToken, clientDefinitions = definitions, handlerRegistry, protectInteraction, planInteractionAck, acknowledgeInteraction, revealInteraction, onDispatch, now: customNow } = {}) {
  const storage = new MemoryDOStorage();
  const sockets = [];
  const tokens = new Map([
    ["BOT_ALPHA_TOKEN", "alpha-secret-test-token"],
    ["BOT_BETA_TOKEN", "beta-secret-test-token"],
    ["BOT_DISABLED_TOKEN", "disabled-secret-test-token"],
  ]);
  const alarms = [];
  const logs = [];
  const core = new GatewayCoordinatorCore({
    storage,
    definitions: clientDefinitions,
    tokenProvider: async (reference) => tokens.get(reference),
    connectSocket: async (url, context) => {
      const socket = new MockSocket(context.id + "-" + context.generation);
      socket.url = url;
      socket.context = context;
      sockets.push(socket);
      return socket;
    },
    scheduleAlarm: async (timestamp) => {
      alarms.push(Number(timestamp));
      await storage.setAlarm(timestamp);
    },
    now: customNow ?? (() => clock),
    random,
    verifyIdentity,
    ...(fingerprintToken ? { fingerprintToken } : {}),
    ...(handlerRegistry ? { handlerRegistry } : {}),
    ...(protectInteraction ? { protectInteraction } : {}),
    ...(planInteractionAck ? { planInteractionAck } : {}),
    ...(acknowledgeInteraction ? { acknowledgeInteraction } : {}),
    ...(revealInteraction ? { revealInteraction } : {}),
    ...(onDispatch ? { onDispatch } : {}),
    log: (event, metadata) => logs.push({ event, metadata }),
  });
  let clock = 1_800_000_000_000;
  return {
    core, storage, sockets, alarms, logs,
    now: () => clock,
    advance: (milliseconds) => { clock += milliseconds; },
    tokens,
    flush: async () => { await core.serial; },
  };
}

function frame(socket, payload) {
  // MessageEvent.data is generally inherited from its prototype, not an own property.
  const event = Object.create({ get data() { return JSON.stringify(payload); } });
  socket.emit("message", event);
}

test("rejects duplicate application IDs and duplicate token references before starting", () => {
  const sharedApplication = [
    definitions[0],
    { ...definitions[1], applicationId: definitions[0].applicationId },
  ];
  assert.throws(() => makeHarness({ clientDefinitions: sharedApplication }), /one active Gateway session/);

  const sharedTokenReference = [
    definitions[0],
    { ...definitions[1], tokenRef: definitions[0].tokenRef },
  ];
  assert.throws(() => makeHarness({ clientDefinitions: sharedTokenReference }), /unique token reference/);
});

test("starts enabled identities with one persisted alarm and no shared sequence state", async () => {
  const h = makeHarness();
  await h.core.initialize();
  await h.core.start();
  assert.equal(h.sockets.length, 2);
  assert.equal(h.sockets[0].context.id, "bot-alpha");
  assert.equal(h.sockets[1].context.id, "bot-beta");
  assert.ok(h.sockets.every((socket) => socket.url.startsWith("wss://gateway.discord.gg/")));
  assert.equal(await h.storage.getAlarm(), null);
  const snapshot = await h.core.snapshot();
  assert.equal(snapshot.clients.length, 3);
  assert.equal(snapshot.scheduler, "one-centralized-alarm");
  assert.equal(snapshot.clients.find((client) => client.clientId === "bot-disabled").status, "disabled");
  assert.equal(JSON.stringify(snapshot).includes("alpha-secret-test-token"), false);
  assert.equal(JSON.stringify(snapshot).includes("beta-secret-test-token"), false);
});

test("refuses duplicate token values across distinct secret references without opening a second session", async () => {
  const h = makeHarness();
  h.tokens.set("BOT_BETA_TOKEN", h.tokens.get("BOT_ALPHA_TOKEN"));
  await h.core.initialize();
  await h.core.start();
  assert.equal(h.sockets.length, 1);
  const beta = h.core.sessions.get("bot-beta");
  assert.equal(beta.status, "fatal");
  assert.equal(beta.lastError, "duplicate_discord_credential");
  assert.equal(beta.reconnectAt, null);
  assert.equal(JSON.stringify(h.logs).includes("alpha-secret-test-token"), false);
});

test("fails closed when the configured Discord identity does not match the definition", async () => {
  const h = makeHarness({
    verifyIdentity: async (_token, definition) => definition.id !== "bot-alpha",
  });
  await h.core.initialize();
  await h.core.start();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.core.sessions.get("bot-alpha").status, "fatal");
  assert.equal(h.core.sessions.get("bot-alpha").lastError, "discord_identity_mismatch");
  assert.equal(h.core.sessions.get("bot-beta").status, "connecting");
});

test("missing token is terminal and does not enter an automatic reconnect loop", async () => {
  const h = makeHarness();
  h.tokens.delete("BOT_ALPHA_TOKEN");
  await h.core.initialize();
  await h.core.start();
  assert.equal(h.core.sessions.get("bot-alpha").status, "fatal");
  assert.equal(h.core.sessions.get("bot-alpha").lastError, "gateway_token_missing");
  const count = h.sockets.length;
  await h.core.alarm();
  await h.core.start();
  assert.equal(h.sockets.length, count);
});

test("resumes the saved session and last committed sequence after coordinator restart", async () => {
  const h = makeHarness();
  await h.core.initialize();
  await h.core.start();
  const first = h.sockets[0];
  frame(first, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(first, { op: 0, s: 20, t: "READY", d: { session_id: "restart-session", resume_gateway_url: "wss://resume.restart.example" } });
  await h.flush();
  frame(first, { op: 0, s: 21, t: "MESSAGE_CREATE", d: { id: "last-committed" } });
  await h.flush();

  const restarted = new GatewayCoordinatorCore({
    storage: h.storage,
    definitions,
    tokenProvider: async (reference) => h.tokens.get(reference),
    connectSocket: async (url, context) => {
      const socket = new MockSocket(context.id + "-" + context.generation);
      socket.url = url;
      socket.context = context;
      h.sockets.push(socket);
      return socket;
    },
    scheduleAlarm: async (timestamp) => h.storage.setAlarm(timestamp),
    verifyIdentity: async () => true,
    now: h.now,
    random: () => 0.25,
  });
  await restarted.initialize();
  await restarted.start();
  const resumed = h.sockets.findLast((socket) => socket.context.id === "bot-alpha");
  assert.ok(resumed.url.startsWith("wss://resume.restart.example/"));
  frame(resumed, { op: 10, d: { heartbeat_interval: 30000 } });
  await restarted.serial;
  assert.equal(resumed.sent[0].op, 6);
  assert.equal(resumed.sent[0].d.session_id, "restart-session");
  assert.equal(resumed.sent[0].d.seq, 21);
});

test("fatal configuration status survives restart until an explicit operator reset", async () => {
  const h = makeHarness();
  h.tokens.delete("BOT_ALPHA_TOKEN");
  await h.core.initialize();
  await h.core.start();
  assert.equal(h.core.sessions.get("bot-alpha").status, "fatal");

  const restarted = new GatewayCoordinatorCore({
    storage: h.storage,
    definitions,
    tokenProvider: async (reference) => h.tokens.get(reference),
    connectSocket: async (url, context) => {
      const socket = new MockSocket(context.id + "-" + context.generation);
      h.sockets.push(socket);
      return socket;
    },
    scheduleAlarm: async (timestamp) => h.storage.setAlarm(timestamp),
    now: h.now,
    random: () => 0.25,
  });
  await restarted.initialize();
  await restarted.start();
  assert.equal(restarted.sessions.get("bot-alpha").status, "fatal");
  const count = h.sockets.length;
  const reset = await restarted.resetFatalClient("bot-alpha");
  assert.equal(reset.reset, true);
  assert.equal(reset.status, "disconnected");
  await restarted.start();
  assert.equal(h.sockets.length, count);
  assert.equal(restarted.sessions.get("bot-alpha").status, "fatal");
});

test("HELLO sends the right Identify per client and schedules one alarm using heartbeat jitter", async () => {
  const h = makeHarness({ random: () => 0.25 });
  await h.core.initialize();
  await h.core.start();
  const [alpha, beta] = h.sockets;
  alpha.emit("open");
  beta.emit("open");
  await h.flush();

  frame(alpha, { op: 10, d: { heartbeat_interval: 45000 } });
  frame(beta, { op: 10, d: { heartbeat_interval: 60000 } });
  await h.flush();

  assert.equal(alpha.sent[0].op, 2);
  assert.equal(alpha.sent[0].d.token, "alpha-secret-test-token");
  assert.equal(alpha.sent[0].d.intents, 513);
  assert.equal(beta.sent[0].d.token, "beta-secret-test-token");
  assert.equal(beta.sent[0].d.intents, 513);

  const a = h.core.sessions.get("bot-alpha");
  const b = h.core.sessions.get("bot-beta");
  assert.equal(a.heartbeatInterval, 45000);
  assert.equal(a.heartbeatAt, h.now() + 11250);
  assert.equal(b.heartbeatInterval, 60000);
  assert.equal(b.heartbeatAt, h.now() + 15000);
  assert.equal(await h.storage.getAlarm(), Math.min(a.heartbeatAt, b.heartbeatAt));
});

test("READY session and subsequent dispatch events persist into isolated per-client inboxes", async () => {
  const wakeups = [];
  const h = makeHarness({ onDispatch: (notice) => wakeups.push(notice) });
  await h.core.initialize();
  await h.core.start();
  const [alpha, beta] = h.sockets;
  frame(alpha, { op: 10, d: { heartbeat_interval: 45000 } });
  frame(beta, { op: 10, d: { heartbeat_interval: 45000 } });
  await h.flush();

  frame(alpha, { op: 0, s: 10, t: "READY", d: { session_id: "alpha-session", resume_gateway_url: "wss://resume.alpha.example" } });
  frame(beta, { op: 0, s: 50, t: "READY", d: { session_id: "beta-session", resume_gateway_url: "wss://resume.beta.example" } });
  await h.flush();

  frame(alpha, { op: 0, s: 11, t: "MESSAGE_CREATE", d: { id: "alpha-message" } });
  frame(beta, { op: 0, s: 51, t: "MESSAGE_CREATE", d: { id: "beta-message" } });
  await h.flush();

  const alphaInbox = h.core.getInbox("bot-alpha");
  const betaInbox = h.core.getInbox("bot-beta");
  assert.equal((await alphaInbox.getState()).sequence, 11);
  assert.equal((await betaInbox.getState()).sequence, 51);
  assert.deepEqual((await alphaInbox.listPending()).map((item) => item.payload.id), ["alpha-message"]);
  assert.deepEqual((await betaInbox.listPending()).map((item) => item.payload.id), ["beta-message"]);
  assert.deepEqual(wakeups.map(({ clientId, eventType }) => ({ clientId, eventType })), [
    { clientId: "bot-alpha", eventType: "MESSAGE_CREATE" },
    { clientId: "bot-beta", eventType: "MESSAGE_CREATE" },
  ]);
  assert.ok(wakeups.every((notice) => typeof notice.eventKey === "string" && notice.eventKey.length > 0));
  assert.equal(alpha.sent[0].op, 2);
  assert.equal(beta.sent[0].op, 2);
});

test("fails closed on an interaction when durable token protection is not configured", async () => {
  const handlerRegistry = {
    route: () => ({ status: "routed", handlers: ["discord-engagement-engine"] }),
  };
  const h = makeHarness({ handlerRegistry });
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  frame(socket, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(socket, { op: 0, s: 1, t: "READY", d: { session_id: "session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();

  const secretToken = "must-never-be-written-to-durable-storage";
  frame(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
    id: "1569000000000000001",
    application_id: APP_A,
    guild_id: GUILD_A,
    token: secretToken,
    data: { component_type: 2, custom_id: "ddxp:my" },
  }});
  await h.flush();

  const state = h.core.sessions.get("bot-alpha");
  assert.equal(state.status, "fatal");
  assert.equal(state.lastError, "interaction_token_protection_unavailable");
  assert.equal(socket.closed.at(-1).code, 4004);
  const stored = [...h.storage.values.values()];
  assert.equal(JSON.stringify(stored).includes(secretToken), false);
  assert.equal((await h.core.getInbox("bot-alpha").listPending()).length, 0);
});

test("persists only protected interaction tokens when an explicit protector is configured", async () => {
  const handlerRegistry = {
    route: () => ({ status: "routed", handlers: ["discord-engagement-engine"] }),
  };
  const h = makeHarness({
    handlerRegistry,
    protectInteraction: async (payload) => {
      const { token, ...safe } = payload;
      return { ...safe, interaction_token: { version: 1, algorithm: "A256GCM", iv: "test-iv", ciphertext: "test-ciphertext" } };
    },
  });
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  frame(socket, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(socket, { op: 0, s: 1, t: "READY", d: { session_id: "session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();
  frame(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
    id: "1569000000000000001",
    application_id: APP_A,
    guild_id: GUILD_A,
    token: "secret-token-protected-by-the-test-adapter",
    data: { component_type: 2, custom_id: "ddxp:my" },
  }});
  await h.flush();
  const event = (await h.core.getInbox("bot-alpha").listPending())[0];
  assert.equal(Object.prototype.hasOwnProperty.call(event.payload, "token"), false);
  assert.equal(event.payload.interaction_token.ciphertext, "test-ciphertext");
  assert.equal(JSON.stringify([...h.storage.values.values()]).includes("secret-token-protected-by-the-test-adapter"), false);
});

test("handler registry drops irrelevant events while atomically advancing the Resume sequence", async () => {
  const handlerRegistry = {
    route: ({ eventType, payload }) => {
      if (eventType === "MESSAGE_CREATE" && payload.guild_id === GUILD_A) {
        return { status: "routed", handlers: ["discord-engagement-engine"] };
      }
      return { status: "ignored", reason: "event_not_consumed" };
    },
  };
  const h = makeHarness({ handlerRegistry });
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  frame(socket, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(socket, { op: 0, s: 10, t: "READY", d: { session_id: "session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();

  frame(socket, { op: 0, s: 11, t: "PRESENCE_UPDATE", d: { user: { id: "100000000000000001" } } });
  await h.flush();
  assert.equal((await h.core.getInbox("bot-alpha").getState()).sequence, 11);
  assert.equal((await h.core.getInbox("bot-alpha").listPending()).length, 0);

  frame(socket, { op: 0, s: 12, t: "MESSAGE_CREATE", d: { guild_id: GUILD_A, id: "message-12" } });
  await h.flush();
  assert.equal((await h.core.getInbox("bot-alpha").getState()).sequence, 12);
  assert.equal((await h.core.getInbox("bot-alpha").listPending()).length, 1);
  assert.equal((await h.core.getInbox("bot-alpha").listPending())[0].eventType, "MESSAGE_CREATE");
});

test("server-requested heartbeat is sent immediately even when a scheduled ACK is pending", async () => {
  const h = makeHarness();
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  frame(socket, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(socket, { op: 0, s: 6, t: "READY", d: { session_id: "session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();

  const state = h.core.sessions.get("bot-alpha");
  h.advance(state.heartbeatAt - h.now());
  await h.core.alarm();
  assert.equal(state.pendingHeartbeatAcks, 1);
  const sentBeforeRequest = socket.sent.length;

  frame(socket, { op: 1, d: null });
  await h.flush();
  assert.equal(socket.sent.length, sentBeforeRequest + 1);
  assert.equal(socket.sent.at(-1).op, 1);
  assert.equal(state.pendingHeartbeatAcks, 2);
  assert.equal(socket.closed.length, 0);

  frame(socket, { op: 11, d: null });
  await h.flush();
  assert.equal(state.pendingHeartbeatAcks, 1);
  assert.equal(state.awaitingHeartbeatAck, true);
  frame(socket, { op: 11, d: null });
  await h.flush();
  assert.equal(state.pendingHeartbeatAcks, 0);
  assert.equal(state.awaitingHeartbeatAck, false);
});

test("dispatch frames without a sequence close safely without advancing durable state", async () => {
  const h = makeHarness();
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  frame(socket, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(socket, { op: 0, s: 10, t: "READY", d: { session_id: "session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();
  frame(socket, { op: 0, t: "MESSAGE_CREATE", d: { id: "invalid-sequence" } });
  await h.flush();

  assert.equal((await h.core.getInbox("bot-alpha").getState()).sequence, 10);
  assert.equal(h.core.sessions.get("bot-alpha").lastError, "gateway_dispatch_sequence_missing");
  assert.equal(socket.closed.at(-1).code, 4002);
});

test("scheduled heartbeat waits for ACK and advances the single shared alarm", async () => {
  const h = makeHarness();
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  frame(socket, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(socket, { op: 0, s: 7, t: "READY", d: { session_id: "session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();

  const state = h.core.sessions.get("bot-alpha");
  const due = state.heartbeatAt;
  h.advance(due - h.now());
  await h.core.alarm();
  assert.equal(socket.sent.at(-1).op, 1);
  assert.equal(socket.sent.at(-1).d, 7);
  assert.equal(state.awaitingHeartbeatAck, true);
  assert.equal(state.heartbeatAckDeadline, h.now() + 30000);

  frame(socket, { op: 11, d: null });
  await h.flush();
  assert.equal(state.awaitingHeartbeatAck, false);
  assert.equal(state.heartbeatAckDeadline, null);
  assert.equal(await h.storage.getAlarm(), state.heartbeatAt);
});

test("missed heartbeat ACK closes only the stale socket and schedules bounded recovery", async () => {
  const h = makeHarness();
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  frame(socket, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(socket, { op: 0, s: 7, t: "READY", d: { session_id: "session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();
  const state = h.core.sessions.get("bot-alpha");

  h.advance(state.heartbeatAt - h.now());
  await h.core.alarm();
  h.advance(30001);
  await h.core.alarm();
  await h.flush();
  assert.equal(socket.closed.at(-1).code, 4000);
  assert.equal(state.status, "reconnect_wait");
  assert.ok(state.reconnectAt >= h.now());
  assert.equal(h.core.sockets.has("bot-beta"), true);
});

test("Invalid Session false clears resume state and sends Identify after randomized delay", async () => {
  const h = makeHarness({ random: () => 0.5 });
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  frame(socket, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(socket, { op: 0, s: 4, t: "READY", d: { session_id: "old-session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();

  frame(socket, { op: 9, d: false });
  await h.flush();
  const inbox = h.core.getInbox("bot-alpha");
  assert.equal((await inbox.getState()).sessionId, null);
  assert.equal(h.core.sessions.get("bot-alpha").pendingAuthAction, "identify");
  const sendCount = socket.sent.length;
  h.advance(3500);
  await h.core.alarm();
  assert.equal(socket.sent.length, sendCount + 1);
  assert.equal(socket.sent.at(-1).op, 2);
});

test("close code 4006 clears resume state before reconnecting with Identify", async () => {
  const h = makeHarness();
  await h.core.initialize();
  await h.core.start();
  const first = h.sockets[0];
  frame(first, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(first, { op: 0, s: 5, t: "READY", d: { session_id: "old-session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();

  first.emit("close", { code: 4006 });
  await h.flush();
  assert.equal((await h.core.getInbox("bot-alpha").getState()).sessionId, null);
  const reconnectAt = h.core.sessions.get("bot-alpha").reconnectAt;
  h.advance(Math.max(0, reconnectAt - h.now()));
  await h.core.alarm();
  assert.equal(h.sockets.length, 3);
  assert.equal(h.sockets[2].context.id, "bot-alpha");
  assert.ok(h.sockets[2].url.startsWith("wss://gateway.discord.gg/"));
});

test("fatal Gateway close code 4014 stops retrying and marks the identity fatal", async () => {
  const h = makeHarness();
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  socket.emit("close", { code: 4014 });
  await h.flush();
  const state = h.core.sessions.get("bot-alpha");
  assert.equal(state.status, "fatal");
  assert.equal(state.reconnectAt, null);
  assert.equal(await h.storage.getAlarm(), null);
});

test("queue capacity failure does not advance sequence and requests replay", async () => {
  const h = makeHarness();
  h.core.inboxOptions = { maxPendingEvents: 1, maxPendingBytes: 2048, maxEventBytes: 1024 };
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  frame(socket, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(socket, { op: 0, s: 10, t: "READY", d: { session_id: "session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();
  frame(socket, { op: 0, s: 11, t: "MESSAGE_CREATE", d: { id: "first" } });
  await h.flush();
  frame(socket, { op: 0, s: 12, t: "MESSAGE_CREATE", d: { id: "second" } });
  await h.flush();

  assert.equal((await h.core.getInbox("bot-alpha").getState()).sequence, 11);
  assert.equal((await h.core.getInbox("bot-alpha").getMetrics()).pendingEvents, 1);
  assert.equal(h.core.sessions.get("bot-alpha").status, "reconnect_wait");
  assert.equal(h.core.sessions.get("bot-alpha").lastError, "durable_gateway_inbox_full");
  assert.equal(socket.closed.at(-1).code, 4000);
});

test("fatal malformed HELLO and stale socket events cannot overwrite a newer generation", async () => {
  const h = makeHarness();
  await h.core.initialize();
  await h.core.start();
  const first = h.sockets[0];
  frame(first, { op: 10, d: { heartbeat_interval: 5 } });
  await h.flush();
  assert.equal(first.closed.at(-1).code, 4004);
  assert.equal(h.core.sessions.get("bot-alpha").status, "fatal");

  const state = h.core.sessions.get("bot-alpha");
  state.status = "disconnected";
  state.reconnectAt = null;
  await h.core.openSocket("bot-alpha");
  const second = h.sockets.at(-1);
  frame(second, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  const before = await h.core.getInbox("bot-alpha").getState();
  frame(first, { op: 0, s: 999, t: "READY", d: { session_id: "stale", resume_gateway_url: "wss://stale.example" } });
  await h.flush();
  assert.deepEqual(await h.core.getInbox("bot-alpha").getState(), before);
});

test("stop closes sockets, clears the one alarm, and persists stopped state", async () => {
  const h = makeHarness();
  await h.core.initialize();
  await h.core.start();
  const sockets = [...h.sockets];
  await h.core.stop();
  assert.ok(sockets.every((socket) => socket.closed.at(-1).code === 1000));
  assert.equal(await h.storage.getAlarm(), null);
  assert.ok([...h.core.sessions.values()].every((state) => state.status === "stopped"));
});


test("sends the source-backed Bot 005 modal ACK once before dispatch wakeup", async () => {
  const order = [];
  let ackCalls = 0;
  let ackInput = null;
  let callbackObservedState = null;
  const handlerRegistry = {
    route: ({ eventType }) => eventType === "INTERACTION_CREATE"
      ? { status: "routed", handlers: ["bot005"] }
      : { status: "ignored", reason: "not_interaction" },
  };
  const h = makeHarness({
    now: () => Date.now(),
    handlerRegistry,
    protectInteraction: async (payload) => {
      const { token, ...safe } = payload;
      return { ...safe, interaction_token: { version: 1, algorithm: "A256GCM", iv: "iv", ciphertext: "cipher" } };
    },
    planInteractionAck: createBot005InteractionAckPlanner(),
    acknowledgeInteraction: async (input) => {
      ackCalls += 1;
      order.push("ack");
      ackInput = input;
      const pending = await h.core.getInbox("bot-alpha").listPending();
      callbackObservedState = pending[0]?.interactionAckState ?? null;
      return { acknowledged: true, responseType: 9, status: 204 };
    },
    onDispatch: async () => { order.push("dispatch-wakeup"); },
  });
  await h.core.initialize();
  await h.core.start();
  const socket = h.sockets[0];
  frame(socket, { op: 10, d: { heartbeat_interval: 30000 } });
  await h.flush();
  frame(socket, { op: 0, s: 1, t: "READY", d: { session_id: "session", resume_gateway_url: "wss://resume.example" } });
  await h.flush();
  frame(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
    id: "1569000000000000001",
    type: 3,
    application_id: APP_A,
    guild_id: GUILD_A,
    token: "secret-token-for-ack-test",
    data: { component_type: 2, custom_id: "membercard:edit" },
  }});
  await h.flush();
  const inbox = h.core.getInbox("bot-alpha");
  assert.equal((await inbox.listPending())[0].interactionAckState, "acknowledged");
  assert.equal(ackCalls, 1);
  assert.equal(ackInput?.interactionId, "1569000000000000001");
  assert.equal(ackInput?.response?.type, 9);
  assert.equal(callbackObservedState, "attempting");
  assert.deepEqual(order, ["ack", "dispatch-wakeup"]);
  frame(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
    id: "1569000000000000001",
    type: 3,
    application_id: APP_A, guild_id: GUILD_A,
    token: "secret-token-for-ack-test",
    data: { component_type: 2, custom_id: "membercard:edit" },
  }});
  await h.flush();
  assert.equal(ackCalls, 1);
});
