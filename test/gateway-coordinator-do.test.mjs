import test from "node:test";
import assert from "node:assert/strict";
import { GatewayCoordinatorDurableObject } from "../src/gateway-coordinator-do.mjs";
import { DurableEngagementLedger } from "../src/durable-engagement-ledger.mjs";
import { DurableGatewayDeliveryLedger } from "../src/durable-gateway-dispatcher.mjs";
import { DurableBot005ProfileStore, createBot005ProfileCipher } from "../src/durable-bot005-profile-store.mjs";
import { DurableBot005ConfirmationStore } from "../src/durable-bot005-confirmations.mjs";
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
        : parsed.pathname === "/api/v10/guilds/" + GUILD_ID && parsed.searchParams.get("with_counts") === "true"
          ? parsed.pathname + parsed.search
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
      return okJson({ id: guildId, owner_id: "1565200000000000001", name: "Momentum Movement" });
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
    if (parsed.pathname === "/api/v10/guilds/" + GUILD_ID && parsed.searchParams.get("with_counts") === "true") {
      return okJson({ id: GUILD_ID, name: "Momentum Movement", approximate_member_count: 1234 });
    }
    if (parsed.pathname === "/api/v10/guilds/" + GUILD_ID + "/members/1569000000000000099") {
      return okJson({ user: { id: "1569000000000000099" }, joined_at: "2021-08-15T22:30:00.000Z" });
    }
    if (parsed.pathname === "/api/v10/guilds/" + GUILD_ID + "/scheduled-events") {
      return okJson([
        { id: "1567000000000000010", guild_id: GUILD_ID, status: 1, name: "Momentum check-in", scheduled_start_time: "2027-01-01T00:00:00.000Z" },
        { id: "1567000000000000011", guild_id: "1565048205970767993", status: 1, name: "Foreign event", scheduled_start_time: "2027-01-02T00:00:00.000Z" },
      ]);
    }
    if (parsed.pathname === "/api/v10/channels/1566000000000000005") {
      return okJson({ id: "1566000000000000005", guild_id: GUILD_ID, parent_id: "1566000000000000001", type: 11,
        name: "Momentum thread", applied_tags: ["1566000000000000002"],
        thread_metadata: { archived: false, locked: false, archive_timestamp: "2026-11-01T00:00:00.000Z" } });
    }
    if (parsed.pathname === "/api/v10/channels/1566000000000000001") {
      return okJson({ id: "1566000000000000001", guild_id: GUILD_ID, type: 15, name: "community-forum", available_tags: [
        { id: "1566000000000000002", name: "General", moderated: false },
      ] });
    }
    if (parsed.pathname === "/api/v10/channels/1566030504635924600") {
      return okJson({ id: "1566030504635924600", guild_id: GUILD_ID, type: 2, name: "live-members" });
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

test("tiktok capability requires its matching flag before opening a Gateway socket", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-tiktok"] });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: manifestValue });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 503); assert.equal(sockets.length, 0);
  });
});

test("/help responds through its isolated default-off handler", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-help"] });
  await withRuntime({}, async ({ calls, sockets }) => {
    const storage = new MemoryDOStorage(), object = makeObject(storage, { GATEWAY_HANDLER_MANIFEST: manifestValue, BOT005_HELP_ENABLED: "true" });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 202);
    const socket = sockets[0]; dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise; await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: { session_id: "help-session", resume_gateway_url: "wss://resume.help.example" } }); await core.serial;
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: { id: "1569000000000000064", application_id: APP_ID, guild_id: GUILD_ID,
      channel_id: "1565643996624199760", token: "non-production-help-interaction-token", type: 2,
      member: { user: { id: "1569000000000000002" } }, data: { name: "help" } } }); await core.serial;
    const inbox = core.getInbox("bot-alpha"), [queued] = await inbox.listPending();
    assert.equal(queued.interactionAckState, "acknowledged"); assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-help"]);
    assert.equal((await object.dispatchers.get("bot-alpha").drain({ limit: 1 })).status, "ok");
    assert.equal(calls.filter((call) => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 1);
  });
});

test("help capability requires its matching flag before opening a Gateway socket", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-help"] });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: manifestValue });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 503); assert.equal(sockets.length, 0);
  });
});

