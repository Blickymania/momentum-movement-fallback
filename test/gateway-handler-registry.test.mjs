import test from "node:test";
import assert from "node:assert/strict";
import { createGatewayHandlerRegistry, CORE_COMMANDS, FAN_CLUB_PROFILE_HUB, SOCIAL_BOOKS } from "../src/gateway-handler-registry.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const LIVE_CHANNEL = "1565048207178862763";
const ALL_FEATURES = [
  "bot005",
  "social-owner-console",
  "fan-club-level-up",
  "discord-engagement-engine",
  "gift-assist",
];

function manifest(overrides = {}) {
  return {
    guildId: GUILD,
    applicationId: APP,
    liveChannelId: LIVE_CHANNEL,
    livePublisher: "none",
    enabledHandlers: ALL_FEATURES,
    ...overrides,
  };
}

function interaction(customId, overrides = {}) {
  return {
    application_id: APP,
    guild_id: GUILD,
    channel_id: "1565643251783049237",
    message: { id: "1566060000000000000", author: { id: APP } },
    data: { component_type: 2, custom_id: customId },
    ...overrides,
  };
}

function event(type, payload) {
  return { eventType: type, payload };
}

test("routes known feature prefixes to exactly one owner", () => {
  const registry = createGatewayHandlerRegistry(manifest());
  const cases = [
    ["ddxp:my", "discord-engagement-engine"],
    ["gift:start", "gift-assist"],
    ["fclub:manual", "fan-club-level-up"],
    ["ums:former:abc", "fan-club-level-up"],
    ["coach:request", "bot005"],
    ["dcp:staff:0:std26c", "bot005"],
    ["membercard:edit", "bot005"],
    ["social3:refresh", "social-owner-console"],
    ["db10:s:0", "social-owner-console"],
  ];
  for (const [customId, owner] of cases) {
    const result = registry.route(event("INTERACTION_CREATE", interaction(customId)));
    assert.equal(result.status, "routed", customId);
    assert.deepEqual(result.handlers, [owner], customId);
  }
  const listener = createGatewayHandlerRegistry(manifest({ livePublisher: "live-events-listener" }));
  assert.deepEqual(listener.route(event("INTERACTION_CREATE", interaction("cw:live:open"))).handlers, ["live-events-listener"]);
  const shadow = createGatewayHandlerRegistry(manifest({ livePublisher: "live-now-v2" }));
  assert.deepEqual(shadow.route(event("INTERACTION_CREATE", interaction("ln2:post"))).handlers, ["live-now-v2"]);
});

test("resolves the uniprof collision using its exact Fan Club hub message", () => {
  const registry = createGatewayHandlerRegistry(manifest());
  const exact = registry.route(event("INTERACTION_CREATE", interaction("uniprof:member", {
    channel_id: FAN_CLUB_PROFILE_HUB.channelId,
    message: { id: FAN_CLUB_PROFILE_HUB.messageId, author: { id: APP } },
  })));
  assert.deepEqual(exact.handlers, ["fan-club-level-up"]);

  const other = registry.route(event("INTERACTION_CREATE", interaction("uniprof:member")));
  assert.deepEqual(other.handlers, ["bot005"]);
});

test("resolves the mompass collision using exact birthday and anniversary book messages", () => {
  const registry = createGatewayHandlerRegistry(manifest());
  for (const book of Object.values(SOCIAL_BOOKS)) {
    const social = registry.route(event("INTERACTION_CREATE", interaction("mompass:birthday", {
      channel_id: book.channelId,
      message: { id: book.messageId, author: { id: APP } },
    })));
    assert.deepEqual(social.handlers, ["social-owner-console"]);
  }

  const memberPassport = registry.route(event("INTERACTION_CREATE", interaction("mompass:edit")));
  assert.deepEqual(memberPassport.handlers, ["bot005"]);
});

test("routes /rules only through its isolated read-only capability", () => {
  const registry = createGatewayHandlerRegistry(manifest({ enabledHandlers: ["bot005-rules"] }));
  const route = registry.route(event("INTERACTION_CREATE", {
    guild_id: GUILD, application_id: APP, type: 2, data: { name: "rules" },
  }));
  assert.deepEqual(route.handlers, ["bot005-rules"]);
  assert.equal(route.routeKey, "command:rules");
  const other = registry.route(event("INTERACTION_CREATE", {
    guild_id: GUILD, application_id: APP, type: 2, data: { name: "ban" },
  }));
  assert.equal(other.status, "disabled");
});

test("routes /statsstatus only through its isolated capability", () => {
  const registry = createGatewayHandlerRegistry(manifest({ enabledHandlers: ["bot005-statsstatus"] }));
  const route = registry.route(event("INTERACTION_CREATE", {
    guild_id: GUILD, application_id: APP, type: 2, data: { name: "statsstatus" },
  }));
  assert.deepEqual(route.handlers, ["bot005-statsstatus"]);
  assert.equal(route.routeKey, "command:statsstatus");
});

