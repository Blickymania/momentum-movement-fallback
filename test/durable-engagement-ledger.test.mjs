import test from "node:test";
import assert from "node:assert/strict";
import { DurableEngagementLedger, createEngagementMessageHandler, isMeaningfulEngagementMessage } from "../src/durable-engagement-ledger.mjs";

class MemoryStorage {
  constructor() { this.values = new Map(); this.serial = Promise.resolve(); }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async transaction(callback) {
    const run = async () => {
      const copy = new Map([...this.values.entries()].map(([key, value]) => [key, structuredClone(value)]));
      const txn = {
        get: async (key) => structuredClone(copy.get(key)),
        put: async (key, value) => copy.set(key, structuredClone(value)),
      };
      const result = await callback(txn);
      this.values = copy;
      return result;
    };
    const promise = this.serial.then(run, run);
    this.serial = promise.catch(() => {});
    return promise;
  }
}

const GUILD = "1565048205970767992";
const USER = "1569000000000000001";
const CHANNEL_A = "1565643996624199760";
const CHANNEL_B = "1565643996624199761";

function makeMessage(overrides = {}) {
  return {
    id: "1569000000000000100",
    guild_id: GUILD,
    channel_id: CHANNEL_A,
    author: { id: USER, bot: false },
    webhook_id: undefined,
    type: 0,
    content: "This is a meaningful contribution to our community discussions.",
    timestamp: "2026-11-13T15:00:00.000Z",
    message_reference: null,
    ...overrides,
  };
}

function makeLedger({ now = () => Date.parse("2026-11-13T15:00:00.000Z"), maxUsers = 1000 } = {}) {
  const storage = new MemoryStorage();
  const ledger = new DurableEngagementLedger(storage, { guildId: GUILD, namespace: "engagement-test", now, maxUsers });
  return { storage, ledger };
}

const publicChannel = (baseChannelId = CHANNEL_A, options = {}) => async () => ({
  eligible: true,
  guildId: GUILD,
  baseChannelId,
  everyoneCanView: true,
  nsfw: false,
  nameContext: "general-chat",
  ...options,
});

test("applies the original 5+3+2 scoring rules and stores no raw message text", async () => {
  let now = Date.parse("2026-11-13T15:00:00.000Z");
  const { storage, ledger } = makeLedger({ now: () => now });
  await ledger.initialize();

  const first = await ledger.award(makeMessage(), { channelResolver: publicChannel(CHANNEL_A) });
  assert.equal(first.credited, true);
  assert.equal(first.points, 8);
  assert.equal(first.reply, false);

  now += 60_001;
  const reply = await ledger.award(makeMessage({
    id: "1569000000000000101",
    channel_id: CHANNEL_B,
    content: "Our different discussion adds insight for the whole community.",
    message_reference: { message_id: "1569000000000000999" },
    timestamp: new Date(now).toISOString(),
  }), { channelResolver: publicChannel(CHANNEL_B) });
  assert.equal(reply.credited, true);
  assert.equal(reply.points, 10);
  assert.equal(reply.reply, true);

  now += 60_001;
  const sameChannel = await ledger.award(makeMessage({
    id: "1569000000000000102",
    content: "One more meaningful reply to keep our community discussion moving.",
    timestamp: new Date(now).toISOString(),
    message_reference: { message_id: "1569000000000000998" },
  }), { channelResolver: publicChannel(CHANNEL_A) });
  assert.equal(sameChannel.credited, true);
  assert.equal(sameChannel.points, 7);

  const stored = JSON.stringify([...storage.values.values()]);
  assert.equal(stored.includes("meaningful contribution"), false);
  assert.equal(stored.includes("This is a meaningful contribution"), false);
  assert.equal(stored.includes(USER), true);
  assert.equal(first.storedContent, false);
});

test("enforces message de-duplication, 60-second cooldown and 10-minute repeat-hash suppression", async () => {
  let now = Date.parse("2026-11-13T15:00:00.000Z");
  const { ledger } = makeLedger({ now: () => now });
  await ledger.initialize();
  const firstMessage = makeMessage();
  assert.equal((await ledger.award(firstMessage, { channelResolver: publicChannel() })).credited, true);
  assert.equal((await ledger.award(firstMessage, { channelResolver: publicChannel() })).reason, "duplicate_message");

  now += 30_000;
  const differentText = makeMessage({
    id: "1569000000000000101",
    content: "A different meaningful discussion with enough words to qualify.",
    timestamp: new Date(now).toISOString(),
  });
  assert.equal((await ledger.award(differentText, { channelResolver: publicChannel() })).reason, "user_cooldown");

  now += 30_001;
  const repeat = makeMessage({
    id: "1569000000000000102",
    timestamp: new Date(now).toISOString(),
  });
  assert.equal((await ledger.award(repeat, { channelResolver: publicChannel() })).reason, "repeat_content");

  now += 10 * 60_000 + 1;
  const afterRepeatWindow = makeMessage({
    id: "1569000000000000103",
    timestamp: new Date(now).toISOString(),
  });
  assert.equal((await ledger.award(afterRepeatWindow, { channelResolver: publicChannel() })).credited, true);
});

