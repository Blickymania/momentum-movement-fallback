import test from "node:test";
import assert from "node:assert/strict";
import { GatewayCoordinatorDurableObject } from "../src/gateway-coordinator-do.mjs";
import { DurableEngagementLedger } from "../src/durable-engagement-ledger.mjs";
import { DurableGatewayDeliveryLedger } from "../src/durable-gateway-dispatcher.mjs";
import { DurableBot005ProfileStore, createBot005ProfileCipher } from "../src/durable-bot005-profile-store.mjs";
import { parseBot005ProfileModal } from "../src/bot005-profile-modal.mjs";
import { createBot005PingHandler } from "../src/bot005-ping-handler.mjs";
import { createBot005StatusHandler } from "../src/bot005-status-handler.mjs";

const GUILD_ID = "1565048205970767992";
const APP_ID = "1565304619838742598";
const TOKEN = "non-production-test-token-not-a-real-credential";
const INTERNAL = "gateway-control-test-secret-with-at-least-32-chars";
const TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
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
  enabledHandlers: ["discord-engagement-engine"],
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
    const safePath = parsed.pathname.startsWith("/api/v10/interactions/")
      ? "/api/v10/interactions/:id/:token/callback"
      : parsed.pathname.startsWith("/api/v10/webhooks/")
        ? "/api/v10/webhooks/:application/:token/messages/@original"
        : parsed.pathname;
    calls.push({ path: safePath, method: options.method, authorization: options.headers?.authorization });
    if (parsed.pathname === "/api/v10/users/@me") {
      return okJson({ id: botId, bot: true, username: "momentum-test-bot" });
    }
    if (parsed.pathname === "/api/v10/guilds/" + GUILD_ID + "/roles") {
      return okJson([{ id: GUILD_ID, permissions: "1024" }]);
    }
    if (parsed.pathname === "/api/v10/channels/1565643996624199760") {
      return okJson({
        id: "1565643996624199760", guild_id: GUILD_ID, type: 0,
        name: "general-chat", nsfw: false, permission_overwrites: [],
      });
    }
    if (parsed.pathname === "/api/v10/guilds/" + GUILD_ID) {
      return okJson({ id: guildId, name: "Momentum Movement" });
    }
    if (parsed.pathname === "/api/v10/guilds/" + GUILD_ID + "/channels") {
      return okJson([
        { id: "1567000000000000001", guild_id: GUILD_ID, type: 2, name: "rules-voice" },
        { id: "1567000000000000002", guild_id: "1565048205970767993", type: 0, name: "rules-foreign" },
        { id: "1567000000000000003", guild_id: GUILD_ID, type: 0, name: "community-guidelines" },
      ]);
    }
    if (parsed.pathname === "/api/v10/guilds/" + GUILD_ID + "/channels") {
      return okJson([
        { id: "1567000000000000001", guild_id: GUILD_ID, type: 2, name: "rules-voice" },
        { id: "1567000000000000002", guild_id: "1565048205970767993", type: 0, name: "rules-foreign" },
        { id: "1567000000000000003", guild_id: GUILD_ID, type: 0, name: "community-guidelines" },
      ]);
    }
    if (parsed.pathname.startsWith("/api/v10/interactions/") && parsed.pathname.endsWith("/callback")) {
      return new Response(null, { status: 204 });
    }
    if (parsed.pathname.startsWith("/api/v10/webhooks/") && parsed.pathname.endsWith("/messages/@original")) {
      return new Response(null, { status: 204 });
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
    GATEWAY_INTERACTION_ENCRYPTION_KEY: TOKEN_ENCRYPTION_KEY,
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

test("refuses to start if the interaction-token encryption secret is unavailable", async () => {
  const object = makeObject(new MemoryDOStorage(), { GATEWAY_INTERACTION_ENCRYPTION_KEY: "" });
  const response = await object.fetch(control("/start", "POST"));
  assert.equal(response.status, 503);
  assert.equal(FakeWebSocket.instances.length, 0);
});

test("stores interaction tokens only as authenticated AES-GCM ciphertext", async () => {
  await withRuntime({}, async ({ sockets }) => {
    const storage = new MemoryDOStorage();
    const object = makeObject(storage);
    const started = await object.fetch(control("/start", "POST"));
    assert.equal(started.status, 202);
    const socket = sockets[0];
    dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise;
    await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: { session_id: "session", resume_gateway_url: "wss://resume.example" } });
    await core.serial;

    const interactionToken = "test-webhook-token-never-store-this-in-cleartext";
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
      id: "1569000000000000001",
      application_id: APP_ID,
      guild_id: GUILD_ID,
      channel_id: "1565643996624199760",
      token: interactionToken,
      type: 3,
      data: { component_type: 2, custom_id: "ddxp:my" },
      member: { user: { id: "1569000000000000002" } },
    }});
    await core.serial;

    const pending = await core.getInbox("bot-alpha").listPending();
    assert.equal(pending.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(pending[0].payload, "token"), false);
    assert.equal(typeof pending[0].payload.interaction_token.ciphertext, "string");
    assert.equal(JSON.stringify(pending).includes(interactionToken), false);
    assert.equal(JSON.stringify([...storage.values.values()]).includes(interactionToken), false);
    const restored = await object.tokenVault.decryptPayload(pending[0].payload);
    assert.equal(restored.token, interactionToken);
  });
});

