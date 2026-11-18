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


test("writes milestone outbox atomically and encrypts its private payload", async () => {
  const setup = store();
  await setup.instance.apply(submission("birthday", {
    date: "04-23", year: "", visibility: "public",
  }));
  const row = [...setup.storage.values.entries()].find(([key]) => key.includes("milestone-outbox"));
  assert.ok(row);
  assert.equal(row[1].status, "pending");
  assert.equal(row[1].payload.aad.endsWith(":milestone:birthday"), true);
  assert.equal(JSON.stringify(row[1]).includes("04-23"), false);
  const decoded = await setup.instance.getMilestoneOutbox(USER, "birthday");
  assert.deepEqual(decoded.payload, {
    userId: USER, kind: "birthday", date: "04-23", visibility: "public",
    previousPostId: null, revision: 1,
  });
});

test("milestone outbox retries through stable idempotency key and records one public post", async () => {
  let clock = 1_800_000_000_000;
  const setup = store(new MemoryStorage(), fakeCipher(), { now: () => clock });
  await setup.instance.apply(submission("birthday", {
    date: "04-23", year: "", visibility: "public",
  }));
  const posts = new Map();
  let calls = 0;
  const upsert = async ({ idempotencyKey }) => {
    calls += 1;
    const postId = posts.get(idempotencyKey) ?? "1569000000000000009";
    posts.set(idempotencyKey, postId);
    if (calls === 1) {
      const error = new Error("timeout");
      error.code = "timeout";
      throw error;
    }
    return { synchronized: true, postId };
  };
  const first = await setup.instance.processMilestoneOutbox(USER, "birthday", upsert);
  assert.equal(first.completed, false);
  assert.equal(first.recorded, true);
  assert.equal(first.deadLetter, false);
  assert.equal(posts.size, 1);
  clock = first.retryAt;
  const second = await setup.instance.processMilestoneOutbox(USER, "birthday", upsert);
  assert.equal(second.completed, true);
  assert.equal(second.postId, "1569000000000000009");
  assert.equal(second.idempotencyKey, "bot005-milestone:" + GUILD + ":" + USER + ":birthday");
  assert.equal(calls, 2);
  assert.equal(posts.size, 1);
  assert.equal((await setup.instance.get(USER)).birthday.post, "1569000000000000009");
  assert.equal((await setup.instance.getMilestoneOutbox(USER, "birthday")).status, "completed");
});

test("private milestone outbox reconciles deletion of a prior public post", async () => {
  const setup = store();
  await setup.instance.apply(submission("birthday", {
    date: "04-23", year: "", visibility: "public",
  }));
  const posts = new Map();
  const publicPost = await setup.instance.processMilestoneOutbox(USER, "birthday", async ({ idempotencyKey }) => {
    const postId = "1569000000000000009";
    posts.set(idempotencyKey, postId);
    return { synchronized: true, postId };
  });
  assert.equal(publicPost.completed, true);
  const next = submission("birthday", {
    date: "04-23", year: "", visibility: "private",
  }, INTERACTION_B);
  await setup.instance.apply(next);
  const hidden = await setup.instance.processMilestoneOutbox(USER, "birthday", async ({ idempotencyKey, previousPostId }) => {
    assert.equal(previousPostId, "1569000000000000009");
    posts.delete(idempotencyKey);
    return { synchronized: true, postId: null };
  });
  assert.equal(hidden.completed, true);
  assert.equal(posts.size, 0);
  assert.equal((await setup.instance.get(USER)).birthday.post, null);
});

test("new milestone revision cannot overlap an active publisher and is reconciled after lease expiry", async () => {
  let clock = 1_800_000_000_000;
  const setup = store(new MemoryStorage(), fakeCipher(), { now: () => clock });
  await setup.instance.apply(submission("birthday", {
    date: "04-23", year: "", visibility: "public",
  }, INTERACTION_A));
  let releaseFirst;
  const firstPublish = new Promise((resolve) => { releaseFirst = resolve; });
  const remotePosts = new Map();
  const keys = [];
  let calls = 0;
  const upsert = async ({ idempotencyKey, revision, visibility }) => {
    calls += 1;
    keys.push({ idempotencyKey, revision, visibility });
    if (calls === 1) {
      await firstPublish;
      remotePosts.set(idempotencyKey, "1569000000000000009");
      return { synchronized: true, postId: "1569000000000000009" };
    }
    if (visibility === "private") {
      remotePosts.delete(idempotencyKey);
      return { synchronized: true, postId: null };
    }
    throw new Error("unexpected_visibility");
  };
  const active = setup.instance.processMilestoneOutbox(USER, "birthday", upsert, { leaseMs: 1000 });
  await Promise.resolve();
  const leaseExpiry = (await setup.instance.getMilestoneOutbox(USER, "birthday")).leaseExpiresAt;
  assert.equal((await setup.instance.processMilestoneOutbox(USER, "birthday", upsert, { leaseMs: 1000 })).busy, true);

  await setup.instance.apply(submission("birthday", {
    date: "04-23", year: "", visibility: "private",
  }, INTERACTION_B));
  const updated = await setup.instance.getMilestoneOutbox(USER, "birthday");
  assert.equal(updated.status, "processing");
  assert.equal(updated.leaseExpiresAt, leaseExpiry);
  assert.equal(updated.payload.revision, 2);

  releaseFirst();
  const oldWorker = await active;
  assert.deepEqual(oldWorker, { completed: false, superseded: true });
  assert.equal((await setup.instance.get(USER)).birthday.post, null);
  assert.equal((await setup.instance.getMilestoneOutbox(USER, "birthday")).status, "processing");

  clock = leaseExpiry;
  const repaired = await setup.instance.processMilestoneOutbox(USER, "birthday", upsert, { leaseMs: 1000 });
  assert.equal(repaired.completed, true);
  assert.equal(repaired.postId, null);
  assert.equal(remotePosts.size, 0);
  assert.equal(calls, 2);
  assert.equal(keys[0].idempotencyKey, keys[1].idempotencyKey);
  assert.deepEqual(keys.map(({ revision, visibility }) => ({ revision, visibility })), [
    { revision: 1, visibility: "public" },
    { revision: 2, visibility: "private" },
  ]);
  assert.equal((await setup.instance.get(USER)).birthday.post, null);
  assert.equal((await setup.instance.getMilestoneOutbox(USER, "birthday")).status, "completed");
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