test("routes the exact 36-command Bot 005 registry and ignores arbitrary commands", () => {
  const registry = createGatewayHandlerRegistry(manifest());
  // Compared with the recovered Momentum Movement Bot 005 snapshot on codex/dawn-failover-repairs.
  assert.deepEqual(CORE_COMMANDS, [
    "addtocase","announce","audit","automod","ban","bot-status","botconfig","botstatus",
    "channelorder","channelposition","chatfirst","closecase","eventcreate","events","help",
    "kick","lock","member","ping","poll","purge","report","role","rules","server","slowmode",
    "statsset","statsstatus","support","tiktok","timeout","unban","warn","dashboard",
    "bot-test","forum-admin",
  ]);
  assert.equal(CORE_COMMANDS.length, 36);
  for (const name of CORE_COMMANDS) {
    const result = registry.route(event("INTERACTION_CREATE", {
      application_id: APP,
      guild_id: GUILD,
      type: 2,
      data: { name, type: 1 },
    }));
    assert.deepEqual(result.handlers, ["bot005"], name);
  }
  const unknown = registry.route(event("INTERACTION_CREATE", {
    application_id: APP,
    guild_id: GUILD,
    type: 2,
    data: { name: "unknown-admin-command", type: 1 },
  }));
  assert.equal(unknown.status, "unhandled");
  assert.deepEqual(unknown.handlers, []);
});

test("routes coaching and Gift Assist DM interactions without requiring guild_id", () => {
  const registry = createGatewayHandlerRegistry(manifest());
  const coaching = registry.route(event("INTERACTION_CREATE", interaction("coach:request", {
    guild_id: undefined,
    channel_id: "1567000000000000000",
    message: undefined,
  })));
  assert.deepEqual(coaching.handlers, ["bot005"]);

  const gift = registry.route(event("INTERACTION_CREATE", interaction("gift:member:approve:GA-12345678", {
    guild_id: undefined,
    channel_id: "1567000000000000001",
    message: undefined,
  })));
  assert.deepEqual(gift.handlers, ["gift-assist"]);
});

test("routes MessageCreate to engagement and only one explicitly selected LIVE publisher", () => {
  const none = createGatewayHandlerRegistry(manifest());
  const regular = none.route(event("MESSAGE_CREATE", {
    guild_id: GUILD, channel_id: LIVE_CHANNEL, id: "m1", content: "hello",
  }));
  assert.deepEqual(regular.handlers, ["discord-engagement-engine"]);

  const listener = createGatewayHandlerRegistry(manifest({ livePublisher: "live-events-listener" }));
  const listenerRoute = listener.route(event("MESSAGE_CREATE", {
    guild_id: GUILD, channel_id: LIVE_CHANNEL, id: "m2", content: "https://www.tiktok.com/@test/live",
  }));
  assert.deepEqual(listenerRoute.handlers, ["discord-engagement-engine", "live-events-listener"]);

  const shadow = createGatewayHandlerRegistry(manifest({ livePublisher: "live-now-v2" }));
  const shadowRoute = shadow.route(event("MESSAGE_CREATE", {
    guild_id: GUILD, channel_id: LIVE_CHANNEL, id: "m3", content: "https://www.tiktok.com/@test/live",
  }));
  assert.deepEqual(shadowRoute.handlers, ["discord-engagement-engine", "live-now-v2"]);
});

test("returns explicit ignored/unhandled/disabled outcomes and never cross-routes guilds", () => {
  const registry = createGatewayHandlerRegistry(manifest({ enabledHandlers: ["discord-engagement-engine"] }));
  const otherGuild = registry.route(event("MESSAGE_CREATE", {
    guild_id: "1565048205970767999", channel_id: LIVE_CHANNEL, id: "m4",
  }));
  assert.equal(otherGuild.status, "ignored");

  const disabled = registry.route(event("INTERACTION_CREATE", interaction("gift:start")));
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.handler, "gift-assist");

  const unknown = registry.route(event("INTERACTION_CREATE", interaction("unknown:button")));
  assert.equal(unknown.status, "unhandled");

  const wrongApp = registry.route(event("INTERACTION_CREATE", interaction("gift:start", {
    application_id: "1565304619838742599",
  })));
  assert.equal(wrongApp.reason, "application_mismatch");

  const unknownDispatch = registry.route(event("PRESENCE_UPDATE", { user: { id: "1" } }));
  assert.equal(unknownDispatch.reason, "event_not_consumed");
});

test("requires explicit single-owner LIVE publisher and safe handler manifest", () => {
  assert.throws(() => createGatewayHandlerRegistry({}), /guild and application/);
  assert.throws(() => createGatewayHandlerRegistry(manifest({ livePublisher: "both" })), /at most one LIVE publisher/);
  assert.throws(() => createGatewayHandlerRegistry(manifest({
    enabledHandlers: ["bot005", "live-events-listener"],
  })), /invalid LIVE publisher configuration/);
  assert.throws(() => createGatewayHandlerRegistry(manifest({
    enabledHandlers: ["bot005", "unknown-handler"],
  })), /Unknown handler/);
  assert.throws(() => createGatewayHandlerRegistry(manifest({ liveChannelId: "not-a-snowflake" })), /liveChannelId/);
});

test("rejects malformed Gateway events instead of guessing their owner", () => {
  const registry = createGatewayHandlerRegistry(manifest());
  assert.throws(() => registry.route(null), /must be an object/);
  assert.throws(() => registry.route({ eventType: "MESSAGE_CREATE", payload: null }), /missing its type or payload/);
});