test("refuses to start when an unported feature adapter is enabled", async () => {
  FakeWebSocket.instances = [];
  const manifest = JSON.stringify({
    guildId: GUILD_ID,
    applicationId: APP_ID,
    livePublisher: "none",
    enabledHandlers: ["bot005"],
  });
  const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: manifest });
  const response = await object.fetch(control("/start", "POST"));
  assert.equal(response.status, 503);
  assert.equal(FakeWebSocket.instances.length, 0);
});

test("profile modal capability reaches the durable store and deferred reply through mocked Gateway delivery", async () => {
  const profileManifest = JSON.stringify({
    guildId: GUILD_ID,
    applicationId: APP_ID,
    livePublisher: "none",
    enabledHandlers: ["bot005-profile-modal"],
  });
  await withRuntime({}, async ({ calls, sockets }) => {
    const storage = new MemoryDOStorage();
    const object = makeObject(storage, {
      GATEWAY_HANDLER_MANIFEST: profileManifest,
      BOT005_PROFILE_MODAL_ENABLED: "true",
      BOT005_PROFILE_ENCRYPTION_KEY: "11".repeat(32),
    });
    const started = await object.fetch(control("/start", "POST"));
    assert.equal(started.status, 202);
    const socket = sockets[0];
    dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise;
    await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: {
      session_id: "profile-session", resume_gateway_url: "wss://resume.profile.example",
    }});
    await core.serial;
    const memberId = "1569000000000000002";
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
      id: "1569000000000000011",
      application_id: APP_ID,
      guild_id: GUILD_ID,
      channel_id: "1565643996624199760",
      token: "non-production-test-interaction-token",
      type: 5,
      member: { user: { id: memberId } },
      data: {
        custom_id: "memberdata:birthday",
        components: [
          { type: 1, components: [{ type: 4, custom_id: "date", value: "02-29" }] },
          { type: 1, components: [{ type: 4, custom_id: "year", value: "" }] },
          { type: 1, components: [{ type: 4, custom_id: "visibility", value: "private" }] },
        ],
      },
    }});
    await core.serial;
    const inbox = core.getInbox("bot-alpha");
    const [queued] = await inbox.listPending();
    assert.equal(queued.interactionAckState, "acknowledged");
    assert.deepEqual(queued.dispatchRoute, {
      status: "routed",
      eventType: "INTERACTION_CREATE",
      handlers: ["bot005-profile-modal"],
      routeKey: "memberdata",
    });
    const profileStore = new DurableBot005ProfileStore(storage, {
      guildId: GUILD_ID,
      applicationId: APP_ID,
      cipher: createBot005ProfileCipher("11".repeat(32)),
    });
    const decryptedInteraction = await object.tokenVault.decryptPayload(queued.payload);
    const parsedSubmission = parseBot005ProfileModal(decryptedInteraction, { guildId: GUILD_ID, applicationId: APP_ID });
    assert.equal(parsedSubmission.status, "ready", JSON.stringify(parsedSubmission));
    assert.equal(profileStore.validateSubmission(parsedSubmission), true, JSON.stringify(parsedSubmission));
    const dispatchResult = await object.dispatchers.get("bot-alpha").drain({ limit: 1 });
    const deliveryLedger = new DurableGatewayDeliveryLedger(storage, { namespace: "gateway-dispatch-bot-alpha" });
    const failedDelivery = await deliveryLedger.get(queued.eventKey, "bot005-profile-modal");
    assert.equal(dispatchResult.status, "ok", JSON.stringify({ dispatchResult, failedDelivery }));
    assert.equal(dispatchResult.acknowledged, 1);
    assert.equal((await inbox.listPending()).length, 0);

    const saved = await profileStore.get(memberId);
    assert.deepEqual(saved.birthday, { date: "02-29", year: "", visibility: "private", post: null });
    const outbox = await profileStore.getMilestoneOutbox(memberId, "birthday");
    assert.equal(outbox.status, "pending");
    assert.equal((await deliveryLedger.get(queued.eventKey, "bot005-profile-modal")).status, "completed");
    assert.equal(calls.filter((call) => call.path === "/api/v10/interactions/:id/:token/callback" && call.method === "POST").length, 1);
    assert.equal(calls.filter((call) => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 1);
    assert.equal(JSON.stringify(calls).includes("non-production-test-interaction-token"), false);
  });
});