test("rejects bots, webhooks, non-public guilds and meaningless content", async () => {
  const { ledger } = makeLedger();
  await ledger.initialize();
  const cases = [
    { author: { id: USER, bot: true } },
    { webhook_id: "1569000000000000999" },
    { guild_id: "1565048205970767999" },
    { content: "hi" },
    { content: "!!!!!!!!!!!!!!!!!" },
    { type: 7 },
  ];
  for (const overrides of cases) {
    const result = await ledger.award(makeMessage({
      id: "1569000000000000" + String(Object.keys(overrides)[0].length).padStart(4, "0"),
      ...overrides,
    }), { channelResolver: publicChannel() });
    assert.equal(result.credited, false);
    assert.equal(result.reason, "message_not_eligible");
  }
});

test("rejects private, NSFW, sensitive and cross-guild channel resolver results", async () => {
  const { ledger } = makeLedger();
  await ledger.initialize();
  const cases = [
    { eligible: false, reason: "private" },
    { eligible: true, everyoneCanView: false },
    { eligible: true, nsfw: true },
    { eligible: true, nameContext: "moderator-only" },
    { eligible: true, guildId: "1565048205970767999" },
  ];
  let suffix = 200;
  for (const options of cases) {
    const result = await ledger.award(makeMessage({ id: "1569000000000000" + String(suffix++).padStart(4, "0") }), {
      channelResolver: publicChannel(CHANNEL_A, options),
    });
    assert.equal(result.credited, false);
    assert.equal(result.reason, "channel_not_eligible");
  }
});

test("caps the number of member records instead of growing without a bound", async () => {
  const { ledger } = makeLedger({ maxUsers: 1 });
  await ledger.initialize();
  assert.equal((await ledger.award(makeMessage(), { channelResolver: publicChannel() })).credited, true);
  const another = await ledger.award(makeMessage({
    id: "1569000000000000200",
    author: { id: "1569000000000000002", bot: false },
    timestamp: "2026-11-13T15:02:00.000Z",
  }), { channelResolver: publicChannel() });
  assert.equal(another.reason, "ledger_user_limit");
});

test("computes ET-based daily, weekly, monthly, yearly and lifetime snapshots", async () => {
  let now = Date.parse("2026-11-13T15:00:00.000Z");
  const { ledger } = makeLedger({ now: () => now });
  await ledger.initialize();
  await ledger.award(makeMessage(), { channelResolver: publicChannel() });
  now = Date.parse("2026-11-14T15:00:00.000Z");
  await ledger.award(makeMessage({
    id: "1569000000000000101",
    content: "A second qualifying discussion on a different day of the week.",
    timestamp: new Date(now).toISOString(),
  }), { channelResolver: publicChannel(CHANNEL_B) });

  const day = await ledger.snapshot("day", now);
  const week = await ledger.snapshot("week", now);
  const month = await ledger.snapshot("month", now);
  const year = await ledger.snapshot("year", now);
  const life = await ledger.snapshot("life", now);
  assert.equal(day.rows[0].score, 8);
  assert.equal(week.rows[0].score, 16);
  assert.equal(month.rows[0].score, 16);
  assert.equal(year.rows[0].score, 16);
  assert.equal(life.rows[0].score, 16);
  assert.match(day.note, /XP capture began 2026-11-13/);
  const insights = await ledger.insights();
  assert.equal(insights.users, 1);
  assert.equal(insights.messages, 2);
  assert.equal(insights.multiDayMembers, 1);
});

test("serializes concurrent awards so only one message is credited per cooldown window", async () => {
  const { ledger } = makeLedger();
  await ledger.initialize();
  const messages = Array.from({ length: 10 }, (_, index) => makeMessage({
    id: "1569000000000000" + String(300 + index).padStart(4, "0"),
    content: "Concurrent qualifying message number " + index + " for XP tests.",
  }));
  const results = await Promise.all(messages.map((message) =>
    ledger.award(message, { channelResolver: publicChannel() })
  ));
  assert.equal(results.filter((result) => result.credited).length, 1);
  assert.equal((await ledger.snapshot("life")).rows[0].score, 8);
});

test("creates a durable dispatcher handler with an idempotent receipt", async () => {
  const { ledger } = makeLedger();
  await ledger.initialize();
  const handler = createEngagementMessageHandler({
    ledger,
    channelResolver: publicChannel(),
  });
  const message = makeMessage();
  const result = await handler({
    eventKey: "engagement-event-1",
    eventType: "MESSAGE_CREATE",
    guildId: GUILD,
    sessionId: "session",
    sequence: 1,
    payload: message,
  }, { idempotencyKey: "engagement-event-1:discord-engagement-engine" });
  assert.equal(result.committed, true);
  assert.equal(result.result.credited, true);
  assert.equal(result.receiptId, "xp:" + message.id + ":" + USER);
});

test("rejects startup without a verified public channel resolver", async () => {
  const { ledger } = makeLedger();
  await ledger.initialize();
  assert.throws(() => createEngagementMessageHandler({ ledger }), /channel resolver/);
});

test("meaningful-text filter strips URLs and mentions before measuring content", () => {
  assert.equal(isMeaningfulEngagementMessage("https://example.com <@1569000000000000001> this is enough meaningful text."), true);
  assert.equal(isMeaningfulEngagementMessage("12345678901234567890"), false);
  assert.equal(isMeaningfulEngagementMessage("aaaaaaaaaaaa"), false);
});
