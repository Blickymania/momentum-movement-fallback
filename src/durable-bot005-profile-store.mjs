function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function validateProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
  const { about, tiktok, instagram, visibility } = profile;
  return typeof about === "string" && about.length <= 450 &&
    typeof tiktok === "string" && tiktok.length <= 32 &&
    typeof instagram === "string" && instagram.length <= 32 &&
    (visibility === "private" || visibility === "public");
}

function validDate(value) {
  const match = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(2000, Number(match[1]) - 1, Number(match[2])));
  return date.getUTCMonth() === Number(match[1]) - 1 && date.getUTCDate() === Number(match[2]);
}

function validateMilestone(value, anniversary) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !validDate(value.date) || typeof value.year !== "string" ||
      (value.year !== "" && !/^(19|20)\d{2}$/.test(value.year)) ||
      (anniversary && !/^(19|20)\d{2}$/.test(value.year)) ||
      !["private", "public"].includes(value.visibility)) return false;
  return value.post === undefined || value.post === null ||
    (typeof value.post === "string" && /^\d{15,22}$/.test(value.post));
}

function defaultProfile(userId) {
  return {
    userId,
    profile: { about: "", tiktok: "", instagram: "", visibility: "private" },
    birthday: { date: "", year: "", visibility: "private", post: null },
    anniversary: { date: "", year: "", visibility: "private", post: null },
    version: 0,
    createdAt: null,
    updatedAt: null,
  };
}

function recordKey(guildId, userId) {
  return "bot005:profile:v1:" + guildId + ":" + userId;
}

function receiptKey(guildId, interactionId) {
  return "bot005:profile-receipt:v1:" + guildId + ":" + interactionId;
}

/**
 * AES-256-GCM envelope for sensitive profile/milestone data at rest.
 * Keep this key separate from the interaction-token encryption key.
 */
export function createBot005ProfileCipher(secretHex, cryptoImpl = globalThis.crypto) {
  if (typeof secretHex !== "string" || !/^[a-f0-9]{64}$/i.test(secretHex)) {
    throw new TypeError("BOT005_PROFILE_ENCRYPTION_KEY must be 32 bytes of hexadecimal");
  }
  if (!cryptoImpl?.subtle || typeof cryptoImpl.getRandomValues !== "function") {
    throw new TypeError("Web Crypto is required for profile encryption");
  }
  const keyPromise = cryptoImpl.subtle.importKey(
    "raw",
    Uint8Array.from(secretHex.match(/../g), (byte) => parseInt(byte, 16)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );

  return Object.freeze({
    async encrypt(value, associatedData) {
      const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
      const encrypted = await cryptoImpl.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(associatedData), tagLength: 128 },
        await keyPromise,
        new TextEncoder().encode(JSON.stringify(value)),
      );
      return Object.freeze({
        version: 1,
        algorithm: "A256GCM",
        iv: base64url(iv),
        ciphertext: base64url(new Uint8Array(encrypted)),
      });
    },
    async decrypt(envelope, associatedData) {
      if (!envelope || envelope.version !== 1 || envelope.algorithm !== "A256GCM" ||
          typeof envelope.iv !== "string" || typeof envelope.ciphertext !== "string") {
        throw new Error("profile_ciphertext_invalid");
      }
      try {
        const decrypted = await cryptoImpl.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: fromBase64url(envelope.iv),
            additionalData: new TextEncoder().encode(associatedData),
            tagLength: 128,
          },
          await keyPromise,
          fromBase64url(envelope.ciphertext),
        );
        return JSON.parse(new TextDecoder().decode(decrypted));
      } catch {
        throw new Error("profile_ciphertext_authentication_failed");
      }
    },
  });
}

