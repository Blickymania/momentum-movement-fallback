const SNOWFLAKE = /^\d{17,22}$/;

function validateSnapshot(snapshot, label) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new TypeError(`${label} scan must return an object`);
  }
  const { v2PanelIds, legacyPanelIds } = snapshot;
  if (!Array.isArray(v2PanelIds) || !Array.isArray(legacyPanelIds)) {
    throw new TypeError(`${label} scan must include v2PanelIds and legacyPanelIds arrays`);
  }
  for (const id of [...v2PanelIds, ...legacyPanelIds]) {
    if (typeof id !== "string" || !SNOWFLAKE.test(id)) {
      throw new TypeError(`${label} scan returned an invalid Discord message ID`);
    }
  }
  return snapshot;
}

function classify({ v2PanelIds, legacyPanelIds, storedPanelId }) {
  if (v2PanelIds.length > 1) {
    return { action: "hold", reason: "duplicate-v2-panels" };
  }
  if (legacyPanelIds.length > 0) {
    return { action: "hold", reason: "legacy-panel-conflict" };
  }
  if (v2PanelIds.length === 0) {
    return { action: "repair", repair: "publish-missing-panel" };
  }
  const [livePanelId] = v2PanelIds;
  if (livePanelId !== storedPanelId) {
    return { action: "repair", repair: "adopt-existing-panel", panelId: livePanelId };
  }
  return { action: "healthy", panelId: livePanelId };
}

/**
 * Reconciles the persistent LIVE NOW dashboard using injected read/publish operations.
 * The publisher must itself be idempotent and must refuse duplicate or legacy panels.
 * This helper deliberately performs one publish/adopt attempt, followed by a fresh scan.
 */
export async function reconcileLiveNowPanel({ scan, publishPanel, storedPanelId }) {
  if (typeof scan !== "function") throw new TypeError("scan must be a function");
  if (typeof publishPanel !== "function") throw new TypeError("publishPanel must be a function");
  if (storedPanelId !== null && storedPanelId !== undefined &&
      (typeof storedPanelId !== "string" || !SNOWFLAKE.test(storedPanelId))) {
    throw new TypeError("storedPanelId must be a valid Discord message ID or null");
  }

  const before = validateSnapshot(await scan(), "Initial");
  const plan = classify({ ...before, storedPanelId });

  if (plan.action === "healthy") {
    return { status: "healthy", panelId: plan.panelId, repaired: false };
  }
  if (plan.action === "hold") {
    return { status: "held", reason: plan.reason, count: before.v2PanelIds.length, legacy: before.legacyPanelIds.length, repaired: false };
  }

  // The existing V2 publisher adopts a sole V2 panel or creates one only when
  // neither V2 nor legacy panels exist. It also performs Discord read-back.
  const publishedPanelId = await publishPanel({ repair: plan.repair });
  if (typeof publishedPanelId !== "string" || !SNOWFLAKE.test(publishedPanelId)) {
    throw new Error("LIVE NOW publisher returned no valid message ID");
  }

  const after = validateSnapshot(await scan(), "Verification");
  const verified = classify({ ...after, storedPanelId: publishedPanelId });
  if (verified.action !== "healthy") {
    throw new Error(`LIVE NOW panel repair did not verify: ${verified.reason || verified.repair || verified.action}`);
  }

  return {
    status: "repaired",
    repair: plan.repair,
    panelId: publishedPanelId,
    repaired: true,
  };
}
