import test from "node:test";
import assert from "node:assert/strict";
import {
  GatewayOpcode,
  parseGatewayFrame,
  createIdentify,
  createResume,
  createHeartbeat,
  heartbeatJitterDelay,
  decideGatewayFrame,
  decideGatewayClose,
  boundedReconnectDelay,
  gatewayEventKey,
} from "../src/gateway-protocol.mjs";

test("parses valid JSON Gateway frames", () => {
  assert.deepEqual(parseGatewayFrame('{"op":11,"d":null}'), { op: 11, d: null });
});

test("rejects malformed, non-object and invalid-opcode frames", () => {
  assert.throws(() => parseGatewayFrame("{"), /valid JSON/);
  assert.throws(() => parseGatewayFrame("[]"), /JSON object/);
  assert.throws(() => parseGatewayFrame('{"op":"10"}'), /invalid opcode/);
  assert.throws(() => parseGatewayFrame(new Blob(["{}"])), /Unsupported/);
});

test("builds an Identify payload with validated token and intents", () => {
  const result = createIdentify("test-token", 513);
  assert.equal(result.op, GatewayOpcode.IDENTIFY);
  assert.equal(result.d.token, "test-token");
  assert.equal(result.d.intents, 513);
  assert.equal(result.d.properties.browser, "momentum-movement");
  assert.throws(() => createIdentify("", 513), /token/);
  assert.throws(() => createIdentify("test-token", -1), /intents/);
});

test("builds a Resume payload only when session and sequence are valid", () => {
  assert.deepEqual(createResume("token", "session-a", 19), {
    op: GatewayOpcode.RESUME,
    d: { token: "token", session_id: "session-a", seq: 19 },
  });
  assert.throws(() => createResume("token", "", 19), /session ID/);
  assert.throws(() => createResume("token", "session-a", null), /sequence/);
});

test("uses null sequence in initial heartbeat and validates sequence", () => {
  assert.deepEqual(createHeartbeat(undefined), { op: GatewayOpcode.HEARTBEAT, d: null });
  assert.deepEqual(createHeartbeat(9), { op: GatewayOpcode.HEARTBEAT, d: 9 });
  assert.throws(() => createHeartbeat(-1), /sequence/);
});

test("validates heartbeat interval and jitter bounds", () => {
  assert.equal(heartbeatJitterDelay(40000, 0.5), 20000);
  assert.equal(heartbeatJitterDelay(40000, 1), 40000);
  assert.throws(() => heartbeatJitterDelay(500, 0.5), /interval/);
  assert.throws(() => heartbeatJitterDelay(40000, 1.1), /jitter/);
});

test("Hello selects Identify when no valid session exists", () => {
  assert.deepEqual(decideGatewayFrame({
    op: GatewayOpcode.HELLO,
    d: { heartbeat_interval: 41000 },
  }, {}), { action: "identify", heartbeatInterval: 41000 });
});

test("Hello selects Resume when a session and sequence are available", () => {
  assert.deepEqual(decideGatewayFrame({
    op: GatewayOpcode.HELLO,
    d: { heartbeat_interval: 41000 },
  }, { sessionId: "session-a", sequence: 11, resumeGatewayUrl: "wss://gateway.example" }), {
    action: "resume", heartbeatInterval: 41000,
  });
});

test("Hello rejects invalid heartbeat interval", () => {
  assert.deepEqual(decideGatewayFrame({
    op: GatewayOpcode.HELLO,
    d: { heartbeat_interval: 0 },
  }), { action: "fatal", reason: "invalid_heartbeat_interval" });
});

test("server heartbeat requests trigger an immediate heartbeat", () => {
  assert.deepEqual(decideGatewayFrame({ op: GatewayOpcode.HEARTBEAT, d: null }), {
    action: "send_heartbeat",
  });
});

test("heartbeat ACK updates only acknowledgement state", () => {
  assert.deepEqual(decideGatewayFrame({ op: GatewayOpcode.HEARTBEAT_ACK, d: null }), {
    action: "heartbeat_ack",
  });
});