export class DurableBot005ProfileStore {
  constructor(storage, {
    guildId,
    applicationId,
    cipher,
    now = () => Date.now(),
  } = {}) {
    if (!storage || typeof storage.transaction !== "function" ||
        typeof storage.get !== "function") {
      throw new TypeError("Transactional Durable Object storage is required");
    }
    if (!validSnowflake(guildId) || !validSnowflake(applicationId)) {
      throw new TypeError("Verified guild and application IDs are required");
    }
    if (!cipher || typeof cipher.encrypt !== "function" || typeof cipher.decrypt !== "function" ||
        typeof now !== "function") {
      throw new TypeError("Profile encryption and clock dependencies are required");
    }
    this.storage = storage;
    this.guildId = guildId;
    this.applicationId = applicationId;
    this.cipher = cipher;
    this.now = now;
  }

  associatedData(userId) {
    return "bot005-profile:v1:" + this.guildId + ":" + this.applicationId + ":" + userId;
  }

  validateSubmission(submission) {
    if (!submission || submission.status !== "ready" ||
        submission.guildId !== this.guildId ||
        submission.applicationId !== this.applicationId ||
        !validSnowflake(submission.interactionId) ||
        !validSnowflake(submission.userId)) return false;
    if (submission.kind === "profile") return validateProfile(submission.values);
    if (submission.kind === "birthday") return validateMilestone(submission.values, false);
    if (submission.kind === "anniversary") return validateMilestone(submission.values, true);
    return false;
  }

  async get(userId) {
    if (!validSnowflake(userId)) throw new TypeError("User ID is invalid");
    const envelope = await this.storage.get(recordKey(this.guildId, userId));
    if (envelope === undefined) return defaultProfile(userId);
    const result = await this.cipher.decrypt(envelope, this.associatedData(userId));
    if (!result || result.userId !== userId ||
        !validateProfile(result.profile) ||
        !validateMilestone(result.birthday, false) ||
        !validateMilestone(result.anniversary, true)) {
      throw new Error("profile_record_integrity_failed");
    }
    return result;
  }

  async apply(submission) {
    if (!this.validateSubmission(submission)) {
      throw new TypeError("Bot 005 profile submission failed identity or data validation");
    }
    const { interactionId, userId, kind, values } = submission;
    const receiptId = "bot005-profile-" + interactionId;
    const dataKey = recordKey(this.guildId, userId);
    const savedReceiptKey = receiptKey(this.guildId, interactionId);
    return this.storage.transaction(async (txn) => {
      const priorReceipt = await txn.get(savedReceiptKey);
      if (priorReceipt !== undefined) {
        if (priorReceipt.userId !== userId || priorReceipt.kind !== kind ||
            priorReceipt.receiptId !== receiptId) {
          throw new Error("profile_receipt_collision");
        }
        return { committed: true, duplicate: true, receiptId };
      }

      const envelope = await txn.get(dataKey);
      const current = envelope === undefined
        ? defaultProfile(userId)
        : await this.cipher.decrypt(envelope, this.associatedData(userId));
      if (!current || current.userId !== userId ||
          !validateProfile(current.profile) ||
          !validateMilestone(current.birthday, false) ||
          !validateMilestone(current.anniversary, true)) {
        throw new Error("profile_record_integrity_failed");
      }

      const now = this.now();
      const next = {
        ...current,
        [kind]: { ...current[kind], ...values },
        version: (Number.isSafeInteger(current.version) ? current.version : 0) + 1,
        createdAt: current.createdAt ?? now,
        updatedAt: now,
      };
      const nextEnvelope = await this.cipher.encrypt(next, this.associatedData(userId));
      await txn.put(dataKey, nextEnvelope);
      await txn.put(savedReceiptKey, {
        receiptId,
        interactionId,
        userId,
        kind,
        committedAt: now,
        version: next.version,
      });
      return { committed: true, duplicate: false, receiptId, version: next.version };
    });
  }

  async getReceipt(interactionId) {
    if (!validSnowflake(interactionId)) throw new TypeError("Interaction ID is invalid");
    return (await this.storage.get(receiptKey(this.guildId, interactionId))) ?? null;
  }
}
