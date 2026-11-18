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
      typeof value.date !== "string" || typeof value.year !== "string" ||
      !["private", "public"].includes(value.visibility)) return false;
  const validPost = value.post === undefined || value.post === null ||
    (typeof value.post === "string" && /^\d{15,22}$/.test(value.post));
  if (!validPost) return false;
  if (value.date === "" && value.year === "" && value.visibility === "private" &&
      (value.post === undefined || value.post === null)) return true;
  return validDate(value.date) &&
    (value.year === "" || /^(19|20)\d{2}$/.test(value.year)) &&
    (!anniversary || /^(19|20)\d{2}$/.test(value.year));
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

function milestoneOutboxKey(guildId, userId, kind) {
  return "bot005:milestone-outbox:v1:" + guildId + ":" + userId + ":" + kind;
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
    makeLeaseId = () => globalThis.crypto.randomUUID(),
  } = {}) {
    if (!storage || typeof storage.transaction !== "function" ||
        typeof storage.get !== "function") {
      throw new TypeError("Transactional Durable Object storage is required");
    }
    if (!validSnowflake(guildId) || !validSnowflake(applicationId)) {
      throw new TypeError("Verified guild and application IDs are required");
    }
    if (!cipher || typeof cipher.encrypt !== "function" || typeof cipher.decrypt !== "function" ||
        typeof now !== "function" || typeof makeLeaseId !== "function") {
      throw new TypeError("Profile encryption, clock and lease dependencies are required");
    }
    this.storage = storage;
    this.guildId = guildId;
    this.applicationId = applicationId;
    this.cipher = cipher;
    this.now = now;
    this.makeLeaseId = makeLeaseId;
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
      if (kind === "birthday" || kind === "anniversary") {
        const outboxKey = milestoneOutboxKey(this.guildId, userId, kind);
        const outboxPayload = {
          userId,
          kind,
          date: next[kind].date,
          visibility: next[kind].visibility,
          previousPostId: current[kind].post ?? null,
          revision: next.version,
        };
        const outboxEnvelope = await this.cipher.encrypt(
          outboxPayload,
          this.associatedData(userId) + ":milestone:" + kind,
        );
        const priorOutbox = await txn.get(outboxKey);
        await txn.put(outboxKey, {
          guildId: this.guildId,
          userId,
          kind,
          status: "pending",
          revision: next.version,
          attempts: 0,
          leaseId: null,
          leaseExpiresAt: null,
          retryAt: null,
          payload: outboxEnvelope,
          createdAt: priorOutbox?.createdAt ?? now,
          updatedAt: now,
          lastError: null,
          postId: null,
        });
      }
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

  async getMilestoneOutbox(userId, kind) {
    if (!validSnowflake(userId) || !["birthday", "anniversary"].includes(kind)) {
      throw new TypeError("Milestone outbox identity is invalid");
    }
    const record = await this.storage.get(milestoneOutboxKey(this.guildId, userId, kind));
    if (record === undefined) return null;
    const payload = await this.cipher.decrypt(
      record.payload,
      this.associatedData(userId) + ":milestone:" + kind,
    );
    return { ...record, payload };
  }

  async processMilestoneOutbox(userId, kind, upsertMilestone, {
    leaseMs = 30_000,
    maxAttempts = 8,
  } = {}) {
    if (!validSnowflake(userId) || !["birthday", "anniversary"].includes(kind) ||
        typeof upsertMilestone !== "function" ||
        !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000 ||
        !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
      throw new TypeError("Milestone outbox processor configuration is invalid");
    }

    const key = milestoneOutboxKey(this.guildId, userId, kind);
    const now = this.now();
    const claimResult = await this.storage.transaction(async (txn) => {
      const current = await txn.get(key);
      if (current === undefined) return { claimed: false, missing: true };
      if (current.status === "completed" || current.status === "dead_letter") {
        return { claimed: false, status: current.status };
      }
      if (current.status === "processing" && current.leaseExpiresAt > now) {
        return { claimed: false, busy: true, retryAt: current.leaseExpiresAt };
      }
      if (current.status === "retry_wait" && current.retryAt > now) {
        return { claimed: false, busy: true, retryAt: current.retryAt };
      }
      const attempts = Number(current.attempts || 0) + 1;
      if (attempts > maxAttempts) {
        await txn.put(key, {
          ...current,
          status: "dead_letter",
          attempts: attempts - 1,
          leaseId: null,
          leaseExpiresAt: null,
          retryAt: null,
          updatedAt: now,
        });
        return { claimed: false, status: "dead_letter" };
      }
      const leaseId = this.makeLeaseId();
      if (typeof leaseId !== "string" || leaseId.length < 16 || leaseId.length > 128) {
        throw new TypeError("Milestone outbox lease must be a unique opaque token");
      }
      await txn.put(key, {
        ...current,
        status: "processing",
        attempts,
        leaseId,
        leaseExpiresAt: now + leaseMs,
        retryAt: null,
        updatedAt: now,
      });
      return {
        claimed: true,
        claim: {
          key, userId, kind,
          revision: current.revision,
          leaseId,
          attempts,
          idempotencyKey: "bot005-milestone:" + this.guildId + ":" + userId + ":" + kind,
          payload: current.payload,
        },
      };
    });
    if (!claimResult.claimed) return claimResult;

    const claim = claimResult.claim;
    try {
      const payload = await this.cipher.decrypt(
        claim.payload,
        this.associatedData(userId) + ":milestone:" + kind,
      );
      const published = await upsertMilestone(Object.freeze({
        ...payload,
        idempotencyKey: claim.idempotencyKey,
      }));
      if (published?.synchronized !== true ||
          (payload.visibility === "public" &&
            (typeof published.postId !== "string" || !/^\d{15,22}$/.test(published.postId))) ||
          (payload.visibility !== "public" && published.postId !== null)) {
        throw new Error("milestone_upsert_receipt_invalid");
      }

      const completed = await this.storage.transaction(async (txn) => {
        const current = await txn.get(claim.key);
        if (!current || current.status !== "processing" ||
            current.leaseId !== claim.leaseId || current.revision !== claim.revision ||
            current.leaseExpiresAt <= this.now()) return false;
        const dataKey = recordKey(this.guildId, userId);
        const envelope = await txn.get(dataKey);
        if (envelope === undefined) return false;
        const profile = await this.cipher.decrypt(envelope, this.associatedData(userId));
        if (!profile || profile.userId !== userId ||
            !validateMilestone(profile[kind], kind === "anniversary")) return false;
        const updatedProfile = {
          ...profile,
          [kind]: { ...profile[kind], post: published.postId },
          updatedAt: this.now(),
        };
        await txn.put(dataKey, await this.cipher.encrypt(updatedProfile, this.associatedData(userId)));
        await txn.put(claim.key, {
          ...current,
          status: "completed",
          postId: published.postId,
          completedAt: this.now(),
          updatedAt: this.now(),
          leaseId: null,
          leaseExpiresAt: null,
          retryAt: null,
          lastError: null,
        });
        return true;
      });
      return completed
        ? { completed: true, postId: published.postId, idempotencyKey: claim.idempotencyKey }
        : { completed: false, superseded: true };
    } catch (error) {
      const failure = await this.storage.transaction(async (txn) => {
        const current = await txn.get(claim.key);
        if (!current || current.status !== "processing" || current.leaseId !== claim.leaseId) {
          return { recorded: false, superseded: true };
        }
        const code = typeof error?.code === "string" ? error.code
          : typeof error?.message === "string" ? error.message : "";
        const lastError = /^[A-Za-z0-9:_-]{1,96}$/.test(code) ? code : "milestone_upsert_failed";
        const deadLetter = claim.attempts >= maxAttempts;
        const retryAt = deadLetter ? null : this.now() + Math.min(60_000, 1000 * (2 ** (claim.attempts - 1)));
        await txn.put(claim.key, {
          ...current,
          status: deadLetter ? "dead_letter" : "retry_wait",
          lastError,
          retryAt,
          updatedAt: this.now(),
          leaseId: null,
          leaseExpiresAt: null,
        });
        return { recorded: true, deadLetter, retryAt };
      });
      return { completed: false, ...failure };
    }
  }

  async getReceipt(interactionId) {
    if (!validSnowflake(interactionId)) throw new TypeError("Interaction ID is invalid");
    return (await this.storage.get(receiptKey(this.guildId, interactionId))) ?? null;
  }
}
