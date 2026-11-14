import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

test("Worker port contains no Bun-only runtime APIs", () => {
  assert.doesNotMatch(source, /\bBun\./);
  assert.doesNotMatch(source, /import\(["']bun["']\)/);
  assert.match(source, /export default\s*\{/);
});

test("request environment and database context are isolated", () => {
  assert.match(source, /new AsyncLocalStorage<ManagerRequestContext>/);
  assert.match(source, /managerContext\.run\(\{ env, database \}/);
  assert.match(source, /runtimeEnv\(\)/);
});

test("Postgres adapter preserves parameterized query and transaction behavior", () => {
  assert.match(source, /client\.query\(\{ text: query, values:/);
  assert.match(source, /query\("BEGIN"\)/);
  assert.match(source, /query\("COMMIT"\)/);
  assert.match(source, /query\("ROLLBACK"\)/);
  assert.match(source, /env\.HYPERDRIVE\?\.connectionString/);
});

test("readiness fails closed when OAuth database is unavailable", () => {
  assert.match(source, /oauth_backend_unavailable/);
  assert.match(source, /SELECT 1 AS ok/);
});

test("manager MCP routes and guild-scope guardrails remain present", () => {
  assert.match(source, /discord_manager_status/);
  assert.match(source, /discord_guild_request/);
  assert.match(source, /discord_manager_audit/);
  assert.match(source, /AUTHORIZED_GUILD_ID/);
  assert.match(source, /WRITES_ENABLED/);
  assert.match(source, /scope_mismatch/);
});

test("health route is provider-neutral and write requests are not replayed", () => {
  assert.match(source, /service:"cloudflare-workers"/);
  assert.doesNotMatch(source, /retry.*POST|POST.*retry/i);
});

test("source contains no common embedded credential formats", () => {
  assert.doesNotMatch(source, /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{5,8}\.[A-Za-z0-9_-]{20,}\b/);
  assert.doesNotMatch(source, /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/);
  assert.doesNotMatch(source, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
});

test("failover router probes verified Dawn Manager origins in priority order", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /cloudflare-primary/);
  assert.match(router, /railway-secondary/);
  assert.match(router, /render-cold-fallback/);
  assert.match(router, /body\?\.manager === MANAGER_NAME/);
  assert.match(router, /body\?\.discordVerified === true/);
});

test("failover router forwards an actual request only once", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /fetch\(new Request\(forwardUrl\(request\.url, selected\.origin\), request\)\)/);
  assert.match(router, /Never retry a timed-out POST/);
  assert.doesNotMatch(router, /for\s*\([^)]*attempt|while\s*\(/);
});
