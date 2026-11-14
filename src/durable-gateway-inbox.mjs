import { gatewayEventKey } from "./gateway-protocol.mjs";

const STATE_KEY = "gateway:state";
const META_KEY = "gateway:inbox:meta";
const EVENT_PREFIX = "gateway:inbox:event:";

function namespaceKeys(namespace = "") {
  if (namespace === "") {
    return { stateKey: STATE_KEY, metaKey: META_KEY, eventPrefix: EVENT_PREFIX };
  }
  if (typeof namespace !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(namespace)) {
    throw new TypeError("Gateway inbox namespace must be a safe 1-64 character identifier");
  }
  const prefix = "gateway:" + namespace + ":";
  return {
    stateKey: prefix + "state",
    metaKey: prefix + "inbox:meta",
    eventPrefix: prefix + "inbox:event:",
  };
}

export class InboxFullError extends Error {
  constructor(message = "Gateway event inbox is full; the Gateway must pause until queued events are delivered") {
    super(message);
    this.name = "InboxFullError";
  }
}

export class InboxIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "InboxIntegrityError";
  }
}

function eventStorageKey(prefix, eventKey) {
  return prefix + encodeURIComponent(eventKey);
}

function jsonSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validateEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Gateway event must be an object");
  }
  const { guildId, sessionId, sequence, eventType, payload } = input;
  const key = gatewayEventKey(guildId, sessionId, sequence, eventType);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Gateway event payload must be an object");
  }
  return { key, guildId, sessionId, sequence, eventType, payload };
}

/**
 * Durable, bounded, at-least-once inbox for one Gateway session.
 *
 * The storage argument is Durable Object Storage (SQLite-backed namespace),
 * using transactional key/value methods. A dispatch sequence is committed
 * in the same transaction as the inbox item; if the transaction fails, the
 * caller must close the Gateway so Discord can replay the uncommitted event.
 */
export class DurableGatewayInbox {
  constructor(storage, options = {}) {
    if (!storage || typeof storage.transaction !== "function" ||
        typeof storage.get !== "function" || typeof storage.list !== "function") {
      throw new TypeError("SQLite-backed Durable Object storage is required");
    }
    this.storage = storage;
    Object.assign(this, namespaceKeys(options.namespace ?? ""));
    this.maxPendingEvents = options.maxPendingEvents ?? 2000;
    this.maxPendingBytes = options.maxPendingBytes ?? 4 * 1024 * 1024;
    this.maxEventBytes = options.maxEventBytes ?? 256 * 1024;

    for (const [name, value] of [
      ["maxPendingEvents", this.maxPendingEvents],
      ["maxPendingBytes", this.maxPendingBytes],
      ["maxEventBytes", this.maxEventBytes],
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(name + " must be a positive safe integer");
      }
    }
    if (this.maxEventBytes > this.maxPendingBytes) {
      throw new RangeError("maxEventBytes cannot exceed maxPendingBytes");
    }
  }

  async initialize() {
    await this.storage.transaction(async (txn) => {
      const meta = await txn.get(this.metaKey);
      if (meta === undefined) {
        await txn.put(this.metaKey, { pendingEvents: 0, pendingBytes: 0, nextOrder: 0, updatedAt: Date.now() });
      }
      const state = await txn.get(this.stateKey);
      if (state === undefined) {
        await txn.put(this.stateKey, {
          sessionId: null,
          sequence: null,
          resumeGatewayUrl: null,
          updatedAt: Date.now(),
        });
      }
    });
  }

  async getState() {
    return (await this.storage.get(this.stateKey)) ?? {
      sessionId: null,
      sequence: null,
      resumeGatewayUrl: null,
      updatedAt: null,
    };
  }

  async saveReadySession(session) {
    if (!session || typeof session.sessionId !== "string" || !session.sessionId ||
        typeof session.resumeGatewayUrl !== "string" ||
        !session.resumeGatewayUrl.startsWith("wss://") ||
        !Number.isSafeInteger(session.sequence) || session.sequence < 0) {
      throw new TypeError("READY session state is invalid");
    }

    await this.storage.transaction(async (txn) => {
      const current = await txn.get(this.stateKey);
      const next = {
        sessionId: session.sessionId,
        sequence: session.sequence,
        resumeGatewayUrl: session.resumeGatewayUrl,
        updatedAt: Date.now(),
      };
      await txn.put(this.stateKey, next);
    });
    return this.getState();
  }

  async clearSession() {
    await this.storage.transaction(async (txn) => {
      const state = await txn.get(this.stateKey);
      await txn.put(this.stateKey, {
        ...(state ?? {}),
        sessionId: null,
        sequence: null,
        resumeGatewayUrl: null,
        updatedAt: Date.now(),
      });
    });
    return this.getState();
  }

