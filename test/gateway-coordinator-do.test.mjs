import test from "node:test";
import assert from "node:assert/strict";
import { GatewayCoordinatorDurableObject } from "../src/gateway-coordinator-do.mjs";

const GUILD_ID = "1565048205970767992";
const APP_ID = "1565304619838742598";
const TOKEN = "non-production-test-token-not-a-real-credential";
const INTERNAL = "gateway-control-test-secret-with-at-least-32-chars";
const DEFINITIONS = JSON.stringify([{
  id: "bot-alpha",
  guildId: GUILD_ID,
  applicationId: APP_ID,
  intents: 513,
  enabled: true,
  tokenRef: "BOT_ALPHA_TOKEN",
}]);
const HANDLER_MANIFEST = JSON.stringify({
  guildId: GUILD_ID,
  applicationId: APP_ID,
  liveChannelId: "1565048207178862763",
  livePublisher: "none",
  enabledHandlers: [
    "bot005",
    "social-owner-console",
    "fan-club-level-up",
    "discord-engagement-engine",
    "gift-assist",
  ],
});

class MemoryDOStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
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
    const copy = new Map([...this.values.entries()].map(([key, value]) => [key, structuredClone(value)]));
    const tx = {
      get: async (key) => copy.get(key),
      put: async (key, value) => copy.set(key, structuredClone(value)),
      delete: async (key) => copy.delete(key),
      list: async (options = {}) => {
        const result = new Map();
        const { prefix = "", limit = 1000, startAfter } = options;
        const keys = [...copy.keys()]
          .filter((key) => key.startsWith(prefix) && (startAfter === undefined || key > startAfter))
          .sort();
        for (const key of keys.slice(0, limit)) result.set(key, structuredClone(copy.get(key)));
        return result;
      },
    };
    const result = await callback(tx);
    this.values = copy;
    return result;
  }
  async setAlarm(timestamp) { this.alarmAt = Number(timestamp); }
  async deleteAlarm() { this.alarmAt = null; }
  async getAlarm() { return this.alarmAt; }
}

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.listeners = new Map();
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) ?? [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) ?? []) callback(event);
  }
  send(value) { this.sent.push(JSON.parse(String(value))); }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { code, reason });
  }
}

const okJson = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

async function withRuntime({ botId = APP_ID, guildId = GUILD_ID } = {}, callback) {
  const oldFetch = globalThis.fetch;
  const oldWebSocket = globalThis.WebSocket;
  const calls = [];
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, authorization: options.headers?.authorization });
    if (parsed.pathname === "/api/v10/users/@me") {
      return okJson({ id: botId, bot: true, username: "momentum-test-bot" });
    }
    if (parsed.pathname === "/api/v10/guilds/" + GUILD_ID) {
      return okJson({ id: guildId, name: "Momentum Movement" });
    }
    return okJson({ error: "not_found" }, 404);
  };
  try {
    await callback({ calls, sockets: FakeWebSocket.instances });
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldWebSocket;
  }
}

function makeObject(storage, overrides = {}) {
  const env = {
    GATEWAY_COORDINATOR_ENABLED: "true",
    GATEWAY_CLIENT_DEFINITIONS: DEFINITIONS,
    GATEWAY_HANDLER_MANIFEST: HANDLER_MANIFEST,
    BOT_ALPHA_TOKEN: TOKEN,
    MCP_INTERNAL_BEARER_TOKEN: INTERNAL,
    ...overrides,
  };
  return new GatewayCoordinatorDurableObject({ storage }, env);
}

const control = (path, method = "GET", body) => new Request("https://gateway.internal" + path, {
  method,
  headers: {
    authorization: "Bearer " + INTERNAL,
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
  },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

function dispatch(socket, payload) {
  socket.emit("message", { data: JSON.stringify(payload) });
}

test("requires internal bearer authentication and keeps the feature flag off by default", async () => {
  const storage = new MemoryDOStorage();
  const object = makeObject(storage, { GATEWAY_COORDINATOR_ENABLED: "false" });
  const denied = await object.fetch(new Request("https://gateway.internal/status"));
  assert.equal(denied.status, 401);

  const disabled = await object.fetch(control("/status"));
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).reason, "feature_flag_off");
  assert.equal(FakeWebSocket.instances.length, 0);
});

test("refuses to start when the handler manifest is missing or mismatched", async () => {
  const missing = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: "" });
  const missingResponse = await missing.fetch(control("/start", "POST"));
  assert.equal(missingResponse.status, 503);

  const mismatchedManifest = JSON.stringify({
    guildId: "1565048205970767993",
    applicationId: APP_ID,
    liveChannelId: "1565048207178862763",
    livePublisher: "none",
    enabledHandlers: ["bot005"],
  });
  const mismatched = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: mismatchedManifest });
  const mismatchResponse = await mismatched.fetch(control("/start", "POST"));
  assert.equal(mismatchResponse.status, 503);
});

