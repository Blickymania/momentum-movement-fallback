const DEFAULT_KEY = "bot005:confirmation-plans:v1";
const DEFAULT_MAX_PLANS = 64;
const DEFAULT_MAX_TTL_MS = 120_000;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}
function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}
function safePayload(value, depth = 0) {
  if (depth > 6) return false;
  if (value === null || typeof value === "string" ||
      typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return true;
  if (Array.isArray(value)) return value.length <= 64 && value.every((item) => safePayload(item, depth + 1));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).length <= 64 && Object.entries(value).every(([key, item]) =>
    !/(token|secret|authorization|credential)/i.test(key) &&
    key.length <= 80 && safePayload(item, depth + 1));
}
function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
function defaultState() { return { plans: [] }; }
function validState(state) {
  return state && typeof state === "object" && !Array.isArray(state) &&
    Array.isArray(state.plans) && state.plans.length <= DEFAULT_MAX_PLANS &&
    state.plans.every((plan) => plan && typeof plan === "object" &&
      validId(plan.id) && typeof plan.kind === "string" &&
      validSnowflake(plan.actorId) && validSnowflake(plan.guildId) &&
      validSnowflake(plan.channelId) &&
      (plan.messageId === null || validSnowflake(plan.messageId)) &&
      Number.isSafeInteger(plan.expiresAt) && Number.isSafeInteger(plan.createdAt) &&
      Number.isSafeInteger(plan.updatedAt) &&
      ["pending", "executing", "completed", "cancelled", "expired", "failed", "unknown"].includes(plan.state) &&
      safePayload(plan.payload));
}
function finalState(state) {
  return ["completed", "cancelled", "expired", "failed", "unknown"].includes(state);
}
function sameActor(plan, actor) {
  return plan.actorId === actor.actorId && plan.guildId === actor.guildId &&
    plan.channelId === actor.channelId && plan.messageId === actor.messageId;
}

/**
 * Durable, single-use confirmation ledger for owner-approved Discord mutations.
 * Interaction tokens are deliberately excluded; only bounded action metadata is stored.
 */
export class DurableBot005ConfirmationStore {
  constructor(storage, {
    key = DEFAULT_KEY,
    maxPlans = DEFAULT_MAX_PLANS,
    maxTtlMs = DEFAULT_MAX_TTL_MS,
    retentionMs = DEFAULT_RETENTION_MS,
    now = Date.now,
  } = {}) {
    if (!storage || typeof storage.transaction !== "function" || typeof storage.get !== "function") {
      throw new TypeError("Durable confirmation storage is required");
    }
    if (typeof key !== "string" || !/^[A-Za-z0-9:_-]{1,120}$/.test(key) ||
        !Number.isSafeInteger(maxPlans) || maxPlans < 1 || maxPlans > DEFAULT_MAX_PLANS ||
        !Number.isSafeInteger(maxTtlMs) || maxTtlMs < 1_000 || maxTtlMs > DEFAULT_MAX_TTL_MS ||
        !Number.isSafeInteger(retentionMs) || retentionMs < maxTtlMs || retentionMs > 7 * 24 * 60 * 60 * 1000 ||
        typeof now !== "function") {
      throw new TypeError("Durable confirmation store configuration is invalid");
    }
    this.storage = storage;
    this.key = key;
    this.maxPlans = maxPlans;
    this.maxTtlMs = maxTtlMs;
    this.retentionMs = retentionMs;
    this.now = now;
  }

  async mutate(callback) {
    return this.storage.transaction(async (txn) => {
      const state = await txn.get(this.key);
      if (state !== undefined && !validState(state)) {
        throw new Error("bot005_confirmation_store_corrupt");
      }
      const current = state === undefined ? defaultState() : clone(state);
      const now = this.now();
      current.plans = current.plans.filter((plan) =>
        !(finalState(plan.state) && plan.updatedAt + this.retentionMs <= now));
      const result = await callback(current, now);
      if (!validState(current)) throw new Error("bot005_confirmation_store_invalid_transition");
      await txn.put(this.key, current);
      return clone(result);
    });
  }

