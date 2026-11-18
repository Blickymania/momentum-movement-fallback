import test from "node:test";
import assert from "node:assert/strict";
import { DurableGatewayDeliveryLedger, GatewayEventDispatcher } from "../src/durable-gateway-dispatcher.mjs";

class MemoryStorage {
  constructor() { this.values = new Map(); this.pending = Promise.resolve(); }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async transaction(callback) {
    const execute = async () => {
      const snapshot = new Map([...this.values.entries()].map(([key, value]) => [key, structuredClone(value)]));
      const txn = {
        get: async (key) => structuredClone(snapshot.get(key)),
        put: async (key, value) => snapshot.set(key, structuredClone(value)),
        delete: async (key) => snapshot.delete(key),
      };
      const result = await callback(txn);
      this.values = snapshot;
      return result;
    };
    const promise = this.pending.then(execute, execute);
    this.pending = promise.catch(() => {});
    return promise;
  }
}

class FakeInbox {
  constructor(events) {
    this.events = structuredClone(events);
    this.acks = [];
  }
  async listPending(limit = 25) { return structuredClone(this.events.slice(0, limit)); }
  async acknowledge(keys) {
    const unique = [...new Set(keys)];
    let acknowledged = 0;
    for (const key of unique) {
      const index = this.events.findIndex((event) => event.eventKey === key);
      if (index >= 0) { this.events.splice(index, 1); acknowledged += 1; this.acks.push(key); }
    }
    return { acknowledged, pendingEvents: this.events.length };
  }
}

let clock = 1_800_000_000_000;
function makeLedger(options = {}) {
  const storage = new MemoryStorage();
  let lease = 0;
  const ledger = new DurableGatewayDeliveryLedger(storage, {
    namespace: "test-dispatch",
    now: () => clock,
    makeLeaseId: () => "test-lease-token-" + (++lease).toString().padStart(4, "0"),
    ...options,
  });
  return { storage, ledger };
}

function gatewayEvent(sequence, eventType = "INTERACTION_CREATE", payload = {}) {
  return {
    eventKey: "1565048205970767992:session-a:" + sequence + ":" + eventType,
    guildId: "1565048205970767992",
    sessionId: "session-a",
    sequence,
    eventType,
    payload,
    interactionAckState: eventType === "INTERACTION_CREATE" ? "acknowledged" : null,
    payloadBytes: 64,
    queueOrder: sequence,
    receivedAt: clock,
  };
}

function makeDispatcher({ inbox, ledger, registry, handlers, options = {} }) {
  return new GatewayEventDispatcher({
    inbox, ledger, registry, handlers, now: () => clock,
    random: () => 0,
    log: () => {},
    ...options,
  });
}

test("claims are serialized and only one concurrent dispatcher receives the lease", async () => {
  clock = 1_800_000_000_000;
  const { ledger } = makeLedger();
  const results = await Promise.all([
    ledger.claim("event-1", "handler-a", { leaseMs: 5000 }),
    ledger.claim("event-1", "handler-a", { leaseMs: 5000 }),
  ]);
  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.equal(results.filter((result) => result.busy).length, 1);
});

test("expired leases can be reclaimed and stale claimants cannot complete delivery", async () => {
  clock = 1_800_000_000_000;
  const { ledger } = makeLedger();
  const first = await ledger.claim("event-2", "handler-a", { leaseMs: 1000 });
  assert.equal(first.claimed, true);
  const busy = await ledger.claim("event-2", "handler-a", { leaseMs: 1000 });
  assert.equal(busy.busy, true);

  clock += 1001;
  const second = await ledger.claim("event-2", "handler-a", { leaseMs: 1000 });
  assert.equal(second.claimed, true);
  assert.equal(second.claim.attempts, 2);
  assert.equal(await ledger.complete(first.claim, "stale-receipt"), false);
  assert.equal(await ledger.complete(second.claim, "receipt-2"), true);
  assert.equal((await ledger.get("event-2", "handler-a")).receiptId, "receipt-2");
});

