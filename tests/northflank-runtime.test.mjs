import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const docker = await readFile(new URL("../northflank/Dockerfile", import.meta.url), "utf8");
const manager = await readFile(new URL("../render/manager.ts", import.meta.url), "utf8");
const deployment = await readFile(new URL("../northflank/DEPLOYMENT.md", import.meta.url), "utf8");

test("Northflank image uses the same pinned Bun runtime as the existing Render candidate", () => {
  assert.match(docker, /^FROM oven\/bun:1\.4\.4/m);
  assert.match(docker, /COPY render\/manager\.ts \.\/manager\.ts/);
  assert.match(docker, /ENV PORT=3000/);
  assert.match(docker, /EXPOSE 3000/);
  assert.match(docker, /CMD \["bun", "run", "manager\.ts"\]/);
});

test("Northflank runtime retains the HTTP Manager and does not start a Discord Gateway", () => {
  assert.match(manager, /Bun\.serve\(/);
  assert.ok(manager.includes('if(u.pathname!=="/mcp"'));
  assert.doesNotMatch(manager, /client\.login\(/);
});

test("Manager readiness verifies OAuth PostgreSQL before advertising ready", () => {
  assert.match(manager, /if\(Bun\.env\.MCP_OAUTH_ENABLED==="true"\)/);
  assert.match(manager, /if\(!mcpOAuthDb\)return reply\(\{status:"not_ready",reason:"oauth_database_unconfigured"\},503\)/);
  assert.match(manager, /mcpOAuthDb\.unsafe\("SELECT 1 AS ok"\)/);
  assert.match(manager, /oauthDatabaseVerified/);
  assert.match(manager, /reason:"oauth_database_unavailable"/);
});

test("Manager static bearer authentication supports neutral name and legacy compatibility", () => {
  assert.match(manager, /Bun\.env\.MCP_INTERNAL_BEARER_TOKEN\|\|Bun\.env\.RAILWAY_SERVICE_KEY/);
  assert.match(manager, /DEPLOYMENT_PLATFORM\|\|"unknown"/);
});

test("Northflank deployment guidance prevents accidental paid provisioning and public database exposure", () => {
  assert.match(deployment, /no credit card required/i);
  assert.match(deployment, /do not assume the full Manager \+ database stack fits for free/i);
  assert.match(deployment, /do not select Pay as You Go/i);
  assert.match(deployment, /Do not expose the database publicly/);
  assert.match(deployment, /WRITES_ENABLED=false/);
  assert.match(deployment, /oauthDatabaseVerified: true/);
  assert.match(deployment, /No Northflank account resources, secrets, databases, or routes have been created/);
});

test("Northflank deployment documentation does not contain runtime credentials", () => {
  assert.doesNotMatch(deployment, /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{5,8}\.[A-Za-z0-9_-]{20,}\b/);
  assert.doesNotMatch(deployment, /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/);
  assert.doesNotMatch(deployment, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
});

test("Northflank cannot enter the router before shared OAuth data parity is proven", () => {
  assert.ok(/do not configure `NORTHFLANK_MANAGER_ORIGIN` in the router until/i.test(deployment));
  assert.ok(deployment.includes("row-count/digest reconciliation"));
  assert.ok(deployment.includes("same logical OAuth data plane"));
  assert.ok(deployment.includes("a rehearsed restore path"));
});

test("Cloudflare Worker fallback verifies PostgreSQL before reporting database readiness", async () => {
  const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const readinessStart = worker.indexOf('if(u.pathname==="/readyz"');
  const dbCheck = worker.indexOf('await mcpOAuthQuery(mcpOAuthDb(),"SELECT 1 AS ok")', readinessStart);
  const dbReadyFlag = worker.indexOf("oauthDatabaseVerified:true", readinessStart);
  assert.ok(readinessStart >= 0 && dbCheck > readinessStart && dbReadyFlag > dbCheck);
  assert.ok(worker.includes('reason:"oauth_backend_unavailable"'));
});

test("Northflank Manager OAuth database variable must point to the shared data plane", () => {
  assert.ok(deployment.includes("connection string for the selected shared OAuth data plane"));
  assert.ok(deployment.includes("must not point to an isolated Northflank-only production database"));
});

test("Neon Free candidate documents current quota and fixed scale-to-zero limits", () => {
  assert.match(deployment, /100 CU-hours per project per month/);
  assert.match(deployment, /1 GB PostgreSQL storage per project/);
  assert.match(deployment, /5 GB public network transfer per project per month/);
  assert.match(deployment, /Scale-to-zero after five minutes/i);
  assert.match(deployment, /reactivation.*few hundred milliseconds/i);
});

test("Neon Free candidate documents network security and no artificial keepalive", () => {
  assert.match(deployment, /IP Allow is currently a Scale-plan feature/);
  assert.match(deployment, /strong unique credentials, TLS, secret-manager-only storage, least privilege/);
  assert.match(deployment, /No periodic ping or keepalive should be added/);
});

test("Northflank compute estimate does not claim full Manager plus database fits in Sandbox", () => {
  assert.match(deployment, /nf-compute-50.*\$12\.00\/month/);
  assert.match(deployment, /nf-compute-100-2.*\$24\.00\/month/);
  assert.match(deployment, /nf-compute-200:.*\$48\.00\/month/);
  assert.match(deployment, /\$25\.17\/month and exceeds the Sandbox allowance/);
});