  async create({ id, kind, actorId, guildId, channelId, expiresAt, payload } = {}) {
    const now = this.now();
    if (!validId(id) || typeof kind !== "string" || !/^[a-z][a-z0-9_-]{1,47}$/.test(kind) ||
        !validSnowflake(actorId) || !validSnowflake(guildId) || !validSnowflake(channelId) ||
        !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + this.maxTtlMs ||
        !payload || typeof payload !== "object" || Array.isArray(payload) || !safePayload(payload) ||
        new TextEncoder().encode(JSON.stringify(payload)).byteLength > 4096) {
      throw new TypeError("Confirmation plan is invalid or exceeds its safety limits");
    }
    return this.mutate((state) => {
      if (state.plans.some((plan) => plan.id === id)) return { status: "duplicate" };
      if (state.plans.length >= this.maxPlans) return { status: "capacity" };
      const plan = {
        id, kind, actorId, guildId, channelId, messageId: null,
        expiresAt, createdAt: now, updatedAt: now, state: "pending",
        payload: clone(payload),
      };
      state.plans.push(plan);
      return { status: "created", plan };
    });
  }

  async bindMessage(id, messageId) {
    if (!validId(id) || !validSnowflake(messageId)) throw new TypeError("Confirmation message binding is invalid");
    return this.mutate((state, now) => {
      const plan = state.plans.find((item) => item.id === id);
      if (!plan) return { status: "not_found" };
      if (plan.state !== "pending") return { status: plan.state };
      if (plan.expiresAt <= now) {
        plan.state = "expired";
        plan.updatedAt = now;
        return { status: "expired" };
      }
      if (plan.messageId !== null) return { status: plan.messageId === messageId ? "bound" : "binding_conflict" };
      plan.messageId = messageId;
      plan.updatedAt = now;
      return { status: "bound" };
    });
  }

  async claim(id, actor) {
    if (!validId(id) || !actor || !validSnowflake(actor.actorId) ||
        !validSnowflake(actor.guildId) || !validSnowflake(actor.channelId) ||
        !validSnowflake(actor.messageId)) return { status: "invalid_actor" };
    return this.mutate((state, now) => {
      const plan = state.plans.find((item) => item.id === id);
      if (!plan) return { status: "not_found" };
      if (plan.actorId !== actor.actorId || plan.guildId !== actor.guildId ||
          plan.channelId !== actor.channelId) return { status: "binding_mismatch" };
      if (plan.state !== "pending") return { status: plan.state };
      if (plan.messageId === null) return { status: "not_bound" };
      if (plan.messageId !== actor.messageId) return { status: "binding_mismatch" };
      if (plan.expiresAt <= now) {
        plan.state = "expired";
        plan.updatedAt = now;
        return { status: "expired" };
      }
      plan.state = "executing";
      plan.updatedAt = now;
      return { status: "claimed", plan };
    });
  }

  async cancel(id, actor) {
    if (!validId(id) || !actor || !validSnowflake(actor.actorId) ||
        !validSnowflake(actor.guildId) || !validSnowflake(actor.channelId) ||
        !validSnowflake(actor.messageId)) return { status: "invalid_actor" };
    return this.mutate((state, now) => {
      const plan = state.plans.find((item) => item.id === id);
      if (!plan) return { status: "not_found" };
      if (!sameActor(plan, actor)) return { status: "binding_mismatch" };
      if (plan.state !== "pending") return { status: plan.state };
      if (plan.expiresAt <= now) {
        plan.state = "expired";
        plan.updatedAt = now;
        return { status: "expired" };
      }
      plan.state = "cancelled";
      plan.updatedAt = now;
      return { status: "cancelled" };
    });
  }

  async finish(id, result) {
    const allowed = new Set(["completed", "failed", "unknown"]);
    if (!validId(id) || !result || !allowed.has(result.state) ||
        (result.code !== undefined && (typeof result.code !== "string" || !/^[a-z0-9_-]{1,64}$/.test(result.code)))) {
      throw new TypeError("Confirmation result is invalid");
    }
    return this.mutate((state, now) => {
      const plan = state.plans.find((item) => item.id === id);
      if (!plan) return { status: "not_found" };
      if (plan.state !== "executing") return { status: plan.state };
      plan.state = result.state;
      plan.resultCode = result.code ?? null;
      plan.updatedAt = now;
      return { status: result.state };
    });
  }

  async get(id) {
    if (!validId(id)) return null;
    const state = await this.storage.get(this.key);
    if (state === undefined) return null;
    if (!validState(state)) throw new Error("bot005_confirmation_store_corrupt");
    const plan = state.plans.find((item) => item.id === id);
    return plan ? clone(plan) : null;
  }
}