test("retry uses bounded backoff and permanently marks a repeatedly failing handler", async () => {
  clock = 1_800_000_000_000;
  const { ledger } = makeLedger();
  const first = await ledger.claim("event-3", "handler-a", { leaseMs: 1000, maxAttempts: 2 });
  const retry1 = await ledger.retry(first.claim, new Error("transient"), {
    maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 5000, random: () => 0,
  });
  assert.equal(retry1.deadLetter, false);
  assert.equal(retry1.retryAt, clock + 500);

  const tooEarly = await ledger.claim("event-3", "handler-a", { leaseMs: 1000, maxAttempts: 2 });
  assert.equal(tooEarly.busy, true);
  clock += 501;
  const second = await ledger.claim("event-3", "handler-a", { leaseMs: 1000, maxAttempts: 2 });
  assert.equal(second.claim.attempts, 2);

  const retry2 = await ledger.retry(second.claim, { code: "still_failing" }, {
    maxAttempts: 2, random: () => 0,
  });
  assert.equal(retry2.deadLetter, true);
  assert.equal((await ledger.claim("event-3", "handler-a")).deadLetter, true);
});

test("ledger summarizes completion state across all selected handlers", async () => {
  clock = 1_800_000_000_000;
  const { ledger } = makeLedger();
  const a = await ledger.claim("event-4", "handler-a");
  const b = await ledger.claim("event-4", "handler-b");
  await ledger.complete(a.claim, "receipt-a");
  await ledger.complete(b.claim, "receipt-b");
  const summary = await ledger.summarize("event-4", ["handler-a", "handler-b"]);
  assert.equal(summary.complete, true);
  assert.equal(summary.pending, 0);
  assert.equal(summary.deadLetter, false);
});

test("acknowledges an inbox event only after every handler has committed a receipt", async () => {
  clock = 1_800_000_000_000;
  const inbox = new FakeInbox([gatewayEvent(10)]);
  const { ledger } = makeLedger();
  const receipts = [];
  const dispatcher = makeDispatcher({
    inbox,
    ledger,
    registry: { route: () => ({ status: "routed", handlers: ["handler-a", "handler-b"] }) },
    handlers: {
      "handler-a": async (event, context) => {
        receipts.push({ handler: context.handlerId, key: context.idempotencyKey });
        return { committed: true, receiptId: "receipt-a" };
      },
      "handler-b": async (event, context) => {
        receipts.push({ handler: context.handlerId, key: context.idempotencyKey });
        return { committed: true, receiptId: "receipt-b" };
      },
    },
  });
  const result = await dispatcher.drain();
  assert.equal(result.acknowledged, 1);
  assert.equal(inbox.events.length, 0);
  assert.deepEqual(receipts.map((entry) => entry.handler), ["handler-a", "handler-b"]);
  assert.ok(receipts.every((entry) => entry.key.includes(":handler-")));
});

test("retries after a crash between side effect and receipt, using stable idempotency key", async () => {
  clock = 1_800_000_000_000;
  const inbox = new FakeInbox([gatewayEvent(11)]);
  const { ledger } = makeLedger();
  const externalReceipts = new Map();
  let executions = 0;
  const handler = async (event, context) => {
    executions += 1;
    let receiptId = externalReceipts.get(context.idempotencyKey);
    if (!receiptId) {
      receiptId = "discord-message-123";
      externalReceipts.set(context.idempotencyKey, receiptId);
      if (executions === 1) throw new Error("simulated_crash_after_external_commit");
    }
    return { committed: true, receiptId };
  };
  const dispatcher = makeDispatcher({
    inbox, ledger,
    registry: { route: () => ({ status: "routed", handlers: ["handler-a"] }) },
    handlers: { "handler-a": handler },
  });

  const first = await dispatcher.drain();
  assert.equal(first.status, "retry_wait");
  assert.equal(inbox.events.length, 1);
  assert.equal(inbox.acks.length, 0);
  const firstRecord = await ledger.get(inbox.events[0].eventKey, "handler-a");
  assert.equal(firstRecord.status, "retry_wait");

  clock = firstRecord.retryAt;
  const second = await dispatcher.drain();
  assert.equal(second.acknowledged, 1);
  assert.equal(inbox.events.length, 0);
  assert.equal(executions, 2);
  assert.equal(externalReceipts.size, 1);
  assert.equal((await ledger.get(firstRecord.eventKey, "handler-a")).receiptId, "discord-message-123");
});