test("refuses to start until client definitions are configured", async () => {
  const storage = new MemoryDOStorage();
  const object = makeObject(storage, { GATEWAY_CLIENT_DEFINITIONS: "" });
  const result = await object.fetch(control("/start", "POST"));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, "gateway_coordinator_start_failed");
  assert.equal(FakeWebSocket.instances.length, 0);
});

test("verifies Discord application and guild identity before opening an outbound socket", async () => {
  await withRuntime({}, async ({ calls, sockets }) => {
    const storage = new MemoryDOStorage();
    const object = makeObject(storage);
    const started = await object.fetch(control("/start", "POST"));
    assert.equal(started.status, 202);
    assert.equal((await started.json()).status, "starting");
    assert.equal(sockets.length, 1);
    assert.ok(calls.some((call) => call.path === "/api/v10/users/@me"));
    assert.ok(calls.some((call) => call.path === "/api/v10/guilds/" + GUILD_ID));
    assert.ok(calls.every((call) => call.authorization === "Bot " + TOKEN));

    const status = await object.fetch(control("/status"));
    assert.equal(status.status, 200);
    const data = await status.json();
    assert.equal(data.clients[0].status, "connecting");
    assert.equal(JSON.stringify(data).includes(TOKEN), false);
  });
});

test("fails closed on a bot application identity mismatch", async () => {
  await withRuntime({ botId: "1565304619838742599" }, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage());
    const result = await object.fetch(control("/start", "POST"));
    assert.equal(result.status, 503);
    assert.equal((await result.json()).status, "not_started");
    assert.equal(sockets.length, 0);
  });
});

test("reset-fatal accepts only a configured client ID and resets only that fatal session", async () => {
  await withRuntime({ botId: "1565304619838742599" }, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage());
    const first = await object.fetch(control("/start", "POST"));
    assert.equal(first.status, 503);
    const badId = await object.fetch(control("/reset-fatal", "POST", { clientId: "../other" }));
    assert.equal(badId.status, 400);
    const reset = await object.fetch(control("/reset-fatal", "POST", { clientId: "bot-alpha" }));
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).reset, true);
    assert.equal(sockets.length, 0);
  });
});

test("stop is durable across Durable Object re-instantiation", async () => {
  await withRuntime({}, async ({ sockets }) => {
    const storage = new MemoryDOStorage();
    const object = makeObject(storage);
    const started = await object.fetch(control("/start", "POST"));
    assert.equal(started.status, 202);
    const stopped = await object.fetch(control("/stop", "POST"));
    assert.equal(stopped.status, 200);
    assert.equal((await storage.getAlarm()), null);

    const restartedObject = makeObject(storage);
    await restartedObject.alarm();
    const status = await restartedObject.fetch(control("/status"));
    assert.equal(status.status, 200);
    const data = await status.json();
    assert.equal(data.clients[0].status, "stopped");
    assert.equal(sockets.length, 1);
  });
});

test("alarm recovers the coordinator after object re-instantiation using durable state", async () => {
  await withRuntime({}, async ({ sockets }) => {
    const storage = new MemoryDOStorage();
    const first = makeObject(storage);
    await first.fetch(control("/start", "POST"));
    const initial = sockets[0];
    const firstCore = await first.corePromise;
    dispatch(initial, { op: 10, d: { heartbeat_interval: 30000 } });
    await firstCore.serial;
    dispatch(initial, { op: 0, s: 30, t: "READY", d: { session_id: "durable-session", resume_gateway_url: "wss://resume.durable.example" } });
    await firstCore.serial;
    dispatch(initial, { op: 0, s: 31, t: "MESSAGE_CREATE", d: { id: "persisted-event" } });
    await firstCore.serial;

    // Simulate object eviction with no graceful close callback. The next alarm
    // must rebuild the core and resume from the last durably committed cursor.
    const second = makeObject(storage);
    await second.alarm();
    assert.equal(sockets.length, 2);
    const resumed = sockets[1];
    assert.ok(resumed.url.startsWith("wss://resume.durable.example/"));
    dispatch(resumed, { op: 10, d: { heartbeat_interval: 30000 } });
    const secondCore = await second.corePromise;
    await secondCore.serial;
    assert.equal(resumed.sent[0].op, 6);
    assert.equal(resumed.sent[0].d.seq, 31);
  });
});
