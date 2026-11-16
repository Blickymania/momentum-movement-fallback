import test from "node:test";
import assert from "node:assert/strict";
import { createLiveNowPanelRepairAudit } from "./live-now-panel-repair-adapter.mjs";

const BOT_ID = "1565304619838742598";
const OTHER_BOT_ID = "1565304619838742599";
const ID_A = "1566082077768814717";
const ID_B = "1572000000000000001";

function panel(id, authorId = BOT_ID, customId = "ln2:post") {
  return {
    id,
    author: { id: authorId },
    components: [{ type: 17, components: [{ type: 1, components: [{ type: 2, custom_id: customId }] }] }],
  };
}

function createAudit({ snapshots, initialPanelId = null, publish = async () => ID_B }) {
  let storedPanelId = initialPanelId;
  let publishes = 0;
  let scans = 0;
  const audit = createLiveNowPanelRepairAudit({
    scanMessages: async (pages) => {
      assert.equal(pages, 10);
      const result = snapshots[Math.min(scans, snapshots.length - 1)];
      scans += 1;
      return structuredClone(result);
    },
    publishOrAdoptPanel: async () => { publishes += 1; return publish(); },
    getPanelId: () => storedPanelId,
    setPanelId: (id) => { storedPanelId = id; },
    botId: BOT_ID,
  });
  return { audit, get storedPanelId() { return storedPanelId; }, get publishes() { return publishes; }, get scans() { return scans; } };
}

test("healthy panel is not rewritten", async () => {
  const fixture = createAudit({ snapshots: [[panel(ID_A)]], initialPanelId: ID_A });
  const result = await fixture.audit();
  assert.equal(result.status, "healthy");
  assert.equal(fixture.publishes, 0);
  assert.equal(fixture.scans, 1);
});

test("missing panel is published once and the runtime ID is updated", async () => {
  const fixture = createAudit({ snapshots: [[], [panel(ID_B)]], initialPanelId: ID_A });
  const result = await fixture.audit();
  assert.equal(result.status, "repaired");
  assert.equal(result.panelId, ID_B);
  assert.equal(fixture.storedPanelId, ID_B);
  assert.equal(fixture.publishes, 1);
  assert.equal(fixture.scans, 2);
});

test("sole panel is adopted when process memory has a stale ID", async () => {
  const fixture = createAudit({ snapshots: [[panel(ID_B)], [panel(ID_B)]], initialPanelId: ID_A });
  const result = await fixture.audit();
  assert.equal(result.status, "repaired");
  assert.equal(result.repair, "adopt-existing-panel");
  assert.equal(fixture.storedPanelId, ID_B);
  assert.equal(fixture.publishes, 1);
});

test("messages from other bot identities cannot satisfy or block the audit", async () => {
  const fixture = createAudit({
    snapshots: [[panel(ID_A, OTHER_BOT_ID), panel(ID_B, BOT_ID)]],
    initialPanelId: ID_B,
  });
  const result = await fixture.audit();
  assert.equal(result.status, "healthy");
  assert.equal(result.panelId, ID_B);
  assert.equal(fixture.publishes, 0);
});

test("duplicate V2 panels are held", async () => {
  const fixture = createAudit({ snapshots: [[panel(ID_A), panel(ID_B)]], initialPanelId: ID_A });
  const result = await fixture.audit();
  assert.equal(result.status, "held");
  assert.equal(result.reason, "duplicate-v2-panels");
  assert.equal(fixture.publishes, 0);
});

test("legacy panel conflicts are held", async () => {
  const fixture = createAudit({ snapshots: [[panel(ID_A, BOT_ID, "cw:live:open")]], initialPanelId: null });
  const result = await fixture.audit();
  assert.equal(result.status, "held");
  assert.equal(result.reason, "legacy-panel-conflict");
  assert.equal(fixture.publishes, 0);
});

test("overlapping audit invocation is skipped while first scan is in progress", async () => {
  let releaseScan;
  let scanStarted;
  const started = new Promise((resolve) => { scanStarted = resolve; });
  const blocked = new Promise((resolve) => { releaseScan = resolve; });
  let storedPanelId = ID_A;
  const audit = createLiveNowPanelRepairAudit({
    scanMessages: async () => { scanStarted(); await blocked; return [panel(ID_A)]; },
    publishOrAdoptPanel: async () => ID_A,
    getPanelId: () => storedPanelId,
    setPanelId: (id) => { storedPanelId = id; },
    botId: BOT_ID,
  });
  const first = audit();
  await started;
  const second = await audit();
  assert.deepEqual(second, { status: "skipped", reason: "audit-in-flight", repaired: false });
  releaseScan();
  assert.equal((await first).status, "healthy");
});

test("invalid scan response fails closed", async () => {
  const audit = createLiveNowPanelRepairAudit({
    scanMessages: async () => null,
    publishOrAdoptPanel: async () => ID_B,
    getPanelId: () => null,
    setPanelId: () => {},
    botId: BOT_ID,
  });
  await assert.rejects(audit(), /must return an array/);
});
