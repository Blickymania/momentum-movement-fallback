import test from "node:test";
import assert from "node:assert/strict";
import {
  DurableGatewayInbox,
  InboxFullError,
  InboxIntegrityError,
} from "../src/durable-gateway-inbox.mjs";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  async get(key) {
    return this.values.get(key);
  }
  async put(key, value) {
    this.values.set(key, structuredClone(value));
  }
  async delete(key) {
    return this.values.delete(key);
  }
  async list({ prefix = "", limit = 1000, startAfter } = {}) {
    const output = new Map();
    const keys = [...this.values.keys()]
      .filter((key) => key.startsWith(prefix) && (startAfter === undefined || key > startAfter))
      .sort();
    for (const key of keys.slice(0, limit)) {
      output.set(key, structuredClone(this.values.get(key)));
    }
    return output;
  }
  async transaction(callback) {
    const snapshot = new Map(
      [...this.values.entries()].map(([key, value]) => [key, structuredClone(value)]),
    );
    const tx = {
      get: async (key) => snapshot.get(key),
      put: async (key, value) => snapshot.set(key, structuredClone(value)),
      delete: async (key) => snapshot.delete(key),
      list: async ({ prefix = "", limit = 1000, startAfter } = {}) => {
        const output = new Map();
        const keys = [...snapshot.keys()]
          .filter((key) => key.startsWith(prefix) && (startAfter === undefined || key > startAfter))
          .sort();
        for (const key of keys.slice(0, limit)) output.set(key, structuredClone(snapshot.get(key)));
        return output;
      },
    };
    const result = await callback(tx);
    this.values = snapshot;
    return result;
  }
}

function makeInbox(options = {}) {
  return new DurableGatewayInbox(new MemoryStorage(), options);
}

const sessionA = {
  sessionId: "session-a",
  sequence: 10,
  resumeGatewayUrl: "wss://gateway.example",
};

test("isolates two Gateway client queues inside one durable storage namespace", async () => {
  const storage = new MemoryStorage();
  const alpha = new DurableGatewayInbox(storage, { namespace: "bot-alpha" });
  const beta = new DurableGatewayInbox(storage, { namespace: "bot-beta" });
  await Promise.all([alpha.initialize(), beta.initialize()]);
  await alpha.saveReadySession({
    sessionId: "alpha-session", sequence: 5, resumeGatewayUrl: "wss://alpha.example",
  });
  await beta.saveReadySession({
    sessionId: "beta-session", sequence: 50, resumeGatewayUrl: "wss://beta.example",
  });
  await alpha.enqueueDispatch({
    guildId: "guild", sessionId: "alpha-session", sequence: 6,
    eventType: "MESSAGE_CREATE", payload: { id: "alpha-message" },
  });
  await beta.enqueueDispatch({
    guildId: "guild", sessionId: "beta-session", sequence: 51,
    eventType: "MESSAGE_CREATE", payload: { id: "beta-message" },
  });

  assert.equal((await alpha.getState()).sequence, 6);
  assert.equal((await beta.getState()).sequence, 51);
  assert.deepEqual((await alpha.listPending()).map((item) => item.payload.id), ["alpha-message"]);
  assert.deepEqual((await beta.listPending()).map((item) => item.payload.id), ["beta-message"]);
  assert.equal((await alpha.getMetrics()).pendingEvents, 1);
  assert.equal((await beta.getMetrics()).pendingEvents, 1);
});

test("rejects unsafe Durable Gateway inbox namespace identifiers", () => {
  const storage = new MemoryStorage();
  assert.throws(() => new DurableGatewayInbox(storage, { namespace: "../bot" }), /namespace/);
  assert.throws(() => new DurableGatewayInbox(storage, { namespace: "x".repeat(65) }), /namespace/);
});

test("initializes durable session and inbox metadata", async () => {
  const inbox = makeInbox();
  await inbox.initialize();
  assert.deepEqual(await inbox.getMetrics(), {
    pendingEvents: 0,
    pendingBytes: 0,
    sessionStored: false,
    lastSequence: null,
    updatedAt: (await inbox.storage.get("gateway:inbox:meta")).updatedAt,
  });
});

test("refuses dispatches before a READY session has been stored", async () => {
  const inbox = makeInbox();
  await inbox.initialize();
  await assert.rejects(() => inbox.enqueueDispatch({
    guildId: "guild",
    sessionId: "session-a",
    sequence: 11,
    eventType: "MESSAGE_CREATE",
    payload: { id: "message-1" },
  }), InboxIntegrityError);
});

