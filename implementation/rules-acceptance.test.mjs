import test from "node:test";
import assert from "node:assert/strict";
import {
  RULES_ACCEPTANCE_TARGET,
  decodeEncryptedMemberVaultPage,
  RULES_ACCEPTANCE_VERSION,
  addRulesAcceptanceButton,
  applyRulesAcceptance,
  createRulesAcceptanceHandler,
  isRulesAcceptanceInteraction
} from "./rules-acceptance.mjs";

const initialComponents = [{
  type: 17,
  components: [
    { type: 10, content: "## 📜 Community Rules" },
    { type: 1, components: [
      { type: 2, custom_id: "dcp:rules:0:std26c", label: "Guidelines" },
      { type: 2, custom_id: "dcp:rules:1:std26c", label: "Participation" }
    ] },
    { type: 14, divider: true },
    { type: 10, content: "Existing rules content" }
  ]
}];

function interaction(overrides = {}) {
  return {
    isButton: () => true,
    applicationId: RULES_ACCEPTANCE_TARGET.applicationId,
    guildId: RULES_ACCEPTANCE_TARGET.guildId,
    channelId: RULES_ACCEPTANCE_TARGET.channelId,
    message: {
      id: RULES_ACCEPTANCE_TARGET.messageId,
      author: { id: RULES_ACCEPTANCE_TARGET.applicationId }
    },
    customId: RULES_ACCEPTANCE_TARGET.customId,
    user: { id: "123456789012345678", send: async () => ({ ok: true }) },
    deferUpdate: async () => ({ ok: true }),
    ...overrides
  };
}

test("adds one acceptance row while preserving every existing rules component", () => {
  const result = addRulesAcceptanceButton(initialComponents);
  assert.equal(result.changed, true);
  assert.equal(result.components[0].components[0].content, "## 📜 Community Rules");
  assert.equal(result.components[0].components[1].components[0].custom_id, "dcp:rules:0:std26c");
  assert.equal(result.components[0].components[3].content, "Existing rules content");
  const buttonRows = result.components[0].components.filter(row =>
    row.type === 1 && row.components?.some(button => button.custom_id === RULES_ACCEPTANCE_TARGET.customId)
  );
  assert.equal(buttonRows.length, 1);
});

test("adding the button is idempotent and does not mutate the input", () => {
  const once = addRulesAcceptanceButton(initialComponents);
  const twice = addRulesAcceptanceButton(once.components);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.components, once.components);
  assert.equal(initialComponents[0].components.length, 4);
});

test("rejects a rules message without the expected dashboard container", () => {
  assert.throws(() => addRulesAcceptanceButton([{ type: 10, content: "Not a container" }]), /container/);
});

test("records an acceptance with the exact policy version and source message", () => {
  const initial = { userId: "123456789012345678", profile: { about: "preserve me" } };
  const result = applyRulesAcceptance(initial, "2026-11-14T23:00:00.000Z");
  assert.equal(result.changed, true);
  assert.equal(result.acceptedAt, "2026-11-14T23:00:00.000Z");
  assert.deepEqual(result.record.profile, initial.profile);
  assert.deepEqual(result.record.rulesAcceptance.current, {
    version: RULES_ACCEPTANCE_VERSION,
    acceptedAt: "2026-11-14T23:00:00.000Z",
    guildId: RULES_ACCEPTANCE_TARGET.guildId,
    channelId: RULES_ACCEPTANCE_TARGET.channelId,
    messageId: RULES_ACCEPTANCE_TARGET.messageId
  });
});

test("a repeat click for the same rules version preserves the original timestamp", () => {
  const first = applyRulesAcceptance({ userId: "123456789012345678" }, "2026-11-14T23:00:00.000Z");
  const second = applyRulesAcceptance(first.record, "2026-11-15T00:00:00.000Z");
  assert.equal(second.changed, false);
  assert.equal(second.acceptedAt, first.acceptedAt);
  assert.strictEqual(second.record, first.record);
});

test("a new rules version keeps prior acceptance history", () => {
  const prior = {
    userId: "123456789012345678",
    rulesAcceptance: {
      current: { version: "older-rules", acceptedAt: "2026-01-01T00:00:00.000Z" },
      history: []
    }
  };
  const result = applyRulesAcceptance(prior, "2026-11-14T23:00:00.000Z");
  assert.equal(result.changed, true);
  assert.equal(result.record.rulesAcceptance.history[0].version, "older-rules");
});

test("only the exact bot-authored rules message can record acceptance", () => {
  assert.equal(isRulesAcceptanceInteraction(interaction()), true);
  assert.equal(isRulesAcceptanceInteraction(interaction({ guildId: "wrong" })), false);
  assert.equal(isRulesAcceptanceInteraction(interaction({ channelId: "wrong" })), false);
  assert.equal(isRulesAcceptanceInteraction(interaction({ customId: "other" })), false);
  assert.equal(isRulesAcceptanceInteraction(interaction({
    message: { id: RULES_ACCEPTANCE_TARGET.messageId, author: { id: "not-the-bot" } }
  })), false);
});