test("isolated /bot-status reports only the verified candidate Gateway state", async () => {
  const statusManifest = JSON.stringify({
    guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none",
    enabledHandlers: ["bot005-status"],
  });
  await withRuntime({}, async ({ calls, sockets }) => {
    const storage = new MemoryDOStorage();
    const object = makeObject(storage, {
      GATEWAY_HANDLER_MANIFEST: statusManifest,
      BOT005_STATUS_ENABLED: "true",
    });
    const started = await object.fetch(control("/start", "POST"));
    assert.equal(started.status, 202);
    const socket = sockets[0];
    dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise;
    await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: {
      session_id: "status-session", resume_gateway_url: "wss://resume.status.example",
    }});
    await core.serial;
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
      id: "1569000000000000031", application_id: APP_ID, guild_id: GUILD_ID,
      channel_id: "1565643996624199760", token: "non-production-status-interaction-token",
      type: 2, member: { user: { id: "1569000000000000002" } }, data: { name: "bot-status" },
    }});
    await core.serial;
    const inbox = core.getInbox("bot-alpha");
    const [queued] = await inbox.listPending();
    assert.equal(queued.interactionAckState, "acknowledged");
    assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-status"]);
    const result = await object.dispatchers.get("bot-alpha").drain({ limit: 1 });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal((await inbox.listPending()).length, 0);
    const delivery = new DurableGatewayDeliveryLedger(storage, { namespace: "gateway-dispatch-bot-alpha" });
    assert.equal((await delivery.get(queued.eventKey, "bot005-status")).status, "completed");
    assert.equal(calls.filter((call) => call.path === "/api/v10/interactions/:id/:token/callback" && call.method === "POST").length, 1);
    assert.equal(calls.filter((call) => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 1);
  });
});

test("isolated /ping command ACKs and edits one public deferred response through the Durable Object", async () => {
  const pingManifest = JSON.stringify({
    guildId: GUILD_ID,
    applicationId: APP_ID,
    livePublisher: "none",
    enabledHandlers: ["bot005-ping"],
  });
  await withRuntime({}, async ({ calls, sockets }) => {
    const storage = new MemoryDOStorage();
    const object = makeObject(storage, { GATEWAY_HANDLER_MANIFEST: pingManifest, BOT005_PING_ENABLED: "true" });
    const started = await object.fetch(control("/start", "POST"));
    assert.equal(started.status, 202);
    const socket = sockets[0];
    dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise;
    await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: {
      session_id: "ping-session", resume_gateway_url: "wss://resume.ping.example",
    }});
    await core.serial;
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
      id: "1569000000000000021", application_id: APP_ID, guild_id: GUILD_ID,
      channel_id: "1565643996624199760", token: "non-production-ping-interaction-token",
      type: 2, member: { user: { id: "1569000000000000002" } }, data: { name: "ping" },
    }});
    await core.serial;
    const inbox = core.getInbox("bot-alpha");
    const [queued] = await inbox.listPending();
    assert.equal(queued.interactionAckState, "acknowledged");
    assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-ping"]);
    const result = await object.dispatchers.get("bot-alpha").drain({ limit: 1 });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal((await inbox.listPending()).length, 0);
    const delivery = new DurableGatewayDeliveryLedger(storage, { namespace: "gateway-dispatch-bot-alpha" });
    assert.equal((await delivery.get(queued.eventKey, "bot005-ping")).status, "completed");
    assert.equal(calls.filter((call) => call.path === "/api/v10/interactions/:id/:token/callback" && call.method === "POST").length, 1);
    assert.equal(calls.filter((call) => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 1);
    assert.equal(JSON.stringify(calls).includes("non-production-ping-interaction-token"), false);
  });
});

