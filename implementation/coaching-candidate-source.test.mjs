import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const botPath = new URL("../candidate/bot-005/blickymania-bot-005.ts", import.meta.url);
const relayPath = new URL("../candidate/coaching/one-on-one-coaching-interaction-relay.ts", import.meta.url);
const ownerPath = new URL("./fenced-discord-gateway-owner.mjs", import.meta.url);

test("Bot 005 candidate uses the HTTPS workflow client and no Railway-internal coaching host", async () => {
  const source = await readFile(botPath, "utf8");
  assert.match(source, /createCoachingWorkflowClientFromEnv/);
  assert.match(source, /coachingWorkflow\.forward\(payload\)/);
  assert.match(source, /COACHING_WORKFLOW_URL/);
  assert.doesNotMatch(source, /coaching-workflow\.railway\.internal/);
  assert.doesNotMatch(source, /await\s+client\.login\(token\)/);
});

test("Bot 005 candidate installs the owner guard before registering application listeners", async () => {
  const source = await readFile(botPath, "utf8");
  const prepareAt = source.indexOf("prepareFencedDiscordGatewayOwner");
  const firstListenerAt = source.indexOf("client.on(");
  const firstOnceAt = source.indexOf("client.once(");
  assert.ok(prepareAt >= 0);
  assert.ok(firstListenerAt > prepareAt);
  assert.ok(firstOnceAt > prepareAt);
  assert.match(source, /BOT005_DEPLOYMENT_ID/);
  assert.match(source, /GATEWAY_LEASE_URL/);
  assert.match(source, /LEASE_SERVICE_TOKEN/);
  assert.match(source, /FENCE_REQUEST_TOKEN/);
  assert.match(source, /waitUntilReady\(30000\)/);
  assert.match(source, /preparedGatewayOwner\.shutdown\("identity_verification_failed"\)/);
});

test("Coaching Relay candidate preserves its separate Gateway but moves both readiness and interaction calls to HTTPS client", async () => {
  const source = await readFile(relayPath, "utf8");
  assert.match(source, /createCoachingWorkflowClientFromEnv/);
  assert.match(source, /coachingWorkflow\.checkReady\(\)/);
  assert.match(source, /coachingWorkflow\.forward\(i\)/);
  assert.match(source, /COACHING_WORKFLOW_URL/);
  assert.doesNotMatch(source, /coaching-workflow\.railway\.internal/);
  assert.match(source, /new WebSocket\(/);
  assert.doesNotMatch(source, /momentum-movement:bot-005-gateway/);
});

test("prepared owner composes the Cloudflare lease client and deployment-specific Worker fence requester", async () => {
  const source = await readFile(ownerPath, "utf8");
  assert.match(source, /createCloudflareGatewayLeaseStore/);
  assert.match(source, /createCloudflareFenceRequester/);
  assert.match(source, /createRemoteFencedCloudflareLeaseStore/);
  assert.match(source, /fenceRequestToken/);
  assert.match(source, /deployment/);
  assert.match(source, /client\.login\(botToken\)/);
  assert.match(source, /destroyGateway: async/);
});

test("candidate Relay and Bot 005 are separate Gateway workloads, not a shared lease", async () => {
  const bot = await readFile(botPath, "utf8");
  const relay = await readFile(relayPath, "utf8");
  assert.match(bot, /momentum-movement:bot-005-gateway/);
  assert.match(relay, /raw Discord Gateway/);
  assert.doesNotMatch(relay, /prepareFencedDiscordGatewayOwner/);
});