test("isolated /server and /dashboard read only verified guild counts", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-server"] });
  await withRuntime({}, async ({ calls, sockets }) => {
    const storage = new MemoryDOStorage(), object = makeObject(storage, { GATEWAY_HANDLER_MANIFEST: manifestValue, BOT005_SERVER_ENABLED: "true" });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 202);
    const socket = sockets[0]; dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise; await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: { session_id: "server-session", resume_gateway_url: "wss://resume.server.example" } }); await core.serial;
    for (const [n, name] of ["server", "dashboard"].entries()) {
      dispatch(socket, { op: 0, s: n + 2, t: "INTERACTION_CREATE", d: { id: "156900000000000006" + (n + 3), application_id: APP_ID, guild_id: GUILD_ID,
        channel_id: "1565643996624199760", token: "non-production-server-token-" + n, type: 2,
        member: { user: { id: "1569000000000000002" } }, data: { name } } }); await core.serial;
    }
    const inbox = core.getInbox("bot-alpha"), queued = await inbox.listPending();
    assert.equal(queued.length, 2); assert.ok(queued.every((entry) => entry.interactionAckState === "acknowledged"));
    assert.ok(queued.every((entry) => entry.dispatchRoute.handlers[0] === "bot005-server"));
    assert.equal((await object.dispatchers.get("bot-alpha").drain({ limit: 2 })).status, "ok");
    assert.equal(calls.filter((call) => call.path === "/api/v10/guilds/" + GUILD_ID + "?with_counts=true" && call.method === "GET").length, 2);
    assert.equal(calls.filter((call) => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 2);
  });
});

test("server capability requires its matching flag before opening a Gateway socket", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-server"] });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: manifestValue });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 503); assert.equal(sockets.length, 0);
  });
});

test("isolated /member reads only the selected guild member and edits a deferred reply", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-member"] });
  await withRuntime({}, async ({ calls, sockets }) => {
    const storage = new MemoryDOStorage(), object = makeObject(storage, { GATEWAY_HANDLER_MANIFEST: manifestValue, BOT005_MEMBER_ENABLED: "true" });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 202);
    const socket = sockets[0]; dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise; await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: { session_id: "member-session", resume_gateway_url: "wss://resume.member.example" } }); await core.serial;
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: { id: "1569000000000000062", application_id: APP_ID, guild_id: GUILD_ID,
      channel_id: "1565643996624199760", token: "non-production-member-interaction-token", type: 2,
      member: { user: { id: "1569000000000000002" } }, data: { name: "member", options: [{ name: "user", type: 6, value: "1569000000000000099" }],
        resolved: { users: { "1569000000000000099": { id: "1569000000000000099", username: "Safe_User", bot: false } } } } } }); await core.serial;
    const [queued] = await core.getInbox("bot-alpha").listPending();
    assert.equal(queued.interactionAckState, "acknowledged"); assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-member"]);
    assert.equal((await object.dispatchers.get("bot-alpha").drain({ limit: 1 })).status, "ok");
    const delivery = new DurableGatewayDeliveryLedger(storage, { namespace: "gateway-dispatch-bot-alpha" });
    assert.equal((await delivery.get(queued.eventKey, "bot005-member")).status, "completed");
    assert.equal(calls.filter((call) => call.path === "/api/v10/guilds/" + GUILD_ID + "/members/1569000000000000099" && call.method === "GET").length, 1);
    assert.equal(calls.filter((call) => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 1);
    assert.equal(JSON.stringify(calls).includes("non-production-member-interaction-token"), false);
  });
});

test("member capability requires its matching flag before opening a Gateway socket", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-member"] });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: manifestValue });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 503); assert.equal(sockets.length, 0);
  });
});

