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

test("builds recovered profile/birthday/anniversary modals and delegates coaching forms", () => {
  const profile = planner(button("membercard:edit"), routed);
  assert.equal(profile.status, "ready");
  assert.equal(profile.response.type, 9);
  assert.equal(profile.response.data.custom_id, "memberdata:profile");
  assert.equal(profile.response.data.title, "Edit My Member Profile");
  assert.deepEqual(profile.response.data.components.map(row => row.components[0].custom_id),
    ["about", "tiktok", "instagram", "visibility"]);
  assert.equal(profile.response.data.components[0].components[0].style, 2);
  assert.equal(profile.response.data.components[0].components[0].max_length, 450);
  assert.equal(profile.response.data.components[3].components[0].required, true);

  const birthday = planner(button("profilev7:milestone:birthday:mine"), routed);
  assert.equal(birthday.response.data.custom_id, "memberdata:birthday");
  assert.deepEqual(birthday.response.data.components.map(row => row.components[0].custom_id),
    ["date", "year", "visibility"]);
  assert.equal(birthday.response.data.components[1].components[0].required, false);

  const anniversary = planner(button("mompass:anniversary"), routed);
  assert.equal(anniversary.response.data.custom_id, "memberdata:anniversary");
  assert.equal(anniversary.response.data.components[1].components[0].required, true);

  for (const id of ["coach:staff:clarify:case1", "coach:dm:respond:case1", "coach:request"]) {
    const event = button(id, { guild_id: id === "coach:request" ? null : GUILD });
    const scoped = planner(event, routed);
    assert.equal(scoped.status, "blocked", id);
    assert.equal(scoped.reason, "bot005_coach_modal_builder_required", id);
  }
});

test("blocks profile modal selectors outside guild scope", () => {
  assert.deepEqual(planner(button("membercard:edit", { guild_id: null }), routed), {
    status: "blocked", reason: "bot005_profile_modal_guild_required",
  });
});

test("uses the supplied modal response and validates its type before returning it", () => {
  const buildModalResponse = (interaction) => ({
    type: 9,
    data: { custom_id: "profile:form", title: "Profile", components: [{ type: 1, components: [] }], source: interaction.data.custom_id },
  });
  const plan = createBot005InteractionAckPlanner({ buildModalResponse });
  const result = plan(button("coach:staff:clarify:case1"), routed);
  assert.equal(result.status, "ready");
  assert.equal(result.response.type, 9);
  assert.equal(result.response.data.source, "coach:staff:clarify:case1");

  const invalid = createBot005InteractionAckPlanner({ buildModalResponse: () => ({ type: 6 }) });
  assert.deepEqual(invalid(button("coach:staff:clarify:case1"), routed), {
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
