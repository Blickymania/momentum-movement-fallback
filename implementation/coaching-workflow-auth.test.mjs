import test from "node:test";
import assert from "node:assert/strict";
import { signCoachingRequest, verifyCoachingRequest } from "./coaching-workflow-auth.mjs";

const secret = "test-secret-that-is-at-least-thirty-two-characters";
const body = JSON.stringify({ id: "interaction-123456789", data: { custom_id: "coach:request" } });

test("authenticates the exact raw body and source using HMAC-SHA256", async () => {
  const timestamp = 1_800_000_000_000;
  const headers = await signCoachingRequest({ source: "bot005", secret, timestamp, body });
  const result = await verifyCoachingRequest({
    source: headers["x-coaching-source"],
    timestamp: headers["x-coaching-timestamp"],
    signature: headers["x-coaching-signature"],
    body,
    secrets: { bot005: secret },
    now: timestamp
  });
  assert.deepEqual(result, { ok: true, source: "bot005" });
  assert.match(headers["x-coaching-signature"], /^[a-f0-9]{64}$/);
});

test("rejects payload tampering, source swapping, and invalid signatures", async () => {
  const timestamp = 1_800_000_000_000;
  const headers = await signCoachingRequest({ source: "bot005", secret, timestamp, body });
  const base = {
    timestamp: headers["x-coaching-timestamp"],
    signature: headers["x-coaching-signature"],
    secrets: { bot005: secret, "coaching-relay": secret },
    now: timestamp
  };
  assert.deepEqual(
    await verifyCoachingRequest({ ...base, source: "bot005", body: body + " ", }),
    { ok: false, reason: "signature_mismatch" }
  );
  assert.deepEqual(
    await verifyCoachingRequest({ ...base, source: "coaching-relay", body }),
    { ok: false, reason: "signature_mismatch" }
  );
  assert.deepEqual(
    await verifyCoachingRequest({ ...base, source: "bot005", body, signature: "0".repeat(64) }),
    { ok: false, reason: "signature_mismatch" }
  );
});

test("rejects expired or future-dated requests outside the clock-skew window", async () => {
  const timestamp = 1_800_000_000_000;
  const headers = await signCoachingRequest({ source: "bot005", secret, timestamp, body });
  for (const now of [timestamp - 60_001, timestamp + 60_001]) {
    const result = await verifyCoachingRequest({
      source: "bot005",
      timestamp: headers["x-coaching-timestamp"],
      signature: headers["x-coaching-signature"],
      body,
      secrets: { bot005: secret },
      now
    });
    assert.deepEqual(result, { ok: false, reason: "timestamp_out_of_window" });
  }
});

test("fails closed for unknown sources and malformed authentication fields", async () => {
  const timestamp = 1_800_000_000_000;
  const headers = await signCoachingRequest({ source: "bot005", secret, timestamp, body });
  const input = {
    source: "bot005",
    timestamp: headers["x-coaching-timestamp"],
    signature: headers["x-coaching-signature"],
    body,
    secrets: {},
    now: timestamp
  };
  assert.deepEqual(await verifyCoachingRequest(input), { ok: false, reason: "unknown_source" });
  assert.deepEqual(await verifyCoachingRequest({ ...input, source: "unknown" }), {
    ok: false, reason: "unknown_source"
  });
  assert.deepEqual(await verifyCoachingRequest({ ...input, timestamp: "not-a-time" }), {
    ok: false, reason: "invalid_request"
  });
  assert.throws(() => signCoachingRequest({ source: "bad source", secret, timestamp, body }), /coaching_auth_source_invalid/);
  assert.throws(() => signCoachingRequest({ source: "bot005", secret: "short", timestamp, body }), /coaching_auth_secret_invalid/);
});