test("dispatch decisions preserve sequence and identify READY session state", () => {
  assert.deepEqual(decideGatewayFrame({
    op: GatewayOpcode.DISPATCH,
    t: "MESSAGE_CREATE",
    s: 24,
    d: { id: "message-1" },
  }, { sequence: 23 }), {
    action: "dispatch", sequence: 24, eventType: "MESSAGE_CREATE", ready: false,
  });

  const ready = decideGatewayFrame({
    op: GatewayOpcode.DISPATCH,
    t: "READY",
    s: 25,
    d: { session_id: "session-b", resume_gateway_url: "wss://gateway.example" },
  });
  assert.equal(ready.action, "dispatch");
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.session, {
    sessionId: "session-b", sequence: 25, resumeGatewayUrl: "wss://gateway.example",
  });
});

test("READY payload requires a secure resume URL and session identifier", () => {
  assert.deepEqual(decideGatewayFrame({
    op: GatewayOpcode.DISPATCH, t: "READY", s: 1,
    d: { session_id: "session", resume_gateway_url: "http://not-secure" },
  }), { action: "fatal", reason: "invalid_ready_payload" });
});

test("Reconnect and Invalid Session frames select safe actions", () => {
  assert.deepEqual(decideGatewayFrame({ op: GatewayOpcode.RECONNECT }), { action: "reconnect" });
  assert.deepEqual(decideGatewayFrame({ op: GatewayOpcode.INVALID_SESSION, d: true }), {
    action: "resume_after_invalid_session",
  });
  assert.deepEqual(decideGatewayFrame({ op: GatewayOpcode.INVALID_SESSION, d: false }), {
    action: "identify_after_invalid_session", clearSession: true,
  });
});

test("unknown opcodes are safely ignored", () => {
  assert.deepEqual(decideGatewayFrame({ op: 99, d: null }), { action: "ignore" });
});

test("fatal Gateway close codes never enter a retry loop", () => {
  for (const code of [4004, 4010, 4011, 4012, 4013, 4014]) {
    assert.equal(decideGatewayClose(code).action, "fatal");
  }
});

test("not-authenticated and invalid-session close codes clear persisted resume state", () => {
  assert.deepEqual(decideGatewayClose(4003), {
    action: "retry", clearSession: true, reason: "not_authenticated",
  });
  for (const code of [4006, 4007, 4009]) {
    assert.deepEqual(decideGatewayClose(code), {
      action: "retry", clearSession: true, reason: "session_not_resumable",
    });
  }
});

test("rate-limit close code requests bounded backoff", () => {
  assert.deepEqual(decideGatewayClose(4008), {
    action: "retry", clearSession: false, rateLimited: true,
  });
});

test("reconnect delay grows exponentially and is capped", () => {
  assert.equal(boundedReconnectDelay(0, 1), 1000);
  assert.equal(boundedReconnectDelay(2, 0.5), 3000);
  assert.equal(boundedReconnectDelay(20, 1), 60000);
  assert.equal(boundedReconnectDelay(1, 0), 1000);
  assert.equal(boundedReconnectDelay(1, 1), 2000);
  assert.throws(() => boundedReconnectDelay(-1), /attempt/);
});

test("event key prefers Discord object ID for duplicate-safe processing", () => {
  assert.equal(gatewayEventKey("guild", 19, "MESSAGE_CREATE", { id: "msg-1" }),
    "guild:MESSAGE_CREATE:msg-1");
  assert.equal(gatewayEventKey("guild", 20, "PRESENCE_UPDATE", {}),
    "guild:PRESENCE_UPDATE:20");
  assert.throws(() => gatewayEventKey("guild", null, "UNKNOWN", {}), /stable event ID/);
  assert.throws(() => gatewayEventKey("", 1, "MESSAGE_CREATE", {}), /guild ID/);
  assert.throws(() => gatewayEventKey("guild", 1, "", {}), /event type/);
});