  async enqueueDispatch(input) {
    const event = validateEvent(input);
    const bytes = jsonSize(event);
    if (bytes > this.maxEventBytes) {
      throw new InboxFullError("Gateway event exceeds the configured per-event inbox limit");
    }

    const key = eventStorageKey(this.eventPrefix, event.key);
    return this.storage.transaction(async (txn) => {
      const state = await txn.get(this.stateKey);
      if (!state || state.sessionId !== event.sessionId ||
          !Number.isSafeInteger(state.sequence)) {
        throw new InboxIntegrityError("Gateway READY session must be stored before dispatch events");
      }

      // Gateway sequence increases per dispatch. The same sequence or an older
      // sequence in the active session is a replay and must not be re-enqueued.
      if (event.sequence <= state.sequence) {
        return { accepted: false, duplicate: true, eventKey: event.key };
      }

      const existing = await txn.get(key);
      if (existing !== undefined) {
        return { accepted: false, duplicate: true, eventKey: event.key };
      }

      const meta = (await txn.get(this.metaKey)) ?? { pendingEvents: 0, pendingBytes: 0 };
      if (meta.pendingEvents + 1 > this.maxPendingEvents ||
          meta.pendingBytes + bytes > this.maxPendingBytes) {
        throw new InboxFullError();
      }

      const nextOrder = (Number.isSafeInteger(meta.nextOrder) ? meta.nextOrder : 0) + 1;
      if (!Number.isSafeInteger(nextOrder)) {
        throw new InboxFullError("Gateway inbox ordering counter is exhausted");
      }
      const record = {
        eventKey: event.key,
        guildId: event.guildId,
        sessionId: event.sessionId,
        sequence: event.sequence,
        eventType: event.eventType,
        payload: event.payload,
        payloadBytes: bytes,
        queueOrder: nextOrder,
        receivedAt: Date.now(),
      };

      await txn.put(key, record);
      await txn.put(this.stateKey, {
        ...state,
        sequence: event.sequence,
        updatedAt: Date.now(),
      });
      await txn.put(this.metaKey, {
        pendingEvents: meta.pendingEvents + 1,
        pendingBytes: meta.pendingBytes + bytes,
        nextOrder,
        updatedAt: Date.now(),
      });
      return { accepted: true, duplicate: false, eventKey: event.key, pendingEvents: meta.pendingEvents + 1 };
    });
  }

  async listPending(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("Pending event limit must be between 1 and 500");
    }
    // Durable Object Storage returns keys in key order, not value/arrival order.
    // Read the full bounded inbox (in pages of at most 1,000), then sort by a
    // transactionally assigned order counter before returning the requested page.
    const pending = [];
    let startAfter;
    while (pending.length < this.maxPendingEvents) {
      const pageLimit = Math.min(1000, this.maxPendingEvents - pending.length);
      const options = { prefix: this.eventPrefix, limit: pageLimit };
      if (startAfter !== undefined) options.startAfter = startAfter;
      const page = await this.storage.list(options);
      const entries = [...page.entries()];
      if (entries.length === 0) break;
      pending.push(...entries.map(([, value]) => value));
      if (entries.length < pageLimit) break;
      const nextCursor = entries[entries.length - 1][0];
      if (nextCursor === startAfter) {
        throw new InboxIntegrityError("Gateway inbox pagination did not advance");
      }
      startAfter = nextCursor;
    }
    return pending.sort((a, b) =>
      (a.queueOrder ?? Number.MAX_SAFE_INTEGER) - (b.queueOrder ?? Number.MAX_SAFE_INTEGER) ||
      a.receivedAt - b.receivedAt || a.sequence - b.sequence
    ).slice(0, limit);
  }

  async acknowledge(eventKeys) {
    if (!Array.isArray(eventKeys) || eventKeys.length < 1 ||
        eventKeys.length > 100 ||
        eventKeys.some((key) => typeof key !== "string" || key.length === 0)) {
      throw new TypeError("Provide between 1 and 100 non-empty event keys");
    }

    return this.storage.transaction(async (txn) => {
      const meta = (await txn.get(this.metaKey)) ?? { pendingEvents: 0, pendingBytes: 0 };
      let acknowledged = 0;
      let releasedBytes = 0;
      for (const eventKey of [...new Set(eventKeys)]) {
        const key = eventStorageKey(this.eventPrefix, eventKey);
        const record = await txn.get(key);
        if (record === undefined) continue;
        await txn.delete(key);
        acknowledged += 1;
        releasedBytes += record.payloadBytes;
      }
      await txn.put(this.metaKey, {
        pendingEvents: Math.max(0, meta.pendingEvents - acknowledged),
        pendingBytes: Math.max(0, meta.pendingBytes - releasedBytes),
        updatedAt: Date.now(),
      });
      return {
        acknowledged,
        pendingEvents: Math.max(0, meta.pendingEvents - acknowledged),
        pendingBytes: Math.max(0, meta.pendingBytes - releasedBytes),
      };
    });
  }

  async getMetrics() {
    const [meta, state] = await Promise.all([
      this.storage.get(this.metaKey),
      this.getState(),
    ]);
    return {
      pendingEvents: meta?.pendingEvents ?? 0,
      pendingBytes: meta?.pendingBytes ?? 0,
      sessionStored: Boolean(state.sessionId),
      lastSequence: state.sequence,
      updatedAt: meta?.updatedAt ?? null,
    };
  }
}
