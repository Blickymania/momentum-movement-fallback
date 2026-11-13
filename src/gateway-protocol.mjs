/**
 * Pure Discord Gateway v10 protocol helpers.
 *
 * No socket, storage, timer, token, or Cloudflare dependency lives here so
 * the protocol state machine can be tested without deploying a Durable Object.
 */
export const GatewayOpcode = Object.freeze({
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
});

export function parseGatewayFrame(data) {
  let text;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof ArrayBuffer) {
    text = new TextDecoder().decode(data);
  } else if (ArrayBuffer.isView(data)) {
    text = new TextDecoder().decode(data);
  } else {
    throw new TypeError("Unsupported Gateway frame type");
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Gateway frame is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gateway frame must be a JSON object");
  }
  if (!Number.isInteger(value.op) || value.op < 0) {
    throw new Error("Gateway frame has an invalid opcode");
  }
  if (value.d === undefined) value.d = null;
  return value;
}

export function createIdentify(token, intents, properties = {}) {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new TypeError("A Discord bot token is required");
  }
  if (!Number.isSafeInteger(intents) || intents < 0) {
    throw new TypeError("Gateway intents must be a non-negative safe integer");
  }
  return {
    op: GatewayOpcode.IDENTIFY,
    d: {
      token,
      intents,
      properties: {
        os: "cloudflare-workers",
        browser: "momentum-movement",
        device: "momentum-movement",
        ...properties,
      },
    },
  };
}

export function createResume(token, sessionId, sequence) {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new TypeError("A Discord bot token is required");
  }
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new TypeError("A valid Gateway session ID is required");
  }
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new TypeError("A valid Gateway sequence is required to resume");
  }
  return {
    op: GatewayOpcode.RESUME,
    d: { token, session_id: sessionId, seq: sequence },
  };
}

export function createHeartbeat(sequence) {
  if (sequence !== null && sequence !== undefined &&
      (!Number.isSafeInteger(sequence) || sequence < 0)) {
    throw new TypeError("Heartbeat sequence must be null or a non-negative safe integer");
  }
  return { op: GatewayOpcode.HEARTBEAT, d: sequence ?? null };
}

export function heartbeatJitterDelay(intervalMs, jitterFraction) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1000 || intervalMs > 300000) {
    throw new RangeError("Gateway heartbeat interval is outside the accepted range");
  }
  if (!Number.isFinite(jitterFraction) || jitterFraction < 0 || jitterFraction > 1) {
    throw new RangeError("Heartbeat jitter must be between 0 and 1");
  }
  return Math.floor(intervalMs * jitterFraction);
}

/**
 * Interpret one server Gateway frame as a small side-effect-free decision.
 * The caller applies storage writes, socket sends, timers, and event handling.
 */
export function decideGatewayFrame(frame, session = {}) {
  const data = frame?.d ?? null;
  switch (frame?.op) {
    case GatewayOpcode.HELLO: {
      const interval = Number(data?.heartbeat_interval);
      if (!Number.isFinite(interval) || interval < 1000 || interval > 300000) {
        return { action: "fatal", reason: "invalid_heartbeat_interval" };
      }
      const resumable = typeof session.sessionId === "string" &&
        session.sessionId.length > 0 &&
        typeof session.resumeGatewayUrl === "string" &&
        session.resumeGatewayUrl.startsWith("wss://") &&
        Number.isSafeInteger(session.sequence) &&
        session.sequence >= 0;
      return {
        action: resumable ? "resume" : "identify",
        heartbeatInterval: interval,
      };
    }
    case GatewayOpcode.HEARTBEAT:
      return { action: "send_heartbeat" };
    case GatewayOpcode.HEARTBEAT_ACK:
      return { action: "heartbeat_ack" };
    case GatewayOpcode.RECONNECT:
      return { action: "reconnect" };
    case GatewayOpcode.INVALID_SESSION:
      return data === true
        ? { action: "resume_after_invalid_session" }
        : { action: "identify_after_invalid_session", clearSession: true };
    case GatewayOpcode.DISPATCH: {
      const sequence = Number.isSafeInteger(frame.s) && frame.s >= 0
        ? frame.s
        : session.sequence ?? null;
      if (frame.t === "READY") {
        const nextSessionId = data?.session_id;
        const resumeGatewayUrl = data?.resume_gateway_url;
        if (typeof nextSessionId !== "string" || nextSessionId.length === 0 ||
            typeof resumeGatewayUrl !== "string" ||
            !resumeGatewayUrl.startsWith("wss://")) {
          return { action: "fatal", reason: "invalid_ready_payload" };
        }
        return {
          action: "dispatch",
          sequence,
          eventType: frame.t,
          session: { sessionId: nextSessionId, sequence, resumeGatewayUrl },
          ready: true,
        };
      }
      return {
        action: "dispatch",
        sequence,
        eventType: typeof frame.t === "string" ? frame.t : "UNKNOWN",
        ready: false,
      };
    }
    default:
      return { action: "ignore" };
  }
}

/**
 * Map documented close-code classes to safe recovery behavior.
 * Invalid credentials/intents/configuration are terminal, not retry loops.
 */
export function decideGatewayClose(code) {
  if (!Number.isInteger(code)) return { action: "retry", clearSession: false };
  if (code === 4004 || code === 4010 || code === 4011 ||
      code === 4012 || code === 4013 || code === 4014) {
    return { action: "fatal", clearSession: false, reason: "gateway_configuration_or_auth" };
  }
  if (code === 4003) {
    return { action: "retry", clearSession: true, reason: "not_authenticated" };
  }
  if (code === 4006 || code === 4007 || code === 4009) {
    return { action: "retry", clearSession: true, reason: "session_not_resumable" };
  }
  if (code === 4008) {
    return { action: "retry", clearSession: false, rateLimited: true };
  }
  return { action: "retry", clearSession: false };
}

export function boundedReconnectDelay(attempt, randomFraction = 0.5, baseMs = 1000, maxMs = 60000) {
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new RangeError("Reconnect attempt must be a non-negative integer");
  }
  if (!Number.isFinite(randomFraction) || randomFraction < 0 || randomFraction > 1) {
    throw new RangeError("Reconnect jitter must be between 0 and 1");
  }
  if (!Number.isFinite(baseMs) || baseMs < 100 ||
      !Number.isFinite(maxMs) || maxMs < baseMs) {
    throw new RangeError("Reconnect backoff bounds are invalid");
  }
  const ceiling = Math.min(maxMs, baseMs * (2 ** Math.min(attempt, 30)));
  // Equal jitter avoids zero-delay reconnect loops under deterministic/tested random values.
  return Math.floor(ceiling * (0.5 + randomFraction * 0.5));
}

/** A dispatch key for durable deduplication; prefer Discord object IDs. */
export function gatewayEventKey(guildId, sequence, eventType, data) {
  if (typeof guildId !== "string" || guildId.length === 0) {
    throw new TypeError("A guild ID is required for an event key");
  }
  if (typeof eventType !== "string" || eventType.length === 0) {
    throw new TypeError("A Gateway event type is required for an event key");
  }
  const objectId = data && typeof data.id === "string" && data.id.length > 0 ? data.id : null;
  const key = objectId ?? (Number.isSafeInteger(sequence) ? String(sequence) : null);
  if (!key) throw new TypeError("A stable event ID or Gateway sequence is required");
  return [String(guildId), String(eventType), key].join(":");
}
