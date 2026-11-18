import { CORE_COMMANDS } from "./gateway-handler-registry.mjs";

const PROFILE_MODAL_IDS = new Set([
  "membercard:edit",
  "mp26:edit",
  "mompass:edit",
  "mp26:date:b",
  "mompass:birthday",
  "profilev7:birthday",
  "profilev7:milestone:birthday:mine",
  "mp26:date:a",
  "mompass:anniversary",
  "profilev7:anniversary",
  "profilev7:milestone:anniversary:mine",
]);

const PROFILE_MODAL_FIELDS = Object.freeze({
  profile: {
    customId: "memberdata:profile",
    title: "Edit My Member Profile",
    fields: [
      ["about", "About Me", true, false, 450, "A short introduction"],
      ["tiktok", "TikTok Username", false, false, 32, "Without @"],
      ["instagram", "Instagram Username", false, false, 32, "Without @"],
      ["visibility", "Profile Visibility", false, true, 7, "private or public"],
    ],
  },
  birthday: {
    customId: "memberdata:birthday",
    title: "My Birthday",
    fields: [
      ["date", "Birthday (MM-DD)", false, true, 5, "04-23"],
      ["year", "Birth Year (private)", false, false, 4, "Optional"],
      ["visibility", "Visibility", false, true, 7, "private or public"],
    ],
  },
  anniversary: {
    customId: "memberdata:anniversary",
    title: "My Streaming Anniversary",
    fields: [
      ["date", "Streaming Start Date (MM-DD)", false, true, 5, "08-15"],
      ["year", "Streaming Start Year", false, true, 4, "2021"],
      ["visibility", "Visibility", false, true, 7, "private or public"],
    ],
  },
});

const PROFILE_MODAL_KIND = new Map([
  ["membercard:edit", "profile"],
  ["mp26:edit", "profile"],
  ["mompass:edit", "profile"],
  ["mp26:date:b", "birthday"],
  ["mompass:birthday", "birthday"],
  ["profilev7:birthday", "birthday"],
  ["profilev7:milestone:birthday:mine", "birthday"],
  ["mp26:date:a", "anniversary"],
  ["mompass:anniversary", "anniversary"],
  ["profilev7:anniversary", "anniversary"],
  ["profilev7:milestone:anniversary:mine", "anniversary"],
]);

function isCoachModalOpeningButton(customId, interaction) {
  return (customId === "coach:request" && !interaction.guild_id) ||
    /^coach:staff:(clarify|schedule|note):/.test(customId) ||
    /^coach:dm:(respond|details):/.test(customId);
}

function buildProfileModalResponse(customId) {
  const kind = PROFILE_MODAL_KIND.get(customId);
  const definition = PROFILE_MODAL_FIELDS[kind];
  if (!definition) return null;
  return {
    type: 9,
    data: {
      custom_id: definition.customId,
      title: definition.title,
      components: definition.fields.map(([fieldId, label, paragraph, required, maxLength, placeholder]) => ({
        type: 1,
        components: [{
          type: 4,
          custom_id: fieldId,
          label,
          style: paragraph ? 2 : 1,
          required,
          max_length: maxLength,
          placeholder,
        }],
      })),
    },
  };
}

function isMultiStepCoachModal(customId) {
  return customId.startsWith("coach:request");
}

function blocked(reason) {
  return Object.freeze({ status: "blocked", reason });
}

function ready(response) {
  return Object.freeze({ status: "ready", response: Object.freeze(response) });
}

/**
 * Select Bot 005's initial interaction response from the recovered handler
 * behavior. Modal payload builders remain explicit dependencies; this planner
 * never substitutes a defer response when a source path opens a modal.
 */
export function createBot005InteractionAckPlanner({ buildModalResponse, buildMultiStepModalResponse } = {}) {
  for (const [name, fn] of [
    ["buildModalResponse", buildModalResponse],
    ["buildMultiStepModalResponse", buildMultiStepModalResponse],
  ]) {
    if (fn !== undefined && typeof fn !== "function") {
      throw new TypeError(name + " must be a function when provided");
    }
  }

  return function planBot005Interaction(interaction, route) {
    if (!interaction || typeof interaction !== "object" || Array.isArray(interaction) ||
        route?.status !== "routed" || !Array.isArray(route.handlers) ||
        route.handlers.length !== 1 ||
        !["bot005", "bot005-profile-modal", "bot005-ping", "bot005-status", "bot005-rules"].includes(route.handlers[0])) {
      return blocked("bot005_route_not_verified");
    }

    const profileModalOnly = route.handlers[0] === "bot005-profile-modal";
    const pingOnly = route.handlers[0] === "bot005-ping";
    const statusOnly = route.handlers[0] === "bot005-status";
    const rulesOnly = route.handlers[0] === "bot005-rules";
    const type = Number(interaction.type);
    if (profileModalOnly && type !== 5) return blocked("bot005_profile_modal_route_type_mismatch");
    if (pingOnly && (type !== 2 || interaction.data?.name !== "ping")) {
      return blocked("bot005_ping_route_type_mismatch");
    }
    if (statusOnly && (type !== 2 || !["bot-status", "botstatus"].includes(interaction.data?.name))) {
      return blocked("bot005_status_route_type_mismatch");
    }
    if (rulesOnly && (type !== 2 || interaction.data?.name !== "rules")) {
      return blocked("bot005_rules_route_type_mismatch");
    }
    if (type === 1) return ready({ type: 1 });

    if (type === 2 && interaction.guild_id && CORE_COMMANDS.includes(interaction.data?.name)) {
      return ready({ type: 5 });
    }

    const customId = typeof interaction.data?.custom_id === "string"
      ? interaction.data.custom_id
      : "";
    if (!customId) return blocked("bot005_interaction_shape_unhandled");

    if (type === 3) {
      if (PROFILE_MODAL_IDS.has(customId)) {
        if (!interaction.guild_id) return blocked("bot005_profile_modal_guild_required");
        const response = buildProfileModalResponse(customId);
        return response ? ready(response) : blocked("bot005_modal_response_invalid");
      }
      if (isCoachModalOpeningButton(customId, interaction)) {
        if (!buildModalResponse) return blocked("bot005_coach_modal_builder_required");
        let response;
        try { response = buildModalResponse(interaction); }
        catch { return blocked("bot005_coach_modal_builder_failed"); }
        if (!response || response.type !== 9 || !response.data ||
            typeof response.data !== "object" || Array.isArray(response.data)) {
          return blocked("bot005_modal_response_invalid");
        }
        return ready(response);
      }
      return ready({ type: 6 });
    }

    if (type === 5) {
      if (profileModalOnly && !["memberdata:profile", "memberdata:birthday", "memberdata:anniversary"].includes(customId)) {
        return blocked("bot005_profile_modal_selector_not_supported");
      }
      if (isMultiStepCoachModal(customId)) {
        if (!buildMultiStepModalResponse) return blocked("bot005_multistep_modal_handler_required");
        let response;
        try { response = buildMultiStepModalResponse(interaction); }
        catch { return blocked("bot005_multistep_modal_handler_failed"); }
        if (!response || !Number.isInteger(response.type) || ![4, 5, 6, 7].includes(response.type)) {
          return blocked("bot005_multistep_modal_response_invalid");
        }
        return ready(response);
      }
      return ready({ type: 5 });
    }

    return blocked("bot005_interaction_type_unhandled");
  };
}

export { PROFILE_MODAL_IDS };
