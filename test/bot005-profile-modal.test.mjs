import test from "node:test";
import assert from "node:assert/strict";
import { parseBot005ProfileModal } from "../src/bot005-profile-modal.mjs";

const GUILD = "1565048205970767992";
const APP = "1565304619838742598";
const base = {
  id: "1569000000000000001",
  type: 5,
  guild_id: GUILD,
  application_id: APP,
  member: { user: { id: "1569000000000000002" } },
};

function submit(custom_id, values, extra = {}) {
  return {
    ...base,
    ...extra,
    data: {
      custom_id,
      components: Object.entries(values).map(([custom_id, value]) => ({
        type: 1,
        components: [{ type: 4, custom_id, value }],
      })),
    },
  };
}

test("normalizes the recovered profile modal fields and strips leading social @", () => {
  const result = parseBot005ProfileModal(submit("memberdata:profile", {
    about: "Hello",
    tiktok: "@creator",
    instagram: "@creator_ig",
    visibility: "public",
  }), { guildId: GUILD, applicationId: APP });
  assert.deepEqual(result, {
    status: "ready",
    interactionId: base.id,
    guildId: GUILD,
    applicationId: APP,
    userId: "1569000000000000002",
    kind: "profile",
    values: {
      about: "Hello",
      tiktok: "creator",
      instagram: "creator_ig",
      visibility: "public",
    },
  });
});

test("accepts valid leap-day birthday with optional private year", () => {
  const result = parseBot005ProfileModal(submit("memberdata:birthday", {
    date: "02-29",
    year: "",
    visibility: "private",
  }), { guildId: GUILD, applicationId: APP });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.values, { date: "02-29", year: "", visibility: "private" });
});

test("requires a valid streaming anniversary year and date", () => {
  const good = parseBot005ProfileModal(submit("memberdata:anniversary", {
    date: "08-15", year: "2021", visibility: "public",
  }), { guildId: GUILD, applicationId: APP });
  assert.equal(good.status, "ready");
  assert.deepEqual(good.values, { date: "08-15", year: "2021", visibility: "public" });
  assert.equal(parseBot005ProfileModal(submit("memberdata:anniversary", {
    date: "08-15", year: "", visibility: "private",
  }), { guildId: GUILD, applicationId: APP }).reason, "profile_modal_year_invalid");
});

test("blocks wrong type, guild/application, malformed fields, unknown selectors and invalid dates", () => {
  assert.equal(parseBot005ProfileModal({ ...submit("memberdata:profile", { visibility: "public" }), type: 3 }, {
    guildId: GUILD, applicationId: APP,
  }).reason, "profile_modal_type_invalid");
  assert.equal(parseBot005ProfileModal(submit("memberdata:profile", { visibility: "public" }, {
    guild_id: "1565048205970767993",
  }), { guildId: GUILD, applicationId: APP }).reason, "profile_modal_owner_mismatch");
  assert.equal(parseBot005ProfileModal(submit("memberdata:profile", { visibility: "public" }, {
    application_id: "1565304619838742599",
  }), { guildId: GUILD, applicationId: APP }).reason, "profile_modal_owner_mismatch");
  assert.equal(parseBot005ProfileModal(submit("memberdata:unknown", { x: "y" }), {
    guildId: GUILD, applicationId: APP,
  }).reason, "profile_modal_selector_unhandled");
  assert.equal(parseBot005ProfileModal(submit("memberdata:birthday", {
    date: "02-30", year: "", visibility: "private",
  }), { guildId: GUILD, applicationId: APP }).reason, "profile_modal_date_invalid");
  assert.equal(parseBot005ProfileModal(submit("memberdata:profile", {
    visibility: "private", extra: "no",
  }), { guildId: GUILD, applicationId: APP }).reason, "profile_modal_fields_invalid");
});

test("preserves source-compatible private fallback and caps profile text fields", () => {
  const result = parseBot005ProfileModal(submit("memberdata:profile", {
    about: "x".repeat(500),
    tiktok: "@".repeat(40),
    instagram: "y".repeat(40),
    visibility: "unexpected",
  }), { guildId: GUILD, applicationId: APP });
  assert.equal(result.status, "ready");
  assert.equal(result.values.about.length, 450);
  assert.equal(result.values.tiktok.length, 32);
  assert.equal(result.values.instagram.length, 32);
  assert.equal(result.values.visibility, "private");
});
