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

test("health route is provider-neutral and Discord writes use one upstream request", () => {
  assert.match(source, /service:"cloudflare-workers"/);
  assert.match(source, /const r=await fetch\(url,init\)/);
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

test("OAuth schema initialization retries after a failed setup", () => {
  assert.match(source, /mcpOAuthSchemaPromise=null;throw err/);
  assert.match(source, /await mcpOAuthSchemaPromise/);
});

test("authorization codes are consumed once under a row lock", () => {
  assert.match(source, /SELECT \* FROM mcp_oauth_authorization_codes WHERE code_hash=\$1 AND expires_at>now\(\) AND consumed_at IS NULL FOR UPDATE/);
  assert.match(source, /UPDATE mcp_oauth_authorization_codes SET consumed_at=now\(\) WHERE code_hash=\$1/);
});

test("refresh-token rotation locks and revokes the prior token atomically", () => {
  assert.match(source, /SELECT \* FROM mcp_oauth_refresh_tokens WHERE token_hash=\$1 AND expires_at>now\(\) AND revoked_at IS NULL FOR UPDATE/);
  assert.match(source, /UPDATE mcp_oauth_refresh_tokens SET revoked_at=now\(\),replaced_by=\$1 WHERE token_hash=\$2/);
  assert.match(source, /INSERT INTO mcp_oauth_refresh_tokens/);
});

test("OAuth bearer credentials are hashed before persistence", () => {
  assert.match(source, /mcpOAuthHash = async value =>[\s\S]*crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /INSERT INTO mcp_oauth_access_tokens \(token_hash/);
  assert.match(source, /INSERT INTO mcp_oauth_refresh_tokens \(token_hash/);
});

test("database client lifetime is request-scoped and closed in finally", () => {
  assert.match(source, /new McpOAuthDatabase\(new Client\(/);
  assert.match(source, /managerContext\.run\(\{ env, database \}/);
  assert.match(source, /finally \{[\s\S]*await database\?\.close\(\)/);
});

test("channel ownership verification has a bounded upstream timeout", () => {
  assert.match(source, /async function channelGuild[\s\S]*?AbortSignal\.timeout\(12000\)/);
});

test("Discord API requests use an explicit bounded timeout", () => {
  assert.match(source, /const init:RequestInit=\{method,headers,signal:AbortSignal\.timeout\(15000\)\}/);
});

test("request body reader enforces a streaming byte ceiling", () => {
  assert.match(source, /async function readBoundedText[\s\S]*?request\.body\?\.getReader\(\)[\s\S]*?total>maxBytes/);
  assert.match(source, /reader\.cancel\(\)/);
});

test("MCP and OAuth endpoints use distinct request-size limits", () => {
  assert.match(source, /readBoundedText\(request,2\*1024\*1024\)/);
  assert.match(source, /readBoundedText\(request,64\*1024\)/);
  assert.equal((source.match(/readBoundedText\(request,16\*1024\)/g)||[]).length, 2);
});

test("oversized MCP and OAuth bodies are rejected with HTTP 413", () => {
  assert.match(source, /tooLarge\?413:400/);
  assert.match(source, /mcpOAuthError\("request_body_too_large",413\)/);
});
