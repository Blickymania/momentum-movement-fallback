const DELIVERY_PREFIX = "gateway:delivery:";

function validateIdentifier(value, label, max = 96) {
  if (typeof value !== "string" || value.length < 1 || value.length > max ||
      !/^[A-Za-z0-9:_-]+$/.test(value)) {
    throw new TypeError(label + " must be a safe identifier");
  }
  return value;
}

function deliveryKey(namespace, eventKey, handlerId) {
  return DELIVERY_PREFIX + namespace + ":" +
    encodeURIComponent(eventKey) + ":" + encodeURIComponent(handlerId);
}

function safeError(error) {
  const name = typeof error?.name === "string" ? error.name : "HandlerError";
  const message = typeof error?.code === "string"
    ? error.code
    : typeof error?.message === "string" ? error.message : "handler_failed";
  return {
    name: name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50) || "HandlerError",
    message: message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160),
  };
}

function equalLease(left, right) {
  return typeof left === "string" && typeof right === "string" &&
    left.length === right.length &&
    left.split("").reduce((difference, char, index) =>
      difference | (char.charCodeAt(0) ^ right.charCodeAt(index)), 0) === 0;
}

/**
 * Durable per-handler delivery checkpoints for an at-least-once Gateway inbox.
 *
 * Each handler has its own lease, attempt counter and durable receipt. The
 * original inbox event is acknowledged only after all selected handlers have
 * committed. A handler must accept the supplied idempotencyKey and return a
 * durable receipt; a crash between the side effect and ledger completion will
 * otherwise cause a retry.
 */
export class DurableGatewayDeliveryLedger {
  constructor(storage, {
    namespace = "default",
    now = () => Date.now(),
    makeLeaseId = () => globalThis.crypto.randomUUID(),
  } = {}) {
    if (!storage || typeof storage.get !== "function" ||
        typeof storage.put !== "function" || typeof storage.transaction !== "function") {
      throw new TypeError("Transactional Durable Object storage is required");
    }
    if (typeof namespace !== "string" || !/^[A-Za-z0-9_-]{1,48}$/.test(namespace)) {
      throw new TypeError("Delivery ledger namespace must be a safe identifier");
    }
    if (typeof now !== "function" || typeof makeLeaseId !== "function") {
      throw new TypeError("Delivery ledger clock and lease factory are required");
    }
    this.storage = storage;
    this.namespace = namespace;
    this.now = now;
    this.makeLeaseId = makeLeaseId;
  }

  async get(eventKey, handlerId) {
    validateIdentifier(eventKey, "eventKey", 512);
    validateIdentifier(handlerId, "handlerId", 96);
    return (await this.storage.get(deliveryKey(this.namespace, eventKey, handlerId))) ?? null;
  }

