function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function associatedData(payload) {
  const id = String(payload?.id ?? "");
  const applicationId = String(payload?.application_id ?? "");
  const guildId = String(payload?.guild_id ?? "dm");
  if (!/^\d{15,22}$/.test(id) || !/^\d{15,22}$/.test(applicationId) ||
      (guildId !== "dm" && !/^\d{15,22}$/.test(guildId))) {
    throw new TypeError("Interaction token context is missing a valid interaction, application or guild ID");
  }
  return new TextEncoder().encode("discord-interaction:v1:" + applicationId + ":" + guildId + ":" + id);
}

/**
 * AES-256-GCM protection for Discord interaction webhook tokens at rest.
 * The key is a 32-byte hex secret supplied through a Worker/DO secret binding.
 * Plaintext interaction tokens are returned only to the immediate caller and
 * are never included in the returned persistent payload.
 */
export function createInteractionTokenVault(secretHex, cryptoImpl = globalThis.crypto) {
  if (typeof secretHex !== "string" || !/^[a-f0-9]{64}$/i.test(secretHex)) {
    throw new TypeError("GATEWAY_INTERACTION_ENCRYPTION_KEY must be exactly 32 bytes of hexadecimal");
  }
  if (!cryptoImpl?.subtle || typeof cryptoImpl.getRandomValues !== "function") {
    throw new TypeError("Web Crypto is required for interaction token protection");
  }
  const rawKey = Uint8Array.from(secretHex.match(/../g), (byte) => parseInt(byte, 16));
  const keyPromise = cryptoImpl.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );

  async function encryptPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        typeof payload.token !== "string" || payload.token.length < 16 || payload.token.length > 256) {
      throw new TypeError("Discord interaction webhook token is missing or malformed");
    }
    const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
    const aad = associatedData(payload);
    const ciphertext = await cryptoImpl.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      await keyPromise,
      new TextEncoder().encode(payload.token),
    );
    const { token, ...safePayload } = payload;
    return {
      ...safePayload,
      interaction_token: {
        version: 1,
        algorithm: "A256GCM",
        iv: base64url(iv),
        ciphertext: base64url(new Uint8Array(ciphertext)),
      },
    };
  }

  async function decryptPayload(payload) {
    const protectedToken = payload?.interaction_token;
    if (!protectedToken || protectedToken.version !== 1 ||
        protectedToken.algorithm !== "A256GCM" ||
        typeof protectedToken.iv !== "string" ||
        typeof protectedToken.ciphertext !== "string" ||
        Object.prototype.hasOwnProperty.call(payload, "token")) {
      throw new TypeError("Persisted interaction token envelope is invalid");
    }
    const aad = associatedData(payload);
    try {
      const plaintext = await cryptoImpl.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64url(protectedToken.iv), additionalData: aad, tagLength: 128 },
        await keyPromise,
        fromBase64url(protectedToken.ciphertext),
      );
      return {
        ...payload,
        token: new TextDecoder().decode(plaintext),
      };
    } catch {
      throw new Error("Interaction token authentication failed");
    }
  }

  return Object.freeze({ encryptPayload, decryptPayload });
}
