import test from "node:test";
import assert from "node:assert/strict";
import { reconcileLiveNowPanel } from "./live-now-panel-recovery.mjs";

const ID_A = "1566082077768814717";
const ID_B = "1572000000000000001";

function queueScan(snapshots) {
  let calls = 0;
  return async () => {
    const snapshot = snapshots[Math.min(calls, snapshots.length - 1)];
    calls += 1;
    return structuredClone(snapshot);
  };
}

test("healthy single dashboard is left untouched", async () => {
  let publishes = 0;
  const result = await reconcileLiveNowPanel({
    scan: queueScan([{ v2PanelIds: [ID_A], legacyPanelIds: [] }]),
    publishPanel: async () => { publishes += 1; return ID_A; },
    storedPanelId: ID_A,
  });
  assert.deepEqual(result, { status: "healthy", panelId: ID_A, repaired: false });
  assert.equal(publishes, 0);
});

test("missing panel is published once and verified by a second scan", async () => {
  let publishes = 0;
  const result = await reconcileLiveNowPanel({
    scan: queueScan([
      { v2PanelIds: [], legacyPanelIds: [] },
      { v2PanelIds: [ID_B], legacyPanelIds: [] },
    ]),
    publishPanel: async ({ repair }) => { publishes += 1; assert.equal(repair, "publish-missing-panel"); return ID_B; },
    storedPanelId: ID_A,
  });
  assert.deepEqual(result, { status: "repaired", repair: "publish-missing-panel", panelId: ID_B, repaired: true });
  assert.equal(publishes, 1);
});

test("a sole existing V2 panel is adopted when the in-memory ID is stale", async () => {
  let publishes = 0;
  const result = await reconcileLiveNowPanel({
    scan: queueScan([
      { v2PanelIds: [ID_B], legacyPanelIds: [] },
      { v2PanelIds: [ID_B], legacyPanelIds: [] },
    ]),
    publishPanel: async ({ repair }) => { publishes += 1; assert.equal(repair, "adopt-existing-panel"); return ID_B; },
    storedPanelId: ID_A,
  });
  assert.equal(result.status, "repaired");
  assert.equal(result.repair, "adopt-existing-panel");
  assert.equal(result.panelId, ID_B);
  assert.equal(publishes, 1);
});

test("multiple V2 dashboards are held without publishing or deleting", async () => {
  let publishes = 0;
  const result = await reconcileLiveNowPanel({
    scan: queueScan([{ v2PanelIds: [ID_A, ID_B], legacyPanelIds: [] }]),
    publishPanel: async () => { publishes += 1; return ID_B; },
    storedPanelId: ID_A,
  });
  assert.deepEqual(result, { status: "held", reason: "duplicate-v2-panels", count: 2, legacy: 0, repaired: false });
  assert.equal(publishes, 0);
});

test("legacy panel conflict is held without replacing or deleting it", async () => {
  let publishes = 0;
  const result = await reconcileLiveNowPanel({
    scan: queueScan([{ v2PanelIds: [], legacyPanelIds: [ID_A] }]),
    publishPanel: async () => { publishes += 1; return ID_B; },
    storedPanelId: null,
  });
  assert.deepEqual(result, { status: "held", reason: "legacy-panel-conflict", count: 0, legacy: 1, repaired: false });
  assert.equal(publishes, 0);
});

test("legacy panel conflict also blocks adoption of an existing V2 panel", async () => {
  let publishes = 0;
  const result = await reconcileLiveNowPanel({
    scan: queueScan([{ v2PanelIds: [ID_B], legacyPanelIds: [ID_A] }]),
    publishPanel: async () => { publishes += 1; return ID_B; },
    storedPanelId: ID_A,
  });
  assert.equal(result.status, "held");
  assert.equal(result.reason, "legacy-panel-conflict");
  assert.equal(publishes, 0);
});

test("publisher failure propagates so the caller can log a failed repair", async () => {
  await assert.rejects(
    reconcileLiveNowPanel({
      scan: queueScan([{ v2PanelIds: [], legacyPanelIds: [] }]),
      publishPanel: async () => { throw new Error("Discord POST failed"); },
      storedPanelId: null,
    }),
    /Discord POST failed/,
  );
});

test("a missing publisher ID fails closed", async () => {
  await assert.rejects(
    reconcileLiveNowPanel({
      scan: queueScan([{ v2PanelIds: [], legacyPanelIds: [] }]),
      publishPanel: async () => null,
      storedPanelId: null,
    }),
    /no valid message ID/,
  );
});

test("post-publish read-back must show exactly the publisher's single dashboard", async () => {
  await assert.rejects(
    reconcileLiveNowPanel({
      scan: queueScan([
        { v2PanelIds: [], legacyPanelIds: [] },
        { v2PanelIds: [], legacyPanelIds: [] },
      ]),
      publishPanel: async () => ID_B,
      storedPanelId: null,
    }),
    /did not verify/,
  );
});

test("post-publish duplicate dashboard fails closed", async () => {
  await assert.rejects(
    reconcileLiveNowPanel({
      scan: queueScan([
        { v2PanelIds: [], legacyPanelIds: [] },
        { v2PanelIds: [ID_A, ID_B], legacyPanelIds: [] },
      ]),
      publishPanel: async () => ID_B,
      storedPanelId: null,
    }),
    /did not verify/,
  );
});

test("invalid scan data is rejected before publishing", async () => {
  let publishes = 0;
  await assert.rejects(
    reconcileLiveNowPanel({
      scan: queueScan([{ v2PanelIds: ["not-a-snowflake"], legacyPanelIds: [] }]),
      publishPanel: async () => { publishes += 1; return ID_B; },
      storedPanelId: null,
    }),
    /invalid Discord message ID/,
  );
  assert.equal(publishes, 0);
});