test("isolated /events reads the authorized guild schedule and edits a deferred reply", async () => {
  const eventsManifest = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-events"] });
  await withRuntime({}, async ({ calls, sockets }) => {
    const storage = new MemoryDOStorage();
    const object = makeObject(storage, { GATEWAY_HANDLER_MANIFEST: eventsManifest, BOT005_EVENTS_ENABLED: "true" });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 202);
    const socket = sockets[0]; dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise; await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: { session_id: "events-session", resume_gateway_url: "wss://resume.events.example" } }); await core.serial;
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: { id: "1569000000000000061", application_id: APP_ID,
      guild_id: GUILD_ID, channel_id: "1565643996624199760", token: "non-production-events-interaction-token",
      type: 2, member: { user: { id: "1569000000000000002" } }, data: { name: "events" } } }); await core.serial;
    const inbox = core.getInbox("bot-alpha"), [queued] = await core.getInbox("bot-alpha").listPending();
    assert.equal(queued.interactionAckState, "acknowledged"); assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-events"]);
    assert.equal((await object.dispatchers.get("bot-alpha").drain({ limit: 1 })).status, "ok");
    assert.equal((await inbox.listPending()).length, 0);
    const delivery = new DurableGatewayDeliveryLedger(storage, { namespace: "gateway-dispatch-bot-alpha" });
    assert.equal((await delivery.get(queued.eventKey, "bot005-events")).status, "completed");
    assert.equal(calls.filter((call) => call.path === "/api/v10/guilds/" + GUILD_ID + "/scheduled-events" && call.method === "GET").length, 1);
    assert.equal(calls.filter((call) => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 1);
    assert.equal(JSON.stringify(calls).includes("non-production-events-interaction-token"), false);
  });
});

test("events capability requires its matching flag before opening a Gateway socket", async () => {
  const eventsManifest = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-events"] });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: eventsManifest });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 503);
    assert.equal(sockets.length, 0);
  });
});

test("isolated /statsstatus reads the exact verified display channel and returns a public deferred reply", async () => {
  const statsManifest = JSON.stringify({
    guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none",
    enabledHandlers: ["bot005-statsstatus"],
  });
  await withRuntime({}, async ({ calls, sockets }) => {
    const storage = new MemoryDOStorage();
    const object = makeObject(storage, {
      GATEWAY_HANDLER_MANIFEST: statsManifest,
      BOT005_STATSSTATUS_ENABLED: "true",
    });
    const started = await object.fetch(control("/start", "POST"));
    assert.equal(started.status, 202);
    const socket = sockets[0];
    dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise;
    await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: {
      session_id: "stats-session", resume_gateway_url: "wss://resume.stats.example",
    }});
    await core.serial;
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
      id: "1569000000000000051", application_id: APP_ID, guild_id: GUILD_ID,
      channel_id: "1565643996624199760", token: "non-production-stats-interaction-token",
      type: 2, member: { user: { id: "1569000000000000002" } }, data: { name: "statsstatus" },
    }});
    await core.serial;
    const inbox = core.getInbox("bot-alpha");
    const [queued] = await inbox.listPending();
    assert.equal(queued.interactionAckState, "acknowledged");
    assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-statsstatus"]);
    const result = await object.dispatchers.get("bot-alpha").drain({ limit: 1 });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal((await inbox.listPending()).length, 0);
    const delivery = new DurableGatewayDeliveryLedger(storage, { namespace: "gateway-dispatch-bot-alpha" });
    assert.equal((await delivery.get(queued.eventKey, "bot005-statsstatus")).status, "completed");
    assert.equal(calls.filter((call) => call.path === "/api/v10/channels/1566030504635924600" && call.method === "GET").length, 1);
    assert.equal(calls.filter((call) => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 1);
    assert.equal(JSON.stringify(calls).includes("non-production-stats-interaction-token"), false);
  });
});

test("statsstatus capability requires its matching flag before opening a Gateway socket", async () => {
  const statsManifest = JSON.stringify({
    guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none",
    enabledHandlers: ["bot005-statsstatus"],
  });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: statsManifest });
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


test("owner-only /forum-admin inspect follows exact ACK, selected-channel GET and durable dispatch", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-forum-inspect"] });
  await withRuntime({}, async ({ calls, sockets }) => {
    const object = makeObject(new MemoryDOStorage(), {
      GATEWAY_HANDLER_MANIFEST: manifestValue, BOT005_FORUM_INSPECT_ENABLED: "true",
    });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 202);
    const socket = sockets[0]; dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise; await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: { session_id: "forum-inspect-session", resume_gateway_url: "wss://resume.forum-inspect.example" } }); await core.serial;
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
      id: "1569000000000000101", application_id: APP_ID, guild_id: GUILD_ID,
      channel_id: "1565643996624199760", token: "non-production-forum-inspect-token", type: 2,
      member: { user: { id: "1565200000000000001" }, permissions: "0" },
      data: { name: "forum-admin", options: [{ type: 1, name: "inspect", options: [
        { type: 7, name: "forum", value: "1566000000000000001" },
      ] }] },
    } }); await core.serial;
    const inbox = core.getInbox("bot-alpha"), [queued] = await inbox.listPending();
    assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-forum-inspect"]);
    assert.equal(queued.interactionAckState, "acknowledged");
    assert.equal((await object.dispatchers.get("bot-alpha").drain({ limit: 1 })).status, "ok");
    assert.equal(calls.filter(call => call.path === "/api/v10/channels/1566000000000000001" && call.method === "GET").length, 1);
    assert.equal(calls.filter(call => call.path === "/api/v10/channels/1566000000000000001" && call.method !== "GET").length, 0);
    assert.equal(calls.filter(call => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 1);
    assert.equal(JSON.stringify(calls).includes("non-production-forum-inspect-token"), false);
  });
});

