const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const MAX_CLOCK_SKEW_MS = 60_000;

function validSource(value) {
  return typeof value === "string" && SOURCE_PATTERN.test(value);
}

function validSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 512;
}

function validBody(value) {
  return typeof value === "string" && new TextEncoder().encode(value).byteLength <= 1_048_576;
}

function constantTimeHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmacHex(secret, message, cryptoImpl) {
  if (!cryptoImpl?.subtle || typeof cryptoImpl.subtle.importKey !== "function") {
    throw new Error("coaching_auth_crypto_unavailable");
  }
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await cryptoImpl.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

function signedMessage(source, timestamp, body) {
  return source + "\n" + timestamp + "\n" + body;
}

export async function signCoachingRequest({
  source,
  secret,
  timestamp = Date.now(),
  body,
  cryptoImpl = globalThis.crypto
}) {
  if (!validSource(source)) throw new TypeError("coaching_auth_source_invalid");
  if (!validSecret(secret)) throw new TypeError("coaching_auth_secret_invalid");
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new TypeError("coaching_auth_timestamp_invalid");
  }
  if (!validBody(body)) throw new TypeError("coaching_auth_body_invalid");
  const timestampText = String(timestamp);
  const signature = await hmacHex(secret, signedMessage(source, timestampText, body), cryptoImpl);
  return Object.freeze({
    "x-coaching-source": source,
    "x-coaching-timestamp": timestampText,
    "x-coaching-signature": signature
  });
}

export async function verifyCoachingRequest({
  source,
  timestamp,
  signature,
  body,
  secrets,
  now = Date.now(),
  toleranceMs = MAX_CLOCK_SKEW_MS,
  cryptoImpl = globalThis.crypto
}) {
  if (!validSource(source) || typeof timestamp !== "string" ||
      !/^[1-9][0-9]{0,15}$/.test(timestamp) ||
      !Number.isSafeInteger(now) || !Number.isInteger(toleranceMs) ||
      toleranceMs < 1000 || toleranceMs > 300_000 ||
      !SIGNATURE_PATTERN.test(String(signature || "")) ||
      !validBody(body) || !secrets || typeof secrets !== "object") {
    return Object.freeze({ ok: false, reason: "invalid_request" });
  }

  const requestTime = Number(timestamp);
  if (!Number.isSafeInteger(requestTime) || Math.abs(now - requestTime) > toleranceMs) {
    return Object.freeze({ ok: false, reason: "timestamp_out_of_window" });
  }

  const secret = secrets[source];
  if (!validSecret(secret)) return Object.freeze({ ok: false, reason: "unknown_source" });

  const expected = await hmacHex(secret, signedMessage(source, timestamp, body), cryptoImpl);
  if (!constantTimeHexEqual(expected, signature)) {
    return Object.freeze({ ok: false, reason: "signature_mismatch" });
  }
  return Object.freeze({ ok: true, source });
}
