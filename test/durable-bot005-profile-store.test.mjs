import test from "node:test";
import assert from "node:assert/strict";
import { DurableBot005ProfileStore, createBot005ProfileCipher } from "../src/durable-bot005-profile-store.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const USER = "1569000000000000002";
const INTERACTION_A = "1569000000000000001";
const INTERACTION_B = "1569000000000000003";

class MemoryStorage {
  constructor({ failCommit = false } = {}) {
    this.values = new Map();
    this.pending = Promise.resolve();
    this.failCommit = failCommit;
  }
  async get(key) { return structuredClone(this.values.get(key)); }
  async transaction(callback) {
    const execute = async () => {
      const snapshot = new Map([...this.values].map(([key, value]) => [key, structuredClone(value)]));
      const txn = {
        get: async (key) => structuredClone(snapshot.get(key)),
        put: async (key, value) => snapshot.set(key, structuredClone(value)),
      };
      const result = await callback(txn);
      if (this.failCommit) throw new Error("storage_commit_failed");
      this.values = snapshot;
      return result;
    };
    const promise = this.pending.then(execute, execute);
    this.pending = promise.catch(() => {});
    return promise;
  }
}

function fakeCipher() {
  const records = new Map();
  let index = 0;
  return {
    records,
    async encrypt(value, aad) {
      const key = String(++index);
      records.set(key, structuredClone(value));
      return { version: 1, algorithm: "fake", iv: "iv", ciphertext: key, aad };
    },
    async decrypt(envelope, aad) {
      if (envelope.aad !== aad) throw new Error("wrong_aad");
      const value = records.get(envelope.ciphertext);
      if (!value) throw new Error("missing_ciphertext");
      return structuredClone(value);
    },
  };
}

function submission(kind, values, interactionId = INTERACTION_A, userId = USER) {
  return {
    status: "ready",
    interactionId,
    guildId: GUILD,
    applicationId: APP,
    userId,
    kind,
    values,
  };
}

function store(storage = new MemoryStorage(), cipher = fakeCipher(), options = {}) {
  return {
    storage, cipher,
    instance: new DurableBot005ProfileStore(storage, {
      guildId: GUILD, applicationId: APP, cipher,
      now: () => 1_800_000_000_000,
      ...options,
    }),
  };
}

test("stores member profile and milestones encrypted, merging fields per user", async () => {
  const setup = store();
  const profile = await setup.instance.apply(submission("profile", {
    about: "Hello", tiktok: "creator", instagram: "creator_ig", visibility: "private",
  }));
  assert.equal(profile.committed, true);
  assert.equal(profile.version, 1);
  assert.deepEqual(await setup.instance.get(USER), {
    userId: USER,
    profile: { about: "Hello", tiktok: "creator", instagram: "creator_ig", visibility: "private" },
    birthday: { date: "", year: "", visibility: "private", post: null },
    anniversary: { date: "", year: "", visibility: "private", post: null },
    version: 1, createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000,
  });
  assert.equal(JSON.stringify([...setup.storage.values.values()]).includes("Hello"), false);

  await setup.instance.apply(submission("birthday", { date: "02-29", year: "1988", visibility: "public" }, INTERACTION_B));
  const merged = await setup.instance.get(USER);
  assert.equal(merged.profile.about, "Hello");
  assert.deepEqual(merged.birthday, { date: "02-29", year: "1988", visibility: "public", post: null });
  assert.equal(merged.version, 2);
});

test("same interaction is idempotent and cannot change another user's receipt", async () => {
  const setup = store();
  const data = { about: "", tiktok: "", instagram: "", visibility: "private" };
  const first = await setup.instance.apply(submission("profile", data));
  const duplicate = await setup.instance.apply(submission("profile", {
    about: "different", tiktok: "", instagram: "", visibility: "private",
  }));
  assert.equal(first.duplicate, false);
  assert.deepEqual(duplicate, { committed: true, duplicate: true, receiptId: first.receiptId });
  assert.equal((await setup.instance.get(USER)).profile.about, "");
  assert.equal((await setup.instance.getReceipt(INTERACTION_A)).userId, USER);
});

test("serializes concurrent submissions so different profile sections do not overwrite each other", async () => {
  const setup = store();
  await Promise.all([
    setup.instance.apply(submission("profile", {
      about: "Concurrent", tiktok: "", instagram: "", visibility: "private",
    }, INTERACTION_A)),
    setup.instance.apply(submission("birthday", {
      date: "04-23", year: "", visibility: "private",
    }, INTERACTION_B)),
  ]);
  const result = await setup.instance.get(USER);
  assert.equal(result.profile.about, "Concurrent");
  assert.equal(result.birthday.date, "04-23");
  assert.equal(result.version, 2);
});

test("rejects mismatched guild/application, invalid data, and malformed submissions", async () => {
  const setup = store();
  await assert.rejects(() => setup.instance.apply({
    ...submission("profile", { about: "", tiktok: "", instagram: "", visibility: "private" }),
    guildId: "1565048205970767993",
  }), /identity or data validation/);
  await assert.rejects(() => setup.instance.apply({
    ...submission("profile", { about: "", tiktok: "", instagram: "", visibility: "private" }),
    applicationId: "1565304619838742599",
  }), /identity or data validation/);
  await assert.rejects(() => setup.instance.apply(submission("birthday", {
    date: "02-30", year: "", visibility: "private",
  })), /identity or data validation/);
});

test("failed transaction commits neither the profile row nor the receipt", async () => {
  const storage = new MemoryStorage({ failCommit: true });
  const setup = store(storage);
  await assert.rejects(() => setup.instance.apply(submission("profile", {
    about: "Not persisted", tiktok: "", instagram: "", visibility: "private",
  })), /storage_commit_failed/);
  assert.equal(storage.values.size, 0);
});

test("AES-GCM profile cipher encrypts and authenticates guild/user-bound records", async () => {
  const cipher = createBot005ProfileCipher("11".repeat(32));
  const data = { privateYear: "1988", date: "02-29" };
  const aad = "bot005-profile:v1:" + GUILD + ":" + APP + ":" + USER;
  const envelope = await cipher.encrypt(data, aad);
  assert.equal(envelope.algorithm, "A256GCM");
  assert.equal(JSON.stringify(envelope).includes("1988"), false);
  assert.deepEqual(await cipher.decrypt(envelope, aad), data);
  await assert.rejects(() => cipher.decrypt(envelope, aad + ":wrong"), /authentication_failed/);
});