test("isolated /rules capability reads only the verified guild and edits one public deferred reply", async () => {
  const rulesManifest = JSON.stringify({
    guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none",
    enabledHandlers: ["bot005-rules"],
  });
  await withRuntime({}, async ({ calls, sockets }) => {
    const storage = new MemoryDOStorage();
    const object = makeObject(storage, {
      GATEWAY_HANDLER_MANIFEST: rulesManifest,
      BOT005_RULES_ENABLED: "true",
    });
    const started = await object.fetch(control("/start", "POST"));
    assert.equal(started.status, 202);
    const socket = sockets[0];
    dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise;
    await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: {
      session_id: "rules-session", resume_gateway_url: "wss://resume.rules.example",
    }});
    await core.serial;
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
      id: "1569000000000000041", application_id: APP_ID, guild_id: GUILD_ID,
      channel_id: "1565643996624199760", token: "non-production-rules-interaction-token",
      type: 2, member: { user: { id: "1569000000000000002" } }, data: { name: "rules" },
    }});
    await core.serial;
    const inbox = core.getInbox("bot-alpha");
    const [queued] = await inbox.listPending();
    assert.equal(queued.interactionAckState, "acknowledged");
    assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-rules"]);
    const result = await object.dispatchers.get("bot-alpha").drain({ limit: 1 });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal((await inbox.listPending()).length, 0);
    const delivery = new DurableGatewayDeliveryLedger(storage, { namespace: "gateway-dispatch-bot-alpha" });
    assert.equal((await delivery.get(queued.eventKey, "bot005-rules")).status, "completed");
    assert.equal(calls.filter((call) => call.path === "/api/v10/guilds/" + GUILD_ID + "/channels" && call.method === "GET").length, 1);
    assert.equal(calls.filter((call) => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 1);
    assert.equal(JSON.stringify(calls).includes("non-production-rules-interaction-token"), false);
  });
});

test("rules capability requires its matching flag before opening a Gateway socket", async () => {
  const rulesManifest = JSON.stringify({
    guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none",
    enabledHandlers: ["bot005-rules"],
  });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: rulesManifest });
    const response = await object.fetch(control("/start", "POST"));
    assert.equal(response.status, 503);
    assert.equal(sockets.length, 0);
  });
});

