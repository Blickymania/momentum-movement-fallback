const DEFAULT_GUILD = "1565048205970767992";
const STATE_KEY_PREFIX = "engagement:ledger:";
const DAY_MS = 86_400_000;
const EXCLUDED_CHANNEL_NAMES = /safe.space|moderator|staff|admin|conference|meeting.room|recruit|incident|owner|security|private|prayer|faith|birthday|medical|crisis|system.health|server.tools|case.review|help.desk|coaching.request|support.case|mod.only/i;

function assertSnowflake(value, label) {
  if (typeof value !== "string" || !/^\d{15,22}$/.test(value)) {
    throw new TypeError(label + " must be a Discord snowflake");
  }
  return value;
}

function freshState(guildId, now) {
  return {
    version: 1,
    guildId,
    startedAt: now,
    captureStartedAt: null,
    users: {},
    seen: {},
    hashes: {},
    lastCredit: {},
    dayChannels: {},
  };
}

function utcPartsToLocalDay(timestamp, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp)).replace(/\//g, "-");
}

function isoDay(timestamp, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function weekMonday(date) {
  const noon = Date.parse(date + "T12:00:00Z");
  const dayOfWeek = new Date(noon).getUTCDay();
  return new Date(noon - ((dayOfWeek + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
}

function meaningful(text) {
  const normalized = String(text || "")
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/<[@#][!&]?\d+>/g, " ")
    .trim();
  return normalized.length >= 12 &&
    (normalized.match(/\p{L}/gu) || []).length >= 9 &&
    (normalized.match(/[\p{L}\p{N}]+/gu) || []).length >= 3 &&
    !/(.)\1{9,}/u.test(normalized);
}

function messageTimestamp(message, fallback) {
  if (Number.isFinite(message.createdTimestamp)) return Number(message.createdTimestamp);
  if (typeof message.timestamp === "string") {
    const parsed = Date.parse(message.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function hashContent(message) {
  // The digest itself is stored, never the raw message content.
  // Web Crypto avoids Node-only crypto APIs in the Durable Object runtime.
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      String(message.content || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim(),
    ),
  ).then((digest) => Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join(""));
}

function memberState() {
  return {
    xp: 0,
    messages: 0,
    replies: 0,
    monthly: {},
    daily: {},
    channels: {},
    activeDays: [],
  };
}

function cleanup(state, now) {
  const oldestDaily = isoDay(now - 400 * DAY_MS, "America/New_York");
  for (const user of Object.values(state.users)) {
    for (const day of Object.keys(user.daily || {})) {
      if (day < oldestDaily) delete user.daily[day];
    }
    user.activeDays = [...new Set(user.activeDays || [])].sort().slice(-90);
  }
  for (const [messageId, timestamp] of Object.entries(state.seen)) {
    if (now - Number(timestamp) > 35 * DAY_MS) delete state.seen[messageId];
  }
  for (const [hash, timestamp] of Object.entries(state.hashes)) {
    if (now - Number(timestamp) > 12 * 60 * 60 * 1000) delete state.hashes[hash];
  }
  for (const [userId, entry] of Object.entries(state.dayChannels)) {
    if (entry?.day !== oldestDaily && entry?.day < oldestDaily) delete state.dayChannels[userId];
  }
}

export class DurableEngagementLedger {
  constructor(storage, {
    guildId = DEFAULT_GUILD,
    namespace = "momentum",
    now = () => Date.now(),
    timeZone = "America/New_York",
    maxUsers = 100_000,
  } = {}) {
    if (!storage || typeof storage.get !== "function" ||
        typeof storage.put !== "function" || typeof storage.transaction !== "function") {
      throw new TypeError("Transactional Durable Object storage is required");
    }
    this.guildId = assertSnowflake(guildId, "guildId");
    if (typeof namespace !== "string" || !/^[A-Za-z0-9_-]{1,48}$/.test(namespace)) {
      throw new TypeError("Engagement ledger namespace is invalid");
    }
    if (typeof now !== "function" || typeof timeZone !== "string" ||
        !Number.isSafeInteger(maxUsers) || maxUsers < 1 || maxUsers > 1_000_000) {
      throw new TypeError("Engagement ledger options are invalid");
    }
    this.storage = storage;
    this.key = STATE_KEY_PREFIX + namespace + ":" + guildId;
    this.now = now;
    this.timeZone = timeZone;
    this.maxUsers = maxUsers;
  }

  async initialize() {
    await this.storage.transaction(async (txn) => {
      const existing = await txn.get(this.key);
      if (existing === undefined) {
        await txn.put(this.key, freshState(this.guildId, this.now()));
        return;
      }
      this.validateState(existing);
    });
    return this.status();
  }

  validateState(state) {
    if (!state || state.version !== 1 || state.guildId !== this.guildId ||
        !state.users || typeof state.users !== "object" || Array.isArray(state.users) ||
        !state.seen || typeof state.seen !== "object" ||
        !state.hashes || typeof state.hashes !== "object" ||
        !state.lastCredit || typeof state.lastCredit !== "object" ||
        !state.dayChannels || typeof state.dayChannels !== "object") {
      throw new Error("engagement_ledger_integrity_failed");
    }
  }

  async award(message, { channelResolver } = {}) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new TypeError("Discord message payload is required");
    }
    if (typeof channelResolver !== "function") {
      throw new TypeError("A verified public-channel resolver is required");
    }

    const guildId = String(message.guild_id ?? "");
    const userId = String(message.author?.id ?? "");
    const messageId = String(message.id ?? "");
    const messageType = Number(message.type ?? 0);

    if (guildId !== this.guildId || !/^\d{15,22}$/.test(userId) ||
        !/^\d{15,22}$/.test(messageId) ||
        message.author?.bot === true || message.webhook_id ||
        ![0, 19].includes(messageType) || !meaningful(message.content)) {
      return { credited: false, reason: "message_not_eligible", receiptId: "skip:" + messageId };
    }

    const channel = await channelResolver(message);
    if (!channel || channel.eligible !== true ||
        String(channel.guildId) !== this.guildId ||
        !/^\d{15,22}$/.test(String(channel.baseChannelId || "")) ||
        channel.nsfw === true ||
        EXCLUDED_CHANNEL_NAMES.test(String(channel.nameContext || "")) ||
        channel.everyoneCanView !== true) {
      return { credited: false, reason: "channel_not_eligible", receiptId: "skip:" + messageId };
    }

    const now = messageTimestamp(message, this.now());
    if (!Number.isFinite(now) || now < 0) {
      return { credited: false, reason: "invalid_message_timestamp", receiptId: "skip:" + messageId };
    }
    const day = isoDay(now, this.timeZone);
    const month = day.slice(0, 7);
    const baseChannelId = String(channel.baseChannelId);
    const contentHash = await hashContent(message);
    const hasReply = Boolean(message.message_reference?.message_id);
    let result = null;

    await this.storage.transaction(async (txn) => {
      const current = (await txn.get(this.key)) ?? freshState(this.guildId, now);
      this.validateState(current);
      if (current.seen[messageId]) {
        result = { credited: false, reason: "duplicate_message", receiptId: "skip:" + messageId };
        return;
      }
      if (now - Number(current.lastCredit[userId] || 0) < 60_000) {
        result = { credited: false, reason: "user_cooldown", receiptId: "skip:" + messageId };
        return;
      }
      const repeatKey = userId + ":" + contentHash;
      if (now - Number(current.hashes[repeatKey] || 0) < 10 * 60_000) {
        result = { credited: false, reason: "repeat_content", receiptId: "skip:" + messageId };
        return;
      }
      if (!current.users[userId] && Object.keys(current.users).length >= this.maxUsers) {
        result = { credited: false, reason: "ledger_user_limit", receiptId: "skip:" + messageId };
        return;
      }

      const next = structuredClone(current);
      const user = next.users[userId] ?? memberState();
      const dailyChannels = next.dayChannels[userId]?.day === day
        ? next.dayChannels[userId].ids
        : [];
      const isReply = hasReply;
      const points = 5 + (dailyChannels.includes(baseChannelId) ? 0 : 3) + (isReply ? 2 : 0);

      user.xp += points;
      user.messages += 1;
      if (isReply) user.replies += 1;
      user.monthly[month] = Number(user.monthly[month] || 0) + points;
      user.daily[day] = Number(user.daily[day] || 0) + points;
      user.channels[baseChannelId] = Number(user.channels[baseChannelId] || 0) + 1;
      user.activeDays = [...new Set([...(user.activeDays || []), day])].sort().slice(-90);

      next.users[userId] = user;
      next.captureStartedAt ??= now;
      next.seen[messageId] = now;
      next.hashes[repeatKey] = now;
      next.lastCredit[userId] = now;
      next.dayChannels[userId] = {
        day,
        ids: [...new Set([...dailyChannels, baseChannelId])].slice(0, 50),
      };
      cleanup(next, now);
      await txn.put(this.key, next);

      result = {
        credited: true,
        points,
        userId,
        day,
        month,
        reply: isReply,
        receiptId: "xp:" + messageId + ":" + userId,
        storedContent: false,
      };
    });

    return result;
  }

  async snapshot(period = "month", now = this.now()) {
    const allowed = ["day", "week", "month", "year", "life"];
    if (!allowed.includes(period)) throw new TypeError("Unknown engagement XP period");
    const state = (await this.storage.get(this.key)) ?? freshState(this.guildId, now);
    this.validateState(state);

    const today = isoDay(now, this.timeZone);
    const monday = weekMonday(today);
    const month = today.slice(0, 7);
    const year = today.slice(0, 4);
    const rows = Object.entries(state.users).map(([id, user]) => {
      const monthlyEntries = Object.entries(user.monthly || {});
      const score = period === "day" ? Number(user.daily?.[today] || 0)
        : period === "week" ? Object.entries(user.daily || {}).reduce((sum, [day, value]) =>
          sum + (day >= monday && day <= today ? Number(value) : 0), 0)
        : period === "month" ? Number(user.monthly?.[month] || 0)
        : period === "year" ? monthlyEntries.reduce((sum, [key, value]) =>
          sum + (key.startsWith(year + "-") ? Number(value) : 0), 0)
        : Number(user.xp || 0);
      return { id, score, lifetime: Number(user.xp || 0) };
    }).sort((left, right) => right.score - left.score ||
      right.lifetime - left.lifetime || left.id.localeCompare(right.id));

    const scope = period === "day" ? today
      : period === "week" ? "Week of " + monday
      : period === "month" ? month
      : period === "year" ? year : "Recorded lifetime";
    const note = state.captureStartedAt
      ? "XP capture began " + isoDay(state.captureStartedAt, this.timeZone) +
        ". Prior unrecorded history is unavailable; all periods may be partial."
      : "No qualifying contribution has yet been recorded. Earlier history is unavailable.";

    return {
      period,
      rows,
      total: rows.reduce((sum, row) => sum + row.score, 0),
      scope,
      note,
      captureStartedAt: state.captureStartedAt,
    };
  }

  async insights() {
    const state = (await this.storage.get(this.key)) ?? freshState(this.guildId, this.now());
    this.validateState(state);
    const channels = new Map();
    let replies = 0;
    let messages = 0;
    let multiDayMembers = 0;
    for (const user of Object.values(state.users)) {
      replies += Number(user.replies || 0);
      messages += Number(user.messages || 0);
      if (new Set(user.activeDays || []).size > 1) multiDayMembers += 1;
      for (const [channelId, count] of Object.entries(user.channels || {})) {
        const entry = channels.get(channelId) ?? { messages: 0, members: 0 };
        entry.messages += Number(count || 0);
        entry.members += 1;
        channels.set(channelId, entry);
      }
    }
    return {
      users: Object.keys(state.users).length,
      messages,
      replies,
      multiDayMembers,
      topChannels: [...channels.entries()]
        .sort((left, right) => right[1].messages - left[1].messages)
        .slice(0, 5)
        .map(([channelId, totals]) => ({ channelId, ...totals })),
    };
  }

  async status() {
    const state = (await this.storage.get(this.key)) ?? freshState(this.guildId, this.now());
    this.validateState(state);
    return {
      ready: true,
      guildId: state.guildId,
      users: Object.keys(state.users).length,
      captureStartedAt: state.captureStartedAt,
      rawMessageContentStored: false,
    };
  }
}

export function createEngagementMessageHandler({ ledger, channelResolver } = {}) {
  if (!ledger || typeof ledger.award !== "function" || typeof channelResolver !== "function") {
    throw new TypeError("Engagement ledger and verified channel resolver are required");
  }
  return async (event, context) => {
    if (event?.eventType !== "MESSAGE_CREATE" || !event.payload) {
      throw new TypeError("Engagement handler accepts MESSAGE_CREATE events only");
    }
    const result = await ledger.award(event.payload, { channelResolver });
    return {
      committed: true,
      receiptId: result.receiptId || context?.idempotencyKey || event.eventKey,
      result,
    };
  };
}

export function isMeaningfulEngagementMessage(value) {
  return meaningful(value);
}

export function engagementChannelNameIsSensitive(value) {
  return EXCLUDED_CHANNEL_NAMES.test(String(value || ""));
}

export function engagementDayKey(timestamp, timeZone = "America/New_York") {
  return utcPartsToLocalDay(timestamp, timeZone);
}