test("stores READY session before accepting its dispatch stream", async () => {
  const inbox = makeInbox();
  await inbox.initialize();
  await inbox.saveReadySession(sessionA);
  assert.deepEqual(await inbox.getState(), {
    ...sessionA,
    updatedAt: (await inbox.getState()).updatedAt,
  });
  await assert.rejects(() => inbox.saveReadySession({
    sessionId: "session-b",
    sequence: 11,
    resumeGatewayUrl: "http://not-secure",
  }), /READY session state/);
});

test("clears non-resumable Gateway session state without discarding queued events", async () => {
  const inbox = makeInbox({ namespace: "bot-alpha" });
  await inbox.initialize();
  await inbox.saveReadySession(sessionA);
  await inbox.enqueueDispatch({
    guildId: "guild", sessionId: "session-a", sequence: 11,
    eventType: "MESSAGE_CREATE", payload: { id: "preserved-event" },
  });
  const cleared = await inbox.clearSession();
  assert.equal(cleared.sessionId, null);
  assert.equal(cleared.sequence, null);
  assert.equal(cleared.resumeGatewayUrl, null);
  assert.equal((await inbox.listPending()).length, 1);
  await assert.rejects(() => inbox.enqueueDispatch({
    guildId: "guild", sessionId: "session-a", sequence: 12,
    eventType: "MESSAGE_CREATE", payload: { id: "not-accepted" },
  }), InboxIntegrityError);
});

test("enqueue stores an event and advances the durable sequence atomically", async () => {
  const inbox = makeInbox();
  await inbox.initialize();
  await inbox.saveReadySession(sessionA);
  const result = await inbox.enqueueDispatch({
    guildId: "guild",
    sessionId: "session-a",
    sequence: 11,
    eventType: "MESSAGE_CREATE",
    payload: { id: "message-1", content: "hello" },
  });
  assert.equal(result.accepted, true);
  assert.equal((await inbox.getState()).sequence, 11);
  assert.equal((await inbox.listPending()).length, 1);
});

test("replayed and old sequences are ignored without duplicating inbox entries", async () => {
  const inbox = makeInbox();
  await inbox.initialize();
  await inbox.saveReadySession(sessionA);
  const event = {
    guildId: "guild", sessionId: "session-a", sequence: 11,
    eventType: "MESSAGE_CREATE", payload: { id: "message-1" },
  };
  assert.equal((await inbox.enqueueDispatch(event)).accepted, true);
  const replay = await inbox.enqueueDispatch(event);
  assert.equal(replay.duplicate, true);
  assert.equal((await inbox.enqueueDispatch({ ...event, sequence: 10 })).duplicate, true);
  assert.equal((await inbox.listPending()).length, 1);
  assert.equal((await inbox.getMetrics()).pendingEvents, 1);
});

test("repeated updates to the same Discord object remain distinct by sequence", async () => {
  const inbox = makeInbox();
  await inbox.initialize();
  await inbox.saveReadySession(sessionA);
  const base = {
    guildId: "guild", sessionId: "session-a",
    eventType: "MESSAGE_UPDATE", payload: { id: "same-message-id" },
  };
  assert.equal((await inbox.enqueueDispatch({ ...base, sequence: 11 })).accepted, true);
  assert.equal((await inbox.enqueueDispatch({ ...base, sequence: 12 })).accepted, true);
  const pending = await inbox.listPending();
  assert.equal(pending.length, 2);
  assert.equal(pending[0].payload.id, "same-message-id");
  assert.equal(pending[1].payload.id, "same-message-id");
  assert.equal(pending[0].sequence, 11);
  assert.equal(pending[1].sequence, 12);
  assert.ok(pending[0].queueOrder < pending[1].queueOrder);
});

test("queue event and byte limits reject without advancing sequence", async () => {
  const inbox = makeInbox({ maxPendingEvents: 1, maxPendingBytes: 2048, maxEventBytes: 1024 });
  await inbox.initialize();
  await inbox.saveReadySession(sessionA);
  await inbox.enqueueDispatch({
    guildId: "guild", sessionId: "session-a", sequence: 11,
    eventType: "MESSAGE_CREATE", payload: { id: "first" },
  });
  await assert.rejects(() => inbox.enqueueDispatch({
    guildId: "guild", sessionId: "session-a", sequence: 12,
    eventType: "MESSAGE_CREATE", payload: { id: "second" },
  }), InboxFullError);
  assert.equal((await inbox.getState()).sequence, 11);
  assert.equal((await inbox.getMetrics()).pendingEvents, 1);
});