test("first click saves once, acknowledges the interaction and sends one DM receipt", async () => {
  const saved = [];
  const notices = [];
  const handler = createRulesAcceptanceHandler({
    getMemberRecord: async id => ({ userId: id, profile: {} }),
    saveMemberRecord: async record => saved.push(record),
    notifyMember: async (_user, message) => notices.push(message),
    clock: () => new Date("2026-11-14T23:00:00.000Z")
  });
  const i = interaction();
  const result = await handler(i);
  assert.equal(result.persisted, true);
  assert.equal(result.changed, true);
  assert.equal(result.notified, true);
  assert.equal(saved.length, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /No roles or channel permissions were changed/);
});

test("repeated clicks do not rewrite the member record or resend a receipt", async () => {
  let record = { userId: "123456789012345678" };
  let saves = 0;
  let notices = 0;
  const handler = createRulesAcceptanceHandler({
    getMemberRecord: async () => record,
    saveMemberRecord: async next => { record = next; saves++; },
    notifyMember: async () => { notices++; },
    clock: () => new Date("2026-11-14T23:00:00.000Z")
  });
  await handler(interaction());
  const repeated = await handler(interaction());
  assert.equal(saves, 1);
  assert.equal(notices, 1);
  assert.equal(repeated.persisted, true);
  assert.equal(repeated.changed, false);
});

test("storage failures fail closed and do not claim acceptance", async () => {
  const notices = [];
  const handler = createRulesAcceptanceHandler({
    getMemberRecord: async id => ({ userId: id }),
    saveMemberRecord: async () => { throw new Error("vault unavailable"); },
    notifyMember: async (_user, message) => notices.push(message)
  });
  const result = await handler(interaction());
  assert.equal(result.persisted, false);
  assert.equal(result.changed, false);
  assert.match(notices[0], /has not been recorded/);
});

test("nonmatching interactions are ignored without acknowledgement or storage access", async () => {
  let reads = 0;
  const handler = createRulesAcceptanceHandler({
    getMemberRecord: async () => { reads++; return null; },
    saveMemberRecord: async () => { throw new Error("unexpected"); }
  });
  assert.equal(await handler(interaction({ customId: "dcp:rules:0:std26c" })), false);
  assert.equal(reads, 0);
});

test("simultaneous clicks for one member are serialized without duplicate vault writes", async () => {
  let releaseRead;
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  let reads = 0;
  let saves = 0;
  const handler = createRulesAcceptanceHandler({
    getMemberRecord: async id => { reads++; await readGate; return { userId: id }; },
    saveMemberRecord: async () => { saves++; },
    notifyMember: async () => {},
    clock: () => new Date("2026-11-14T23:00:00.000Z")
  });
  const first = handler(interaction());
  await new Promise(resolve => setImmediate(resolve));
  const second = await handler(interaction());
  assert.equal(second.busy, true);
  assert.equal(reads, 1);
  releaseRead();
  const firstResult = await first;
  assert.equal(firstResult.persisted, true);
  assert.equal(saves, 1);
});

test("encrypted vault page keeps the newest valid record per member and ignores unrelated messages", async () => {
  const records = await decodeEncryptedMemberVaultPage([
    { id: "1000000000000000001", author: { id: "bot" }, content: "MRV1.newest" },
    { id: "1000000000000000002", author: { id: "bot" }, content: "MRV1.older" },
    { id: "1000000000000000003", author: { id: "other" }, content: "MRV1.other-bot" },
    { id: "1000000000000000004", author: { id: "bot" }, content: "plain text" }
  ], "bot", async content => ({
    userId: content.endsWith("newest") || content.endsWith("older") ? "member-1" : "member-2",
    profile: { source: content }
  }));
  assert.equal(records.size, 1);
  assert.equal(records.get("member-1").messageId, "1000000000000000001");
  assert.equal(records.get("member-1").record.profile.source, "MRV1.newest");
});

test("an undecryptable encrypted vault record fails closed", async () => {
  await assert.rejects(
    decodeEncryptedMemberVaultPage([
      { id: "1000000000000000001", author: { id: "bot" }, content: "MRV1.corrupt" }
    ], "bot", async () => { throw new Error("authentication tag mismatch"); }),
    /member_vault_record_decryption_failed/
  );
});

test("an encrypted vault record without a valid member ID fails closed", async () => {
  await assert.rejects(
    decodeEncryptedMemberVaultPage([
      { id: "1000000000000000001", author: { id: "bot" }, content: "MRV1.invalid" }
    ], "bot", async () => ({ userId: "" })),
    /member_vault_record_invalid/
  );
});
