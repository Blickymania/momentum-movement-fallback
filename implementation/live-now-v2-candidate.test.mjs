import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourceUrl = new URL("../candidate/live-now-v2/index.ts", import.meta.url);
const packageUrl = new URL("../candidate/live-now-v2/package.json", import.meta.url);
const dockerUrl = new URL("../candidate/live-now-v2/Dockerfile", import.meta.url);
const readmeUrl = new URL("../candidate/live-now-v2/README.md", import.meta.url);
const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
const dockerfile = await readFile(dockerUrl, "utf8");
const readme = await readFile(readmeUrl, "utf8");
const source = await readFile(sourceUrl, "utf8");

test("candidate imports the reusable panel repair adapter", () => {
  assert.match(source, /import \{ createLiveNowPanelRepairAudit \} from "\.\.\/\.\.\/implementation\/live-now-panel-repair-adapter\.mjs"/);
});

test("candidate binds the adapter to the existing scanner and guarded publisher", () => {
  assert.match(source, /const runLiveNowPanelRepairAudit=createLiveNowPanelRepairAudit\(\{/);
  assert.match(source, /scanMessages:scan/);
  assert.match(source, /publishOrAdoptPanel:publishPanel/);
  assert.match(source, /getPanelId:\(\)=>panelId/);
  assert.match(source, /setPanelId:id=>\{panelId=id\}/);
  assert.match(source, /botId:A/);
  assert.match(source, /const result=await runLiveNowPanelRepairAudit\(\)/);
});

test("active Gateway mode is rejected before HTTP server startup", () => {
  const activeDeclaration = source.indexOf('ACTIVE=Bun.env.LIVE_V2_ACTIVE==="true"');
  const activationGuard = source.indexOf("if(ACTIVE)throw Error(\"LIVE NOW V2 candidate refuses Gateway activation");
  const httpServer = source.indexOf("const service=Bun.serve");
  assert.ok(activeDeclaration >= 0, "active flag declaration must exist");
  assert.ok(activationGuard > activeDeclaration, "activation guard must follow the flag declaration");
  assert.ok(httpServer > activationGuard, "activation guard must precede HTTP startup");
  assert.equal((source.match(/LIVE NOW V2 candidate refuses Gateway activation/g) || []).length, 1);
});

test("the existing 30-minute passive audit cadence is reused exactly once", () => {
  const timers = source.match(/setInterval\(\(\)=>void passiveAudit\(\),1800000\)/g) || [];
  assert.equal(timers.length, 1);
  assert.match(source, /async function passiveAudit\(\)[\s\S]*?runLiveNowPanelRepairAudit\(\)/);
});

test("recovered production snapshot is not imported as a mutable runtime target", () => {
  assert.doesNotMatch(source, /recovered\/railway\/live-now-v2-shadow-engine/);
  assert.match(source, /Source-only LIVE NOW V2 migration candidate/);
  assert.match(source, /ownership lease\/fence/);
});

test("candidate package pins all external dependencies exactly", () => {
  assert.deepEqual(packageJson.dependencies, {
    "discord.js": "14.27.0",
    "sharp": "0.34.5",
    "tiktok-live-connector": "2.5.0",
  });
  assert.match(source, /from "discord\.js"/);
  assert.match(source, /from "tiktok-live-connector"/);
  assert.match(source, /from "sharp"/);
  assert.doesNotMatch(source, /from "(?:discord\.js|tiktok-live-connector|sharp)@/);
});

test("candidate Dockerfile refuses an unlocked dependency install", () => {
  assert.match(dockerfile, /bun install --production --frozen-lockfile/);
  assert.match(dockerfile, /oven\/bun:1\.4\.4/);
});

test("candidate release notes record the TikTok dependency's license and provider dependency", () => {
  assert.match(readme, /AGPL-3\.0-only/);
  assert.match(readme, /Euler Stream/);
  assert.match(readme, /not an official TikTok API client/);
});

test("candidate contains no literal bot token assignment", () => {
  assert.doesNotMatch(source, /DISCORD_BOT_TOKEN\s*=\s*["'][A-Za-z0-9._-]{20,}["']/);
});