test("acknowledgement releases queue capacity and is idempotent", async () => {
  const inbox = makeInbox({ maxPendingEvents: 1, maxPendingBytes: 2048, maxEventBytes: 1024 });
  await inbox.initialize();
  await inbox.saveReadySession(sessionA);
  const event = {
    guildId: "guild", sessionId: "session-a", sequence: 11,
    eventType: "MESSAGE_CREATE", payload: { id: "first" },
  };
  const inserted = await inbox.enqueueDispatch(event);
  const ack = await inbox.acknowledge([inserted.eventKey]);
  assert.equal(ack.acknowledged, 1);
  assert.equal(ack.pendingEvents, 0);
  assert.equal((await inbox.acknowledge([inserted.eventKey])).acknowledged, 0);
  assert.equal((await inbox.getMetrics()).pendingBytes, 0);
  assert.equal((await inbox.enqueueDispatch({ ...event, sequence: 11 })).duplicate, true);
  assert.equal((await inbox.enqueueDispatch({ ...event, sequence: 12 })).accepted, true);
});

test("new READY session resets the dispatch sequence without deleting old pending events", async () => {
  const inbox = makeInbox();
  await inbox.initialize();
  await inbox.saveReadySession(sessionA);
  await inbox.enqueueDispatch({
    guildId: "guild", sessionId: "session-a", sequence: 11,
    eventType: "MESSAGE_CREATE", payload: { id: "old-session-message" },
  });
  await inbox.saveReadySession({
    sessionId: "session-b", sequence: 1, resumeGatewayUrl: "wss://gateway-b.example",
  });
  assert.equal((await inbox.getState()).sequence, 1);
  assert.equal((await inbox.listPending()).length, 1);
  assert.equal((await inbox.enqueueDispatch({
    guildId: "guild", sessionId: "session-b", sequence: 2,
    eventType: "MESSAGE_CREATE", payload: { id: "new-session-message" },
  })).accepted, true);
  const pending = await inbox.listPending();
  assert.equal(pending.length, 2);
  assert.equal(pending[0].payload.id, "old-session-message");
  assert.equal(pending[1].payload.id, "new-session-message");
  assert.ok(pending[0].queueOrder < pending[1].queueOrder);
});

test("rejects invalid payloads, key formats, and acknowledgement batches", async () => {
  const inbox = makeInbox();
  await inbox.initialize();
  await inbox.saveReadySession(sessionA);
  await assert.rejects(() => inbox.enqueueDispatch({
    guildId: "guild", sessionId: "session-a", sequence: 11,
    eventType: "MESSAGE_CREATE", payload: null,
  }), /payload/);
  await assert.rejects(() => inbox.acknowledge([]), /between 1 and 100/);
  await assert.rejects(() => inbox.acknowledge([""]), /between 1 and 100/);
  await assert.rejects(() => inbox.listPending(0), /between 1 and 500/);
});

test("paginates the bounded inbox before sorting and returns oldest events first", async () => {
  const inbox = makeInbox({ maxPendingEvents: 1500, maxPendingBytes: 4 * 1024 * 1024 });
  await inbox.initialize();
  await inbox.saveReadySession(sessionA);
  for (let sequence = 11; sequence < 1211; sequence++) {
    const result = await inbox.enqueueDispatch({
      guildId: "guild",
      sessionId: "session-a",
      sequence,
      eventType: "MESSAGE_CREATE",
      payload: { id: "message-" + sequence },
    });
    assert.equal(result.accepted, true);
  }
  const firstTen = await inbox.listPending(10);
  assert.equal(firstTen.length, 10);
  assert.deepEqual(firstTen.map((item) => item.sequence), [11,12,13,14,15,16,17,18,19,20]);
  assert.ok(firstTen.every((item, index) => index === 0 || item.queueOrder > firstTen[index - 1].queueOrder));
  const firstFiveHundred = await inbox.listPending(500);
  assert.equal(firstFiveHundred.length, 500);
  assert.equal(firstFiveHundred[499].sequence, 510);
});
