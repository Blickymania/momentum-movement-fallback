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

function isModalOpeningButton(customId, interaction) {
  return PROFILE_MODAL_IDS.has(customId) ||
    (customId === "coach:request" && !interaction.guild_id) ||
    /^coach:staff:(clarify|schedule|note):/.test(customId) ||
    /^coach:dm:(respond|details):/.test(customId);
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
        route.handlers.length !== 1 || route.handlers[0] !== "bot005") {
      return blocked("bot005_route_not_verified");
    }

    const type = Number(interaction.type);
    if (type === 1) return ready({ type: 1 });

    if (type === 2 && CORE_COMMANDS.includes(interaction.data?.name)) {
      return ready({ type: 5 });
    }

    const customId = typeof interaction.data?.custom_id === "string"
      ? interaction.data.custom_id
      : "";
    if (!customId) return blocked("bot005_interaction_shape_unhandled");

    if (type === 3) {
      if (isModalOpeningButton(customId, interaction)) {
        if (!buildModalResponse) return blocked("bot005_modal_builder_required");
        let response;
        try { response = buildModalResponse(interaction); }
        catch { return blocked("bot005_modal_builder_failed"); }
        if (!response || response.type !== 9 || !response.data ||
            typeof response.data !== "object" || Array.isArray(response.data)) {
          return blocked("bot005_modal_response_invalid");
        }
        return ready(response);
      }
      return ready({ type: 6 });
    }

    if (type === 5) {
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