  async claim(eventKey, handlerId, {
    leaseMs = 30_000,
    maxAttempts = 8,
    idempotencyKey = eventKey + ":" + handlerId,
  } = {}) {
    validateIdentifier(eventKey, "eventKey", 512);
    validateIdentifier(handlerId, "handlerId", 96);
    validateIdentifier(idempotencyKey, "idempotencyKey", 640);
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) {
      throw new RangeError("Delivery lease must be between 1 second and 5 minutes");
    }
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
      throw new RangeError("Maximum attempts must be between 1 and 100");
    }
    const key = deliveryKey(this.namespace, eventKey, handlerId);
    return this.storage.transaction(async (txn) => {
      const current = await txn.get(key);
      if (current?.status === "completed") {
        return { claimed: false, completed: true, record: current };
      }
      if (current?.status === "dead_letter") {
        return { claimed: false, deadLetter: true, record: current };
      }
      const now = this.now();
      if (current?.status === "processing" && current.leaseExpiresAt > now) {
        return { claimed: false, busy: true, retryAt: current.leaseExpiresAt, record: current };
      }
      if (current?.status === "retry_wait" && current.retryAt > now) {
        return { claimed: false, busy: true, retryAt: current.retryAt, record: current };
      }
      const attempts = Number(current?.attempts || 0) + 1;
      if (attempts > maxAttempts) {
        const deadLetter = {
          ...(current ?? {}),
          eventKey,
          handlerId,
          idempotencyKey,
          status: "dead_letter",
          attempts: attempts - 1,
          deadLetterAt: now,
          updatedAt: now,
        };
        await txn.put(key, deadLetter);
        return { claimed: false, deadLetter: true, record: deadLetter };
      }
      const leaseId = this.makeLeaseId();
      if (typeof leaseId !== "string" || leaseId.length < 16 || leaseId.length > 128) {
        throw new TypeError("Lease factory must return a unique opaque token");
      }
      const record = {
        eventKey,
        handlerId,
        idempotencyKey,
        status: "processing",
        attempts,
        leaseId,
        leaseExpiresAt: now + leaseMs,
        retryAt: null,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        lastError: current?.lastError ?? null,
        receiptId: null,
        completedAt: null,
      };
      await txn.put(key, record);
      return { claimed: true, claim: { eventKey, handlerId, idempotencyKey, leaseId, attempts }, record };
    });
  }

  async complete(claim, receiptId) {
    if (!claim || typeof claim !== "object") throw new TypeError("A delivery claim is required");
    validateIdentifier(claim.eventKey, "eventKey", 512);
    validateIdentifier(claim.handlerId, "handlerId", 96);
    validateIdentifier(receiptId, "receiptId", 200);
    const key = deliveryKey(this.namespace, claim.eventKey, claim.handlerId);
    return this.storage.transaction(async (txn) => {
      const current = await txn.get(key);
      if (!current || current.status !== "processing" ||
          !equalLease(current.leaseId, claim.leaseId) ||
          current.leaseExpiresAt <= this.now()) return false;
      const completed = {
        ...current,
        status: "completed",
        receiptId,
        completedAt: this.now(),
        updatedAt: this.now(),
        leaseId: null,
        leaseExpiresAt: null,
        retryAt: null,
        lastError: null,
      };
      await txn.put(key, completed);
      return true;
    });
  }

  async retry(claim, error, {
    maxAttempts = 8,
    baseDelayMs = 1_000,
    maxDelayMs = 60_000,
    random = Math.random,
  } = {}) {
    if (!claim || typeof claim !== "object") throw new TypeError("A delivery claim is required");
    validateIdentifier(claim.eventKey, "eventKey", 512);
    validateIdentifier(claim.handlerId, "handlerId", 96);
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100 ||
        !Number.isFinite(baseDelayMs) || baseDelayMs < 100 ||
        !Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs ||
        typeof random !== "function") {
      throw new RangeError("Delivery retry policy is invalid");
    }
    const key = deliveryKey(this.namespace, claim.eventKey, claim.handlerId);
    return this.storage.transaction(async (txn) => {
      const current = await txn.get(key);
      if (!current || current.status !== "processing" ||
          !equalLease(current.leaseId, claim.leaseId)) return { updated: false };
      const now = this.now();
      const errorInfo = safeError(error);
      const terminal = current.attempts >= maxAttempts;
      const ceiling = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(current.attempts - 1, 30)));
      const retryAt = now + Math.floor(ceiling * (0.5 + random() * 0.5));
      const updated = {
        ...current,
        status: terminal ? "dead_letter" : "retry_wait",
        leaseId: null,
        leaseExpiresAt: null,
        retryAt: terminal ? null : retryAt,
        deadLetterAt: terminal ? now : null,
        lastError: errorInfo,
        updatedAt: now,
      };
      await txn.put(key, updated);
      return { updated: true, deadLetter: terminal, retryAt: updated.retryAt, record: updated };
    });
  }

  async getDisposition(eventKey) {
    validateIdentifier(eventKey, "eventKey", 512);
    return (await this.storage.get(deliveryKey(this.namespace, eventKey, "$route"))) ?? null;
  }

  async recordDisposition(eventKey, disposition, detail = {}) {
    validateIdentifier(eventKey, "eventKey", 512);
    if (!["ignored","quarantined"].includes(disposition)) {
      throw new TypeError("Event disposition must be ignored or quarantined");
    }
    const handlerId = "$route";
    const key = deliveryKey(this.namespace, eventKey, handlerId);
    return this.storage.transaction(async (txn) => {
      const current = await txn.get(key);
      if (current?.status === "completed" || current?.status === "quarantined") return current;
      const record = {
        eventKey,
        handlerId,
        status: disposition === "ignored" ? "completed" : "quarantined",
        disposition,
        reason: typeof detail.reason === "string" ? detail.reason.slice(0, 160) : null,
        routeKey: typeof detail.routeKey === "string" ? detail.routeKey.slice(0, 80) : null,
        createdAt: current?.createdAt ?? this.now(),
        updatedAt: this.now(),
      };
      await txn.put(key, record);
      return record;
    });
  }

  async summarize(eventKey, handlerIds) {
    if (!Array.isArray(handlerIds) || handlerIds.length > 32) {
      throw new TypeError("Handler ID list must contain at most 32 entries");
    }
    const records = await Promise.all(handlerIds.map((id) => this.get(eventKey, id)));
    return {
      complete: records.every((record) => record?.status === "completed"),
      deadLetter: records.some((record) => record?.status === "dead_letter"),
      pending: records.filter((record) => !record || !["completed","dead_letter"].includes(record.status)).length,
      records,
    };
  }
}