test("forum inspect capability requires its matching flag before opening a Gateway socket", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-forum-inspect"] });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: manifestValue });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 503);
    assert.equal(sockets.length, 0);
  });
});


test("owner-only /forum-admin diagnose follows exact ACK, guild-scoped GETs and durable dispatch", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-forum-diagnose"] });
  await withRuntime({}, async ({ calls, sockets }) => {
    const object = makeObject(new MemoryDOStorage(), {
      GATEWAY_HANDLER_MANIFEST: manifestValue, BOT005_FORUM_DIAGNOSE_ENABLED: "true",
    });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 202);
    const socket = sockets[0]; dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise; await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: { session_id: "forum-diagnose-session", resume_gateway_url: "wss://resume.forum-diagnose.example" } }); await core.serial;
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
      id: "1569000000000000102", application_id: APP_ID, guild_id: GUILD_ID,
      channel_id: "1565643996624199760", token: "non-production-forum-diagnose-token", type: 2,
      member: { user: { id: "1565200000000000001" }, permissions: "0" },
      data: { name: "forum-admin", options: [{ type: 1, name: "diagnose" }] },
    } }); await core.serial;
    const inbox = core.getInbox("bot-alpha"), [queued] = await inbox.listPending();
    assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-forum-diagnose"]);
    assert.equal(queued.interactionAckState, "acknowledged");
    assert.equal((await object.dispatchers.get("bot-alpha").drain({ limit: 1 })).status, "ok");
    assert.equal(calls.filter(call => call.path === "/api/v10/guilds/" + GUILD_ID && call.method === "GET").length, 1);
    assert.equal(calls.filter(call => call.path === "/api/v10/guilds/" + GUILD_ID + "/channels" && call.method === "GET").length, 1);
    assert.equal(calls.filter(call => call.path.includes("/channels") && call.method !== "GET").length, 0);
    assert.equal(calls.filter(call => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 1);
    assert.equal(JSON.stringify(calls).includes("non-production-forum-diagnose-token"), false);
  });
});

test("forum diagnose capability requires its matching flag before opening a Gateway socket", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-forum-diagnose"] });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: manifestValue });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 503);
    assert.equal(sockets.length, 0);
  });
});


test("owner-only /forum-admin thread reads only the selected thread and its forum parent", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-forum-thread"] });
  await withRuntime({}, async ({ calls, sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: manifestValue, BOT005_FORUM_THREAD_ENABLED: "true" });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 202);
    const socket = sockets[0]; dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise; await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: { session_id: "forum-thread-session", resume_gateway_url: "wss://resume.forum-thread.example" } }); await core.serial;
    dispatch(socket, { op: 0, s: 2, t: "INTERACTION_CREATE", d: {
      id: "1569000000000000103", application_id: APP_ID, guild_id: GUILD_ID,
      channel_id: "1565643996624199760", token: "non-production-forum-thread-token", type: 2,
      member: { user: { id: "1565200000000000001" }, permissions: "0" },
      data: { name: "forum-admin", options: [{ type: 1, name: "thread", options: [
        { type: 3, name: "thread_id", value: "1566000000000000005" },
      ] }] },
    } }); await core.serial;
    const inbox = core.getInbox("bot-alpha"), [queued] = await inbox.listPending();
    assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-forum-thread"]);
    assert.equal(queued.interactionAckState, "acknowledged");
    assert.equal((await object.dispatchers.get("bot-alpha").drain({ limit: 1 })).status, "ok");
    assert.equal(calls.filter(call => call.path === "/api/v10/channels/1566000000000000005" && call.method === "GET").length, 1);
    assert.equal(calls.filter(call => call.path === "/api/v10/channels/1566000000000000001" && call.method === "GET").length, 1);
    assert.equal(calls.filter(call => call.path.includes("/channels") && call.method !== "GET").length, 0);
    assert.equal(JSON.stringify(calls).includes("non-production-forum-thread-token"), false);
  });
});

