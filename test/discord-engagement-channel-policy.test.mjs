import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordEngagementChannelResolver } from "../src/discord-engagement-channel-policy.mjs";

const GUILD = "1565048205970767992";
const CHANNEL = "1565643996624199760";
const THREAD = "1569000000000000001";
const PARENT = CHANNEL;
const TOKEN = "test-bot-token-not-a-real-secret";

const ok = (value, status = 200) => new Response(JSON.stringify(value), { status });

function baseChannel(overrides = {}) {
  return {
    id: CHANNEL,
    guild_id: GUILD,
    type: 0,
    name: "general-chat",
    nsfw: false,
    permission_overwrites: [],
    ...overrides,
  };
}

function harness({ roles, channels, statusFor, now = () => 1_800_000_000_000 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, authorization: options.headers?.authorization });
    if (statusFor?.[parsed.pathname]) return ok({ message: "unavailable" }, statusFor[parsed.pathname]);
    if (parsed.pathname === "/api/v10/guilds/" + GUILD + "/roles") {
      return ok(roles ?? [{ id: GUILD, permissions: "1024" }]);
    }
    const channelId = parsed.pathname.split("/").at(-1);
    if (parsed.pathname.startsWith("/api/v10/channels/")) {
      const value = channels?.[channelId] ?? (channelId === CHANNEL ? baseChannel() : null);
      return value ? ok(value) : ok({ message: "Unknown Channel" }, 404);
    }
    return ok({ message: "not found" }, 404);
  };
  const resolve = createDiscordEngagementChannelResolver({
    token: TOKEN,
    guildId: GUILD,
    fetchImpl,
    now,
  });
  return { resolve, calls };
}

const message = (channelId = CHANNEL) => ({ guild_id: GUILD, channel_id: channelId });

test("accepts a verified public text channel visible to @everyone", async () => {
  const h = harness();
  const result = await h.resolve(message());
  assert.equal(result.eligible, true);
  assert.equal(result.guildId, GUILD);
  assert.equal(result.baseChannelId, CHANNEL);
  assert.equal(result.everyoneCanView, true);
  assert.equal(result.nsfw, false);
  assert.equal(result.isThread, false);
  assert.ok(h.calls.some((call) => call.path === "/api/v10/guilds/" + GUILD + "/roles"));
  assert.ok(h.calls.every((call) => call.authorization === "Bot " + TOKEN));
});

test("caches @everyone role permissions while checking each channel separately", async () => {
  const second = "1565643996624199761";
  const h = harness({ channels: {
    [CHANNEL]: baseChannel(),
    [second]: baseChannel({ id: second, name: "engagement-center" }),
  }});
  assert.equal((await h.resolve(message(CHANNEL))).eligible, true);
  assert.equal((await h.resolve(message(second))).eligible, true);
  assert.equal(h.calls.filter((call) => call.path.endsWith("/roles")).length, 1);
  assert.equal(h.calls.filter((call) => call.path.startsWith("/api/v10/channels/")).length, 2);
});

test("applies @everyone View Channel allow and deny overwrites correctly", async () => {
  const denied = harness({ channels: {
    [CHANNEL]: baseChannel({ permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: "1024" }] }),
  }});
  assert.equal((await denied.resolve(message())).reason, "everyone_cannot_view_channel");

  const explicitlyAllowed = harness({
    roles: [{ id: GUILD, permissions: "0" }],
    channels: {
      [CHANNEL]: baseChannel({ permission_overwrites: [{ id: GUILD, type: 0, allow: "1024", deny: "0" }] }),
    },
  });
  assert.equal((await explicitlyAllowed.resolve(message())).eligible, true);
});

test("rejects NSFW and sensitive channel/category names", async () => {
  const nsfw = harness({ channels: { [CHANNEL]: baseChannel({ nsfw: true }) } });
  assert.equal((await nsfw.resolve(message())).reason, "nsfw_channel");

  const sensitive = harness({ channels: { [CHANNEL]: baseChannel({ name: "moderator-only-chat" }) } });
  assert.equal((await sensitive.resolve(message())).reason, "sensitive_channel_name");
});

test("rejects cross-guild channels and non-text channel types", async () => {
  const crossGuild = harness({ channels: { [CHANNEL]: baseChannel({ guild_id: "1565048205970767999" }) } });
  assert.equal((await crossGuild.resolve(message())).reason, "channel_scope_mismatch");

  const voice = harness({ channels: { [CHANNEL]: baseChannel({ type: 2 }) } });
  assert.equal((await voice.resolve(message())).reason, "not_a_public_text_channel");
});

test("accepts public threads through their verified parent and rejects private threads", async () => {
  const publicThread = harness({
    channels: {
      [THREAD]: {
        id: THREAD, guild_id: GUILD, type: 11, parent_id: PARENT,
        name: "public-discussion", nsfw: false,
      },
      [PARENT]: baseChannel(),
    },
  });
  const threadResult = await publicThread.resolve(message(THREAD));
  assert.equal(threadResult.eligible, true);
  assert.equal(threadResult.isThread, true);
  assert.equal(threadResult.baseChannelId, PARENT);

  const privateThread = harness({
    channels: {
      [THREAD]: {
        id: THREAD, guild_id: GUILD, type: 12, parent_id: PARENT,
        name: "private-discussion", nsfw: false,
      },
    },
  });
  assert.equal((await privateThread.resolve(message(THREAD))).reason, "private_thread");
});

test("fails closed on forbidden, rate-limited and server-error Discord responses", async () => {
  const forbidden = harness({ statusFor: { ["/api/v10/channels/" + CHANNEL]: 403 } });
  assert.equal((await forbidden.resolve(message())).reason, "channel_not_visible");

  const limited = harness({ statusFor: { ["/api/v10/guilds/" + GUILD + "/roles"]: 429 } });
  await assert.rejects(() => limited.resolve(message()), /temporarily_unavailable/);

  const serverError = harness({ statusFor: { ["/api/v10/channels/" + CHANNEL]: 503 } });
  await assert.rejects(() => serverError.resolve(message()), /temporarily_unavailable/);
});

test("rejects resolver configuration with missing identity or credential", () => {
  assert.throws(() => createDiscordEngagementChannelResolver({ token: "", guildId: GUILD }), /configuration/);
  assert.throws(() => createDiscordEngagementChannelResolver({ token: TOKEN, guildId: "bad" }), /configuration/);
});
