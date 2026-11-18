import test from "node:test";
import assert from "node:assert/strict";
import { createGatewayHandlerRegistry } from "../src/gateway-handler-registry.mjs";
import { validateGatewayFeatureCapabilities } from "../src/gateway-coordinator-do.mjs";
import { GatewayEventDispatcher, DurableGatewayDeliveryLedger } from "../src/durable-gateway-dispatcher.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const MEMBER = "1565200000000000001";
const INTERACTION = "1565200000000000002";

function manifest(enabledHandlers) {
  return { guildId: GUILD, applicationId: APP, livePublisher: "none", enabledHandlers };
}

function profileSubmission() {
  return {
    guild_id: GUILD, application_id: APP, type: 5, id: INTERACTION,
    channel_id: "1565200000000000003", user: { id: MEMBER },
    data: { custom_id: "memberdata:birthday" },
  };
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async transaction(callback) {
    const copy = new Map([...this.values].map(([key, value]) => [key, structuredClone(value)]));
    const tx = {
      get: async (key) => copy.get(key),
      put: async (key, value) => copy.set(key, structuredClone(value)),
      delete: async (key) => copy.delete(key),
    };
    const result = await callback(tx);
    this.values = copy;
    return result;
  }
}

test("profile modal capability routes only the three supported type-5 forms", () => {
  const registry = createGatewayHandlerRegistry(manifest(["bot005-profile-modal"]));
  for (const customId of ["memberdata:profile", "memberdata:birthday", "memberdata:anniversary"]) {
    const result = registry.route({ eventType: "INTERACTION_CREATE", payload: { ...profileSubmission(), data: { custom_id: customId } } });
    assert.equal(result.status, "routed");
    assert.deepEqual(result.handlers, ["bot005-profile-modal"]);
  }
  const command = registry.route({ eventType: "INTERACTION_CREATE", payload: {
    guild_id: GUILD, application_id: APP, type: 2, data: { name: "ban" },
  } });
  assert.equal(command.status, "disabled");
  assert.equal(command.handler, "bot005");
  const pingRegistry = createGatewayHandlerRegistry(manifest(["bot005-ping"]));
  const ping = pingRegistry.route({ eventType: "INTERACTION_CREATE", payload: {
    guild_id: GUILD, application_id: APP, type: 2, data: { name: "ping" },
  }});
  assert.equal(ping.status, "routed");
  assert.deepEqual(ping.handlers, ["bot005-ping"]);
  const otherCommand = pingRegistry.route({ eventType: "INTERACTION_CREATE", payload: {
    guild_id: GUILD, application_id: APP, type: 2, data: { name: "ban" },
  }});
  assert.equal(otherCommand.status, "disabled");
  assert.equal(otherCommand.handler, "bot005");
  const statusRegistry = createGatewayHandlerRegistry(manifest(["bot005-status"]));
  const botStatus = statusRegistry.route({ eventType: "INTERACTION_CREATE", payload: {
    guild_id: GUILD, application_id: APP, type: 2, data: { name: "bot-status" },
  }});
  assert.deepEqual(botStatus.handlers, ["bot005-status"]);
  const wrongType = registry.route({ eventType: "INTERACTION_CREATE", payload: {
    ...profileSubmission(), type: 3,
  } });
  assert.equal(wrongType.status, "disabled");
  assert.equal(wrongType.handler, "bot005");
});

