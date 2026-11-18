import test from "node:test";
import assert from "node:assert/strict";
import { createGatewayHandlerRegistry } from "../src/gateway-handler-registry.mjs";
import { createBot005InteractionAckPlanner } from "../src/bot005-interaction-ack-plan.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const routed = { status: "routed", handlers: ["bot005"] };
const otherOwner = { status: "routed", handlers: ["gift-assist"] };
const planner = createBot005InteractionAckPlanner();
const button = (custom_id, extra = {}) => ({
  type: 3, guild_id: GUILD, data: { custom_id }, ...extra,
});

test("selects a deferred reply for a registered Bot 005 command", () => {
  const result = planner({ type: 2, data: { name: "announce" } }, routed);
  assert.deepEqual(result, { status: "ready", response: { type: 5 } });
});

test("selects a deferred component update for ordinary Bot 005 buttons", () => {
  assert.deepEqual(planner(button("dcp:staff:0:std26c"), routed), {
    status: "ready", response: { type: 6 },
  });
});

test("requires an explicit type-9 response builder for every recovered modal-opening selector", () => {
  const ids = [
    "membercard:edit", "mp26:edit", "mompass:edit",
    "mp26:date:b", "mompass:birthday", "profilev7:birthday",
    "profilev7:milestone:birthday:mine", "mp26:date:a",
    "mompass:anniversary", "profilev7:anniversary",
    "profilev7:milestone:anniversary:mine",
    "coach:staff:clarify:case1", "coach:dm:respond:case1",
    "coach:request",
  ];
  for (const id of ids) {
    const result = planner(button(id, { guild_id: id === "coach:request" ? null : GUILD }));
    const scoped = planner(button(id, { guild_id: id === "coach:request" ? null : GUILD }), routed);
    assert.equal(scoped.status, "blocked", id);
    assert.equal(scoped.reason, "bot005_modal_builder_required", id);
  }
});

test("uses the supplied modal response and validates its type before returning it", () => {
  const buildModalResponse = (interaction) => ({
    type: 9,
    data: { custom_id: "profile:form", title: "Profile", components: [{ type: 1, components: [] }], source: interaction.data.custom_id },
  });
  const plan = createBot005InteractionAckPlanner({ buildModalResponse });
  const result = plan(button("membercard:edit"), routed);
  assert.equal(result.status, "ready");
  assert.equal(result.response.type, 9);
  assert.equal(result.response.data.source, "membercard:edit");

  const invalid = createBot005InteractionAckPlanner({ buildModalResponse: () => ({ type: 6 }) });
  assert.deepEqual(invalid(button("membercard:edit"), routed), {
    status: "blocked", reason: "bot005_modal_response_invalid",
  });
});

test("defers ordinary modal submissions but delegates the multi-step coaching modal", () => {
  assert.deepEqual(planner({ type: 5, data: { custom_id: "profilev7:save" } }, routed), {
    status: "ready", response: { type: 5 },
  });
  assert.deepEqual(planner({ type: 5, data: { custom_id: "coach:request:step2" } }, routed), {
    status: "blocked", reason: "bot005_multistep_modal_handler_required",
  });
  const custom = createBot005InteractionAckPlanner({
    buildMultiStepModalResponse: () => ({ type: 4, data: { content: "Received" } }),
  });
  assert.deepEqual(custom({ type: 5, data: { custom_id: "coach:request:step2" } }, routed), {
    status: "ready", response: { type: 4, data: { content: "Received" } },
  });
});

test("fails closed for unverified owners, unknown commands and unsupported interaction types", () => {
  assert.deepEqual(planner({ type: 2, data: { name: "unknown" } }, routed), {
    status: "blocked", reason: "bot005_interaction_shape_unhandled",
  });
  assert.deepEqual(planner({ type: 3, data: { custom_id: "gift:queue" } }, otherOwner), {
    status: "blocked", reason: "bot005_route_not_verified",
  });
  assert.equal(planner({ type: 99, data: { custom_id: "coach:button" } }, routed).status, "blocked");
});

test("Bot 005 planner is consistent with the source-backed handler registry", () => {
  const registry = createGatewayHandlerRegistry({
    guildId: GUILD, applicationId: APP,
    enabledHandlers: ["bot005"],
  });
  const route = registry.route({ eventType: "INTERACTION_CREATE", payload: {
    guild_id: GUILD, application_id: APP, type: 2, data: { name: "announce" },
  } });
  assert.equal(route.handlers[0], "bot005");
  assert.deepEqual(planner({ type: 2, data: { name: "announce" } }, route), {
    status: "ready", response: { type: 5 },
  });
});
