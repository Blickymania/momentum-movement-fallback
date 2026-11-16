import { reconcileLiveNowPanel } from "./live-now-panel-recovery.mjs";

const V2_PANEL_BUTTON = "ln2:post";
const LEGACY_PANEL_BUTTONS = new Set(["cw:live:open", "live-now:v1:open"]);

function buttonIds(message) {
  const ids = [];
  const visit = (components) => {
    for (const component of components ?? []) {
      if (component?.type === 2 && typeof component.custom_id === "string") {
        ids.push(component.custom_id);
      }
      visit(component?.components);
    }
  };
  visit(message?.components);
  return ids;
}

/**
 * Creates the callback used by the existing LIVE NOW passive audit.
 * This adds no timer. The caller invokes it from the already-existing audit cadence.
 */
export function createLiveNowPanelRepairAudit({
  scanMessages,
  publishOrAdoptPanel,
  getPanelId,
  setPanelId,
  botId,
}) {
  if (typeof scanMessages !== "function") throw new TypeError("scanMessages must be a function");
  if (typeof publishOrAdoptPanel !== "function") throw new TypeError("publishOrAdoptPanel must be a function");
  if (typeof getPanelId !== "function") throw new TypeError("getPanelId must be a function");
  if (typeof setPanelId !== "function") throw new TypeError("setPanelId must be a function");
  if (typeof botId !== "string" || !/^\d{17,22}$/.test(botId)) {
    throw new TypeError("botId must be a valid Discord application ID");
  }

  let inFlight = false;
  return async function runLiveNowPanelRepairAudit() {
    if (inFlight) return { status: "skipped", reason: "audit-in-flight", repaired: false };
    inFlight = true;
    try {
      return await reconcileLiveNowPanel({
        scan: async () => {
          const messages = await scanMessages(10);
          if (!Array.isArray(messages)) throw new TypeError("Discord message scan must return an array");
          const v2PanelIds = [];
          const legacyPanelIds = [];
          for (const message of messages) {
            if (String(message?.author?.id ?? "") !== botId) continue;
            const ids = buttonIds(message);
            if (ids.includes(V2_PANEL_BUTTON)) v2PanelIds.push(message.id);
            if (ids.some((id) => LEGACY_PANEL_BUTTONS.has(id))) legacyPanelIds.push(message.id);
          }
          return { v2PanelIds, legacyPanelIds };
        },
        publishPanel: async () => {
          const panelId = await publishOrAdoptPanel();
          setPanelId(panelId);
          return panelId;
        },
        storedPanelId: getPanelId(),
      });
    } finally {
      inFlight = false;
    }
  };
}