test("owner-bound forum confirmation follows exact ACK and durable dispatch without a Discord mutation", async () => {
  const id = "forum_confirm_nonce_0001", messageId = "1566060000000000000";
  const storage = new MemoryDOStorage();
  const store = new DurableBot005ConfirmationStore(storage, {
    key: "bot005:forum-confirmations:bot-alpha",
  });
  await store.create({
    id, kind: "forum-rename", actorId: "1565200000000000001", guildId: GUILD_ID,
    channelId: "1565643251783049237", expiresAt: Date.now() + 120_000,
    payload: { threadId: "1566000000000000005", forumId: "1566000000000000001", before: "Old", title: "New" },
  });
  await store.bindMessage(id, messageId);
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-forum-confirm"] });
  await withRuntime({}, async ({ calls, sockets }) => {
    const object = makeObject(storage, {
      GATEWAY_HANDLER_MANIFEST: manifestValue,
      BOT005_FORUM_CONFIRM_ENABLED: "true",
    });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 202);
    const socket = sockets[0]; dispatch(socket, { op: 10, d: { heartbeat_interval: 30000 } });
    const core = await object.corePromise; await core.serial;
    dispatch(socket, { op: 0, s: 1, t: "READY", d: { session_id: "forum-confirm-session", resume_gateway_url: "wss://resume.forum-confirm.example" } }); await core.serial;
    const sendClick = async (sequence, interactionId, token) => {
      dispatch(socket, { op: 0, s: sequence, t: "INTERACTION_CREATE", d: {
        id: interactionId, application_id: APP_ID, guild_id: GUILD_ID,
        channel_id: "1565643251783049237", token, type: 3,
        member: { user: { id: "1565200000000000001" } },
        message: { id: messageId, author: { id: APP_ID } },
        data: { custom_id: "mm005:forum-confirm:confirm:" + id },
      } });
      await core.serial;
      const [queued] = await core.getInbox("bot-alpha").listPending();
      assert.equal(queued.interactionAckState, "acknowledged");
      assert.deepEqual(queued.dispatchRoute.handlers, ["bot005-forum-confirm"]);
      assert.equal((await object.dispatchers.get("bot-alpha").drain({ limit: 1 })).status, "ok");
    };
    await sendClick(2, "1569000000000000104", "non-production-forum-confirm-token-one");
    assert.equal((await store.get(id)).state, "failed");
    assert.equal((await store.get(id)).resultCode, "executor_unavailable");
    await sendClick(3, "1569000000000000105", "non-production-forum-confirm-token-two");
    assert.equal((await store.get(id)).state, "failed");
    assert.equal(calls.filter(call => call.path.includes("/channels") && call.method !== "GET").length, 0);
    assert.equal(calls.filter(call => call.path === "/api/v10/webhooks/:application/:token/messages/@original" && call.method === "PATCH").length, 2);
    assert.equal(JSON.stringify([...storage.values]).includes("non-production-forum-confirm-token-one"), false);
    assert.equal(JSON.stringify([...storage.values]).includes("non-production-forum-confirm-token-two"), false);
  });
});

test("forum confirmation capability requires its matching flag before opening a Gateway socket", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-forum-confirm"] });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: manifestValue });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 503);
    assert.equal(sockets.length, 0);
  });
});

test("forum thread capability requires its matching flag before opening a Gateway socket", async () => {
  const manifestValue = JSON.stringify({ guildId: GUILD_ID, applicationId: APP_ID, livePublisher: "none", enabledHandlers: ["bot005-forum-thread"] });
  await withRuntime({}, async ({ sockets }) => {
    const object = makeObject(new MemoryDOStorage(), { GATEWAY_HANDLER_MANIFEST: manifestValue });
    assert.equal((await object.fetch(control("/start", "POST"))).status, 503);
    assert.equal(sockets.length, 0);
  });
});
