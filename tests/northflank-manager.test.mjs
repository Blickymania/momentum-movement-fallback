import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manager = await readFile(new URL("../render/manager.ts", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../render/Dockerfile", import.meta.url), "utf8");

test("Dawn Manager remains a Bun Docker workload without a provider-specific base image", () => {
  assert.match(dockerfile, /^FROM oven\/bun:1\.4\.4/m);
  assert.match(dockerfile, /COPY render\/manager\.ts \.\/manager\.ts/);
  assert.match(dockerfile, /ENV PORT=10000/);
  assert.match(dockerfile, /CMD \["bun", "run", "manager\.ts"\]/);
});

test("Manager health endpoints no longer identify Railway as the runtime", () => {
  assert.match(manager, /service:"dawn-dotta-http-manager"/);
  assert.doesNotMatch(manager, /service:"railway"/);
});

test("provider-neutral Manager key is preferred while legacy clients remain compatible", () => {
  assert.match(manager, /Bun\.env\.MANAGER_SERVICE_KEY\|\|Bun\.env\.RAILWAY_SERVICE_KEY/);
});

test("OAuth-enabled readiness fails closed unless Neon PostgreSQL and all OAuth tables are reachable", () => {
  const start = manager.indexOf('if(u.pathname==="/readyz"');
  const end = manager.indexOf('if(u.pathname==="/healthz"', start);
  assert.ok(start >= 0 && end > start, "readiness route must exist");
  const readiness = manager.slice(start, end);
  assert.match(readiness, /if\(mcpOAuthEnabled\(\)\)/);
  assert.match(readiness, /\\^\\\\d\{15,22\}\$/);
  assert.match(readiness, /mcpOAuthDb/);
  assert.match(readiness, /to_regclass\('public\.mcp_oauth_clients'\)/);
  assert.match(readiness, /oauth_database_unavailable/);
  assert.match(readiness, /oauth_schema_unavailable/);
  assert.doesNotMatch(readiness, /mcpOAuthEnsureSchema/);
});

test("test deployment keeps Discord writes disabled by default", () => {
  assert.match(manager, /writes:Bun\.env\.WRITES_ENABLED==="true"/);
  assert.match(manager, /if\(!c\.writes\)/);
});