test("capability guard requires both explicit manifest registration and exact runtime flag", () => {
  const registry = createGatewayHandlerRegistry(manifest(["bot005-profile-modal"]));
  assert.throws(() => validateGatewayFeatureCapabilities(registry, {}), /explicitly agree/);
  assert.deepEqual(validateGatewayFeatureCapabilities(registry, { BOT005_PROFILE_MODAL_ENABLED: "true" }), {
    profileModalEnabled: true, pingEnabled: false, statusEnabled: false, rulesEnabled: false,
  });
  const pingRegistry = createGatewayHandlerRegistry(manifest(["bot005-ping"]));
  assert.throws(() => validateGatewayFeatureCapabilities(pingRegistry, {}), /explicitly agree/);
  assert.deepEqual(validateGatewayFeatureCapabilities(pingRegistry, { BOT005_PING_ENABLED: "true" }), {
    profileModalEnabled: false, pingEnabled: true, statusEnabled: false, rulesEnabled: false,
  });

  const statusRegistry = createGatewayHandlerRegistry(manifest(["bot005-status"]));
  assert.throws(() => validateGatewayFeatureCapabilities(statusRegistry, {}), /explicitly agree/);
  assert.deepEqual(validateGatewayFeatureCapabilities(statusRegistry, { BOT005_STATUS_ENABLED: "true" }), {
    profileModalEnabled: false, pingEnabled: false, statusEnabled: true, rulesEnabled: false,
  });

  const defaultRegistry = createGatewayHandlerRegistry(manifest(["discord-engagement-engine"]));
  assert.deepEqual(validateGatewayFeatureCapabilities(defaultRegistry, {}), { profileModalEnabled: false, pingEnabled: false, statusEnabled: false, rulesEnabled: false });
  assert.throws(() => validateGatewayFeatureCapabilities(defaultRegistry, {
    BOT005_PROFILE_MODAL_ENABLED: "true",
  }), /explicitly agree/);
  const fullBot005 = createGatewayHandlerRegistry(manifest(["bot005"]));
  assert.throws(() => validateGatewayFeatureCapabilities(fullBot005, {}), /adapter is unavailable/);
  assert.throws(() => validateGatewayFeatureCapabilities(fullBot005, { BOT005_PROFILE_MODAL_ENABLED: "true" }), /explicitly agree/);
});

test("dispatcher delivers profile submission only to its isolated handler", async () => {
  const registry = createGatewayHandlerRegistry(manifest(["bot005-profile-modal"]));
  const event = {
    guildId: GUILD, sessionId: "session-1", sequence: 5,
    eventType: "INTERACTION_CREATE", eventKey: "gateway:event-5",
    interactionAckState: "acknowledged", receivedAt: 1,
    payload: profileSubmission(),
  };
  let handlerCalls = 0;
  let acknowledged = 0;
  const inbox = {
    async listPending() { return [event]; },
    async acknowledge(keys) { acknowledged += keys.length; return { acknowledged: keys.length }; },
  };
  const ledger = new DurableGatewayDeliveryLedger(new MemoryStorage(), { namespace: "profile-test" });
  const dispatcher = new GatewayEventDispatcher({
    inbox, registry, ledger,
    handlers: {
      "bot005-profile-modal": async (delivered, context) => {
        handlerCalls += 1;
        assert.equal(delivered.payload.data.custom_id, "memberdata:birthday");
        assert.equal(context.guildId, GUILD);
        return { committed: true, receiptId: "receipt-1" };
      },
    },
  });
  const result = await dispatcher.drain({ limit: 1 });
  assert.equal(result.status, "ok");
  assert.equal(handlerCalls, 1);
  assert.equal(acknowledged, 1);
});

test("disabled profile modal path is blocked without invoking any handler", async () => {
  const registry = createGatewayHandlerRegistry(manifest(["discord-engagement-engine"]));
  const event = {
    guildId: GUILD, sessionId: "session-1", sequence: 5,
    eventType: "INTERACTION_CREATE", eventKey: "gateway:event-5",
    interactionAckState: "acknowledged", receivedAt: 1,
    payload: profileSubmission(),
  };
  let handlerCalls = 0;
  const inbox = {
    async listPending() { return [event]; },
    async acknowledge() { throw new Error("disabled_event_must_not_be_acknowledged"); },
  };
  const ledger = new DurableGatewayDeliveryLedger(new MemoryStorage(), { namespace: "profile-disabled-test" });
  const dispatcher = new GatewayEventDispatcher({
    inbox, registry, ledger,
    handlers: {
      "bot005-profile-modal": async () => {
        handlerCalls += 1;
        return { committed: true, receiptId: "should-not-run" };
      },
    },
  });
  const result = await dispatcher.drain({ limit: 1 });
  assert.equal(result.status, "blocked");
  assert.equal(handlerCalls, 0);
  assert.equal(await ledger.get("gateway:event-5", "bot005-profile-modal"), null);
});