test("profile modal capability without the runtime flag or encryption key opens no socket", async () => {
  const profileManifest = JSON.stringify({
    guildId: GUILD_ID,
    applicationId: APP_ID,
    livePublisher: "none",
    enabledHandlers: ["bot005-profile-modal"],
  });
  await withRuntime({}, async ({ calls, sockets }) => {
    const noFlag = makeObject(new MemoryDOStorage(), {
      GATEWAY_HANDLER_MANIFEST: profileManifest,
      BOT005_PROFILE_ENCRYPTION_KEY: "11".repeat(32),
    });
    const missingFlag = await noFlag.fetch(control("/start", "POST"));
    assert.equal(missingFlag.status, 503);
    assert.equal(sockets.length, 0);
    assert.equal(calls.length, 0);

    const missingKey = makeObject(new MemoryDOStorage(), {
      GATEWAY_HANDLER_MANIFEST: profileManifest,
      BOT005_PROFILE_MODAL_ENABLED: "true",
    });
    const rejected = await missingKey.fetch(control("/start", "POST"));
    assert.equal(rejected.status, 503);
    assert.equal(sockets.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("refuses to start until client definitions are configured", async () => {
  FakeWebSocket.instances = [];
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

test("Durable Object alarm delivers MESSAGE_CREATE through the Engagement ledger before acknowledging FIFO", async () => {
  await withRuntime({}, async ({ sockets }) => {
    const storage = new MemoryDOStorage();
    const object = makeObject(storage);
    const started = await object.fetch(control("/start", "POST"));
    assert.equal(started.status, 202);
    const socket = sockets[0];
    dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise;
    await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: { session_id: "engagement-session", resume_gateway_url: "wss://resume.example" } });
    await core.serial;
    const messageId = "1569000000000000100";
    const userId = "1569000000000000001";
    dispatch(socket, { op: 0, s: 2, t: "MESSAGE_CREATE", d: {
      id: messageId,
      guild_id: GUILD_ID,
      channel_id: "1565643996624199760",
      author: { id: userId, bot: false },
      type: 0,
      content: "This is a meaningful contribution to our community discussions.",
      timestamp: "2026-11-18T12:00:00.000Z",
    }});
    await core.serial;

    const inbox = core.getInbox("bot-alpha");
    const [queued] = await inbox.listPending();
    assert.equal(queued.payload.id, messageId);
    assert.ok((await storage.getAlarm()) <= Date.now() + 2_000);

    await object.alarm();

    assert.equal((await inbox.listPending()).length, 0);
    const xp = new DurableEngagementLedger(storage, { guildId: GUILD_ID, namespace: "momentum" });
    const snapshot = await xp.snapshot("life");
    assert.deepEqual(snapshot.rows, [{ id: userId, score: 8, lifetime: 8 }]);
    const delivery = new DurableGatewayDeliveryLedger(storage, { namespace: "gateway-dispatch-bot-alpha" });
    const receipt = await delivery.get(queued.eventKey, "discord-engagement-engine");
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.receiptId, "xp:" + messageId + ":" + userId);
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
    const noFeatureManifest = JSON.stringify({
      guildId: GUILD_ID,
      applicationId: APP_ID,
      livePublisher: "none",
      enabledHandlers: [],
    });
    const first = makeObject(storage, { GATEWAY_HANDLER_MANIFEST: noFeatureManifest });
    await first.fetch(control("/start", "POST"));
    const initial = sockets[0];
    const firstCore = await first.corePromise;
    dispatch(initial, { op: 10, d: { heartbeat_interval: 30000 } });
    await firstCore.serial;
    dispatch(initial, { op: 0, s: 30, t: "READY", d: { session_id: "durable-session", resume_gateway_url: "wss://resume.durable.example" } });
    await firstCore.serial;
    dispatch(initial, { op: 0, s: 31, t: "MESSAGE_CREATE", d: {
      id: "persisted-event",
      guild_id: GUILD_ID,
      channel_id: "1565643996624199760",
      content: "A qualifying interaction message for the engagement consumer.",
    } });
    await firstCore.serial;
    const firstPending = await firstCore.getInbox("bot-alpha").listPending();
    assert.equal(firstPending.length, 1);
    assert.equal(firstPending[0].payload.id, "persisted-event");

    // Simulate object eviction with no graceful close callback. The next alarm
    // rebuilds the core and resumes from the last committed cursor. This case
    // leaves feature dispatch disabled so it can verify durable inbox recovery.
    const second = makeObject(storage, { GATEWAY_HANDLER_MANIFEST: noFeatureManifest });
    await second.alarm();
    assert.equal(sockets.length, 2);
    const resumed = sockets[1];
    assert.ok(resumed.url.startsWith("wss://resume.durable.example/"));
    dispatch(resumed, { op: 10, d: { heartbeat_interval: 30000 } });
    const secondCore = await second.corePromise;
    await secondCore.serial;
    assert.equal(resumed.sent[0].op, 6);
    assert.equal(resumed.sent[0].d.seq, 31);
    const resumedPending = await secondCore.getInbox("bot-alpha").listPending();
    assert.equal(resumedPending.length, 1);
    assert.equal(resumedPending[0].payload.id, "persisted-event");
  });
});
