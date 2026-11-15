import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const packageJson = JSON.parse(read("./package.json"));
const dockerfile = read("./Dockerfile");
const entry = read("./index.ts");
const recovered = read("./blickymania-bot-005.ts");
const separator = "\n---\n";
const bodyStart = recovered.indexOf(separator);
assert.notEqual(bodyStart, -1, "recovered source header separator must exist");

test("executable entrypoint is the recovered candidate body with required Discord imports", () => {
  const expected =
    'import { Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits } from "discord.js";\n\n' +
    recovered.slice(bodyStart + separator.length).replace(/^\n+/, "");
  assert.equal(entry, expected);
  assert.match(entry, /prepareFencedDiscordGatewayOwner/);
  assert.match(entry, /createRulesAcceptanceHandler/);
  assert.match(entry, /ensureRulesAcceptanceButton/);
});

test("worker package uses its own exact Discord.js dependency and entrypoint", () => {
  assert.equal(packageJson.scripts.start, "bun run index.ts");
  assert.equal(packageJson.dependencies["discord.js"], "14.27.0");
  assert.deepEqual(Object.keys(packageJson.dependencies), ["discord.js"]);
});

test("Docker image includes every transitive local runtime module", () => {
  const required = [
    "implementation/coaching-workflow-client.mjs",
    "implementation/coaching-workflow-auth.mjs",
    "implementation/rules-acceptance.mjs",
    "implementation/fenced-discord-gateway-owner.mjs",
    "implementation/gateway-owner-supervisor.mjs",
    "implementation/cloudflare-gateway-lease-client.mjs",
    "implementation/cloudflare-fence-request-client.mjs",
    "implementation/discord-gateway-ownership-guards.mjs",
    "implementation/shared-gateway-lease.mjs",
    "cloudflare/gateway-lease-coordinator.mjs"
  ];
  for (const path of required) assert.ok(dockerfile.includes("COPY " + path + " "), path);
});

test("Docker install is pinned to Bun and requires a committed frozen lockfile", () => {
  assert.match(dockerfile, /^FROM oven\/bun:1\.4\.4/m);
  assert.match(dockerfile, /COPY candidate\/bot-005\/bun\.lock /);
  assert.match(dockerfile, /bun install --production --frozen-lockfile/);
});

test("no production secret is baked into the image", () => {
  assert.doesNotMatch(dockerfile, /(?:DISCORD_BOT_TOKEN|LEASE_SERVICE_TOKEN|FENCE_REQUEST_TOKEN|PROFILE_DATA_ENCRYPTION_KEY)=/);
});

test("standby entrypoint exposes health without any Discord token or Gateway client", () => {
  const standby = read("./standby.ts");
  assert.match(standby, /Bun\.serve/);
  assert.match(standby, /url\.pathname === "\/healthz"/);
  assert.match(standby, /mode: "standby"/);
  assert.match(standby, /gatewayConnected: false/);
  assert.doesNotMatch(standby, /DISCORD_BOT_TOKEN|\.login\(|new Client/);
  assert.ok(dockerfile.includes("COPY candidate/bot-005/standby.ts "));
  assert.equal(packageJson.scripts.standby, "bun run standby.ts");
});

test("application readiness is fail-closed until the existing rules button and encrypted vault are verified", () => {
  const readyHandler = entry.slice(entry.indexOf("client.once(Events.ClientReady"));
  assert.match(readyHandler, /rulesAcceptanceReady=await ensureRulesAcceptanceButton\(guild\)/);
  assert.match(readyHandler, /if\(!rulesAcceptanceReady\)throw Error\("rules_acceptance_not_verified"\)/);
  assert.match(readyHandler, /await preparedGatewayOwner\.shutdown\("application_readiness_failed"\)/);
  assert.doesNotMatch(readyHandler, /rules_acceptance_not_ready/);
  assert.match(entry, /guildVerified,rulesAcceptanceReady,readOnly/);
  assert.match(entry, /status:ready&&guildVerified&&rulesAcceptanceReady\?200:503/);
});

test("existing encrypted vault is fully validated before application readiness", () => {
  const loadStart = entry.indexOf("async function load()");
  const loadEnd = entry.indexOf("function empty(", loadStart);
  const loadSource = entry.slice(loadStart, loadEnd);
  const ensureStart = entry.indexOf("async function ensureRulesAcceptanceButton");
  const ensureEnd = entry.indexOf("client.on(Events.InteractionCreate", ensureStart);
  const ensureSource = entry.slice(ensureStart, ensureEnd);
  const readyStart = entry.indexOf("client.once(Events.ClientReady");
  const readyEnd = entry.indexOf("client.on(Events.ShardDisconnect", readyStart);
  const readySource = entry.slice(readyStart, readyEnd);
  assert.match(loadSource, /decodeEncryptedMemberVaultPage\(messages,A,unseal\)/);
  assert.match(ensureSource, /await key\(\);\s*await load\(\);/);
  assert.match(readySource, /rulesAcceptanceReady=await ensureRulesAcceptanceButton\(guild\)/);
  assert.match(readySource, /if\(!rulesAcceptanceReady\)throw Error/);
  assert.match(readySource, /preparedGatewayOwner\.shutdown\("application_readiness_failed"\)/);
  assert.match(entry, /guildVerified,rulesAcceptanceReady,readOnly/);
});
