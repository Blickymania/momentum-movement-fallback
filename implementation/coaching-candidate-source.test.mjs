import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const botPath = new URL("../candidate/bot-005/blickymania-bot-005.ts", import.meta.url);
const relayPath = new URL("../candidate/coaching/one-on-one-coaching-interaction-relay.ts", import.meta.url);
const ownerPath = new URL("./fenced-discord-gateway-owner.mjs", import.meta.url);
const workflowPath = new URL("../candidate/coaching/one-on-one-coaching-workflow.ts", import.meta.url);

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
  assert.match(bot, /prepareFencedDiscordGatewayOwner/);
  assert.match(relay, /raw Discord Gateway/);
  assert.doesNotMatch(relay, /prepareFencedDiscordGatewayOwner/);
});


test("Bot 005 and the separate Relay use distinct authenticated workflow identities", async () => {
  const bot = await readFile(botPath, "utf8");
  const relay = await readFile(relayPath, "utf8");
  assert.match(bot, /COACHING_WORKFLOW_SOURCE!=="bot005"/);
  assert.match(bot, /COACHING_WORKFLOW_AUTH_SECRET/);
  assert.match(relay, /COACHING_WORKFLOW_SOURCE!=="coaching-relay"/);
  assert.match(relay, /COACHING_WORKFLOW_AUTH_SECRET/);
});

test("candidate Coaching Workflow verifies sender HMAC and timestamp before parsing or accepting the body", async () => {
  const source = await readFile(workflowPath, "utf8");
  const routeAt = source.lastIndexOf('url.pathname==="/interaction"');
  const authAt = source.indexOf("verifyCoachingRequest", routeAt);
  const parseAt = source.indexOf("JSON.parse(rawBody)", routeAt);
  const acceptedAt = source.indexOf("Response.json({accepted:true})", routeAt);
  assert.ok(routeAt >= 0);
  assert.ok(authAt > routeAt);
  assert.ok(parseAt > authAt);
  assert.ok(acceptedAt > parseAt);
  assert.match(source, /COACHING_BOT005_AUTH_SECRET/);
  assert.match(source, /COACHING_RELAY_AUTH_SECRET/);
  assert.match(source, /botAuthSecret===relayAuthSecret/);
  assert.match(source, /Coaching sender credentials must be distinct from each other and the Discord bot token/);
  assert.match(source, /Coaching idempotency credential must be unique/);
  assert.match(source, /status:401/);
  assert.match(source, /x-coaching-signature/);
});


test("candidate Coaching Workflow requires a durable idempotency claim before dispatch", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /COACHING_IDEMPOTENCY_URL/);
  assert.match(source, /COACHING_IDEMPOTENCY_TOKEN/);
  assert.match(source, /coaching\/interaction\/claim/);
  const routeAt = source.lastIndexOf('url.pathname==="/interaction"');
  const claimAt = source.indexOf("claimResponse=await fetch(coachingIdempotencyEndpoint", routeAt);
  const acceptedAt = source.indexOf("Response.json({accepted:true})", routeAt);
  assert.ok(claimAt > routeAt);
  assert.ok(acceptedAt > claimAt);
  assert.match(source, /if\(!claimPayload\.claimed\)return Response\.json\(\{duplicate:true\}\)/);
  assert.match(source, /COACHING_IDEMPOTENCY_TOKEN/);
});

test("Cloudflare Durable Object persists coaching interaction IDs separately from the Bot 005 lease row", async () => {
  const coordinator = await readFile(new URL("../cloudflare/gateway-lease-coordinator.mjs", import.meta.url), "utf8");
  assert.match(coordinator, /CREATE TABLE IF NOT EXISTS coaching_interaction_claims/);
  assert.match(coordinator, /COACHING_INTERACTION_RETENTION_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(coordinator, /claimCoachingInteraction/);
  assert.match(coordinator, /PRIMARY KEY/);
  assert.match(coordinator, /ON CONFLICT \(interaction_id\) DO NOTHING/);
});

test("Cloudflare Worker protects the durable coaching claim route with a separate secret", async () => {
  const worker = await readFile(new URL("../cloudflare/worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /COACHING_IDEMPOTENCY_TOKEN/);
  assert.match(worker, /coaching\/interaction\/claim/);
  assert.match(worker, /sameSecret\(candidate, token\)/);
  assert.match(worker, /source !== "bot005" && body\.source !== "coaching-relay"/);
});


test("candidate Coaching Workflow does not disclose internal bootstrap error strings on public health routes", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /errorPresent:Boolean\(lastError\)/);
  assert.doesNotMatch(source, /Response\.json\(\{ready,lastError\}/);
  assert.doesNotMatch(source, /Response\.json\(\{error:"not-ready",lastError\}/);
});


test("Bot 005 and Coaching Relay candidates bind sender identity and HMAC secret away from the Discord token", async () => {
  const bot = await readFile(botPath, "utf8");
  const relay = await readFile(relayPath, "utf8");
  assert.match(bot, /COACHING_WORKFLOW_SOURCE!=="bot005"/);
  assert.match(bot, /coachingAuthSecret===token/);
  assert.match(relay, /COACHING_WORKFLOW_SOURCE!=="coaching-relay"/);
  assert.match(relay, /coachingAuthSecret===token\(\)/);
});
