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
  assert.match(deployment, /Do not select Pay as You Go/);
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
