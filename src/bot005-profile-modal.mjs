const PROFILE_ID = "memberdata:profile";
const BIRTHDAY_ID = "memberdata:birthday";
const ANNIVERSARY_ID = "memberdata:anniversary";

function blocked(reason) {
  return Object.freeze({ status: "blocked", reason });
}

function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

function readFields(components) {
  if (!Array.isArray(components) || components.length < 1 || components.length > 5) return null;
  const fields = new Map();
  for (const row of components) {
    if (!row || row.type !== 1 || !Array.isArray(row.components) || row.components.length !== 1) return null;
    const input = row.components[0];
    if (!input || input.type !== 4 || typeof input.custom_id !== "string" ||
        typeof input.value !== "string" || fields.has(input.custom_id)) return null;
    fields.set(input.custom_id, input.value);
  }
  return fields;
}

function validDate(value) {
  const match = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(value);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(2000, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? match[1] + "-" + match[2]
    : null;
}

function validYear(value) {
  return /^(19|20)\d{2}$/.test(value);
}

/**
 * Validate and normalize the recovered Bot 005 member profile modal submits.
 * This function performs no storage or Discord writes.
 */
export function parseBot005ProfileModal(interaction, {
  guildId,
  applicationId,
} = {}) {
  if (!interaction || typeof interaction !== "object" || Array.isArray(interaction) ||
      Number(interaction.type) !== 5) return blocked("profile_modal_type_invalid");
  if (!validSnowflake(guildId) || !validSnowflake(applicationId) ||
      String(interaction.guild_id ?? "") !== guildId ||
      String(interaction.application_id ?? "") !== applicationId) {
    return blocked("profile_modal_owner_mismatch");
  }
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!validSnowflake(userId) || !validSnowflake(interaction.id)) {
    return blocked("profile_modal_user_or_interaction_invalid");
  }
  const customId = interaction.data?.custom_id;
  const fields = readFields(interaction.data?.components);
  if (!fields) return blocked("profile_modal_fields_invalid");

  if (customId === PROFILE_ID) {
    const allowed = new Set(["about", "tiktok", "instagram", "visibility"]);
    if ([...fields.keys()].some((key) => !allowed.has(key)) ||
        !fields.has("visibility")) return blocked("profile_modal_fields_invalid");
    return Object.freeze({
      status: "ready",
      interactionId: interaction.id,
      userId,
      kind: "profile",
      values: Object.freeze({
        about: (fields.get("about") ?? "").slice(0, 450),
        tiktok: (fields.get("tiktok") ?? "").replace(/^@/, "").slice(0, 32),
        instagram: (fields.get("instagram") ?? "").replace(/^@/, "").slice(0, 32),
        visibility: fields.get("visibility") === "public" ? "public" : "private",
      }),
    });
  }

  if (customId === BIRTHDAY_ID || customId === ANNIVERSARY_ID) {
    const anniversary = customId === ANNIVERSARY_ID;
    const allowed = new Set(["date", "year", "visibility"]);
    if ([...fields.keys()].some((key) => !allowed.has(key)) ||
        !fields.has("date") || !fields.has("visibility")) {
      return blocked("profile_modal_fields_invalid");
    }
    const date = validDate(fields.get("date"));
    const year = (fields.get("year") ?? "").trim();
    if (!date) return blocked("profile_modal_date_invalid");
    if ((anniversary && !validYear(year)) || (year && !validYear(year))) {
      return blocked("profile_modal_year_invalid");
    }
    return Object.freeze({
      status: "ready",
      interactionId: interaction.id,
      userId,
      kind: anniversary ? "anniversary" : "birthday",
      values: Object.freeze({
        date,
        year,
        visibility: fields.get("visibility") === "public" ? "public" : "private",
      }),
    });
  }

  return blocked("profile_modal_selector_unhandled");
}

export { PROFILE_ID, BIRTHDAY_ID, ANNIVERSARY_ID };