test("does not acknowledge when a handler is missing, disabled or has not returned a durable receipt", async () => {
  clock = 1_800_000_000_000;
  const missingInbox = new FakeInbox([gatewayEvent(12)]);
  const missingLedger = makeLedger().ledger;
  const missing = makeDispatcher({
    inbox: missingInbox, ledger: missingLedger,
    registry: { route: () => ({ status: "routed", handlers: ["handler-not-ported"] }) },
    handlers: {},
  });
  assert.equal((await missing.drain()).status, "blocked");
  assert.equal(missingInbox.acks.length, 0);

  const noReceiptInbox = new FakeInbox([gatewayEvent(13)]);
  const noReceiptLedger = makeLedger().ledger;
  const noReceipt = makeDispatcher({
    inbox: noReceiptInbox, ledger: noReceiptLedger,
    registry: { route: () => ({ status: "routed", handlers: ["handler-a"] }) },
    handlers: { "handler-a": async () => ({ ok: true }) },
  });
  assert.equal((await noReceipt.drain()).status, "retry_wait");
  assert.equal(noReceiptInbox.acks.length, 0);
});

test("quarantines unknown routes and acknowledges only deliberately ignored event types", async () => {
  clock = 1_800_000_000_000;
  const unknownInbox = new FakeInbox([gatewayEvent(14)]);
  const unknownLedger = makeLedger().ledger;
  const unknown = makeDispatcher({
    inbox: unknownInbox, ledger: unknownLedger,
    registry: { route: () => ({ status: "unhandled", reason: "unknown_component" }) },
    handlers: {},
  });
  assert.equal((await unknown.drain()).status, "blocked");
  assert.equal(unknownInbox.acks.length, 0);
  assert.equal((await unknownLedger.getDisposition(unknownInbox.events[0].eventKey)).status, "quarantined");

  const ignoredInbox = new FakeInbox([gatewayEvent(15, "TYPING_START")]);
  const ignoredLedger = makeLedger().ledger;
  const ignored = makeDispatcher({
    inbox: ignoredInbox, ledger: ignoredLedger,
    registry: { route: () => ({ status: "ignored", reason: "event_not_consumed" }) },
    handlers: {},
  });
  const result = await ignored.drain();
  assert.equal(result.acknowledged, 1);
  assert.equal((await ignoredLedger.getDisposition("1565048205970767992:session-a:15:TYPING_START")).disposition, "ignored");
});

test("preserves FIFO by blocking later events behind an incomplete earlier event", async () => {
  clock = 1_800_000_000_000;
  const inbox = new FakeInbox([gatewayEvent(20), gatewayEvent(21)]);
  const { ledger } = makeLedger();
  const dispatcher = makeDispatcher({
    inbox, ledger,
    registry: { route: () => ({ status: "routed", handlers: ["handler-a"] }) },
    handlers: { "handler-a": async () => ({ committed: true, receiptId: "receipt" }) },
  });
  const first = await dispatcher.drain({ limit: 1 });
  assert.equal(first.acknowledged, 1);
  assert.equal(inbox.events[0].sequence, 21);
  const rest = await dispatcher.drain();
  assert.equal(rest.acknowledged, 1);
  assert.equal(inbox.events.length, 0);
});


test("blocks unacknowledged interactions before routing and quarantines failed callbacks", async () => {
  clock = 1_800_000_000_000;
  const pendingEvent = gatewayEvent(30);
  pendingEvent.interactionAckState = "pending";
  const pendingInbox = new FakeInbox([pendingEvent]);
  const pendingLedger = makeLedger().ledger;
  let routeCalls = 0;
  let handlerCalls = 0;
  const pendingDispatcher = makeDispatcher({
    inbox: pendingInbox, ledger: pendingLedger,
    registry: { route: () => { routeCalls += 1; return { status: "routed", handlers: ["handler-a"] }; } },
    handlers: { "handler-a": async () => { handlerCalls += 1; return { committed: true, receiptId: "r1" }; } },
  });
  const pending = await pendingDispatcher.drain();
  assert.equal(pending.status, "awaiting_interaction_ack");
  assert.equal(pending.blocked, 1);
  assert.equal(pendingInbox.acks.length, 0);
  assert.equal(routeCalls, 0);
  assert.equal(handlerCalls, 0);

  const failedEvent = gatewayEvent(31);
  failedEvent.interactionAckState = "failed";
  const failedInbox = new FakeInbox([failedEvent]);
  const failedLedger = makeLedger().ledger;
  const failedDispatcher = makeDispatcher({
    inbox: failedInbox, ledger: failedLedger,
    registry: { route: () => { throw new Error("failed interactions must not route"); } },
    handlers: {},
  });
  const failed = await failedDispatcher.drain();
  assert.equal(failed.quarantined, 1);
  assert.equal(failed.acknowledged, 1);
  assert.equal(failedInbox.events.length, 0);
});