export class GatewayEventDispatcher {
  constructor({
    inbox,
    registry,
    ledger,
    handlers,
    now = () => Date.now(),
    leaseMs = 30_000,
    maxAttempts = 8,
    random = Math.random,
    log = () => {},
  } = {}) {
    if (!inbox || typeof inbox.listPending !== "function" || typeof inbox.acknowledge !== "function") {
      throw new TypeError("A DurableGatewayInbox is required");
    }
    if (!registry || typeof registry.route !== "function") {
      throw new TypeError("A Gateway handler registry is required");
    }
    if (!ledger || typeof ledger.claim !== "function" || typeof ledger.complete !== "function" ||
        typeof ledger.retry !== "function" || typeof ledger.recordDisposition !== "function") {
      throw new TypeError("A durable delivery ledger is required");
    }
    if (!handlers || typeof handlers !== "object" || Array.isArray(handlers) ||
        typeof now !== "function" || typeof random !== "function" || typeof log !== "function") {
      throw new TypeError("Gateway handler adapters and dispatcher dependencies are required");
    }
    this.inbox = inbox;
    this.registry = registry;
    this.ledger = ledger;
    this.handlers = handlers;
    this.now = now;
    this.leaseMs = leaseMs;
    this.maxAttempts = maxAttempts;
    this.random = random;
    this.log = log;
    this.running = false;
  }

  async drain({ limit = 25 } = {}) {
    if (this.running) return { status: "busy", processed: 0, acknowledged: 0 };
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("Dispatch batch must be between 1 and 100 events");
    }
    this.running = true;
    const summary = { status: "ok", processed: 0, acknowledged: 0, ignored: 0, quarantined: 0, retried: 0, blocked: 0, retryAt: null };
    try {
      const events = await this.inbox.listPending(limit);
      for (const event of events) {
        if (event.eventType === "INTERACTION_CREATE" &&
            event.interactionAckState !== "acknowledged") {
          if (event.interactionAckState === "failed") {
            await this.ledger.recordDisposition(event.eventKey, "quarantined", {
              status: "blocked",
              reason: "interaction_callback_failed",
            });
            const ack = await this.inbox.acknowledge([event.eventKey]);
            summary.acknowledged += ack.acknowledged;
            summary.quarantined += 1;
            summary.processed += 1;
            continue;
          }
          summary.blocked += 1;
          summary.status = "awaiting_interaction_ack";
          break;
        }
        const route = event.dispatchRoute ?? this.registry.route(event);
        if (route.status === "ignored") {
          await this.ledger.recordDisposition(event.eventKey, "ignored", route);
          const ack = await this.inbox.acknowledge([event.eventKey]);
          summary.acknowledged += ack.acknowledged;
          summary.ignored += 1;
          summary.processed += 1;
          continue;
        }
        if (route.status === "unhandled") {
          await this.ledger.recordDisposition(event.eventKey, "quarantined", route);
          summary.quarantined += 1;
          summary.blocked += 1;
          summary.status = "blocked";
          break;
        }
        if (route.status !== "routed") {
          summary.blocked += 1;
          summary.status = "blocked";
          break;
        }

        let eventComplete = true;
        for (const handlerId of route.handlers) {
          const handler = this.handlers[handlerId];
          if (typeof handler !== "function") {
            summary.blocked += 1;
            summary.status = "blocked";
            eventComplete = false;
            break;
          }
          const idempotencyKey = event.eventKey + ":" + handlerId;
          const acquired = await this.ledger.claim(event.eventKey, handlerId, {
            leaseMs: this.leaseMs,
            maxAttempts: this.maxAttempts,
            idempotencyKey,
          });
          if (acquired.completed) continue;
          if (acquired.deadLetter) {
            summary.blocked += 1;
            summary.status = "blocked";
            eventComplete = false;
            break;
          }
          if (!acquired.claimed) {
            summary.blocked += 1;
            summary.status = "blocked";
            eventComplete = false;
            break;
          }
          try {
            const result = await handler(event, Object.freeze({
              handlerId,
              idempotencyKey,
              attempt: acquired.claim.attempts,
              guildId: event.guildId,
              sessionId: event.sessionId,
              sequence: event.sequence,
              eventKey: event.eventKey,
              receivedAt: event.receivedAt,
            }));
            if (!result || result.committed !== true || typeof result.receiptId !== "string" ||
                result.receiptId.length < 1 || result.receiptId.length > 200) {
              throw new Error("handler_did_not_return_durable_receipt");
            }
            if (!await this.ledger.complete(acquired.claim, result.receiptId)) {
              throw new Error("delivery_lease_expired_before_commit");
            }
          } catch (error) {
            const retry = await this.ledger.retry(acquired.claim, error, {
              maxAttempts: this.maxAttempts,
              random: this.random,
            });
            summary.retried += 1;
            summary.blocked += 1;
            summary.status = retry.deadLetter ? "dead_letter" : "retry_wait";
            summary.retryAt = retry.deadLetter ? null : retry.retryAt;
            eventComplete = false;
            break;
          }
        }
        if (!eventComplete) break;
        await this.inbox.acknowledge([event.eventKey]);
        summary.acknowledged += 1;
        summary.processed += 1;
      }
      this.log("gateway_dispatch_batch", summary);
      return summary;
    } finally {
      this.running = false;
    }
  }
}
