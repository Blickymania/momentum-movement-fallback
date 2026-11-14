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
  assert.match(router, /northflank-primary/);
  assert.match(router, /railway-legacy-secondary/);
  assert.match(router, /cloudflare-worker-tertiary/);
  assert.match(router, /render-cold-fallback/);
  const priority = ["northflank-primary", "railway-legacy-secondary", "cloudflare-worker-tertiary", "render-cold-fallback"];
  const positions = priority.map(name => router.indexOf(name));
  assert.ok(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1])));
  assert.match(router, /body\?\.manager === MANAGER_NAME/);
  assert.match(router, /body\?\.discordVerified === true/);
});

test("router forwards each verified origin once and stops writes after one failure", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /fetch\(new Request\(forwardUrl\(request\.url, current\.origin\), request\)\)/);
  assert.match(router, /if \(!safeRead\) break/);
  assert.match(router, /current = await chooseOrigin\(env, excluded\)/);
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

test("declared Content-Length is validated as decimal digits", () => {
  assert.ok(source.includes('!/^\\d+$/.test(declared)'));
});

test("MCP requests validate JSON-RPC 2.0 envelopes and identifiers", () => {
  assert.match(source, /function validJsonRpcRequest/);
  assert.match(source, /rpc\.jsonrpc!=="2\.0"/);
  assert.match(source, /Number\.isFinite\(rpc\.id\)/);
});

test("malformed JSON-RPC requests return protocol errors and notifications do not execute", () => {
  assert.match(source, /code:-32700,message:"Parse error"/);
  assert.match(source, /code:-32600,message:"Invalid Request"/);
  assert.match(source, /if\(!Object\.prototype\.hasOwnProperty\.call\(rpc,"id"\)\)return new Response\(null,\{status:202\}\)/);
});

test("router retries safe reads only after a verified alternate is selected", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /const safeRead = request\.method === "GET" \|\| request\.method === "HEAD"/);
  assert.match(router, /if \(!safeRead\) break/);
  assert.match(router, /current = await chooseOrigin\(env, excluded\)/);
});

test("router excludes origins already attempted during safe-read failover", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /excluded\.add\(current\.name\)/);
  assert.match(router, /if \(excluded\.has\(candidate\.name\)\) continue/);
});

test("router accepts only credential-free HTTPS origin roots", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /url\.protocol !== "https:"/);
  assert.match(router, /url\.username \|\| url\.password/);
  assert.match(router, /url\.pathname !== "\/"/);
  assert.match(router, /url\.search \|\| url\.hash/);
});

test("router rewrites only the upstream origin and strips URL credentials", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /const target = new URL\(incomingUrl\)/);
  assert.match(router, /target\.protocol = upstream\.protocol/);
  assert.match(router, /target\.host = upstream\.host/);
  assert.match(router, /target\.username = ""/);
  assert.match(router, /target\.password = ""/);
});

test("router readiness reports verified upstream Discord identity", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /oauthDatabaseVerified: selected\\.oauthDatabaseVerified/);
  assert.match(router, /status: "ready"/);
  assert.match(router, /manager: MANAGER_NAME/);
  assert.match(router, /discordVerified: true/);
});

test("OAuth redirect URIs are HTTPS or loopback and reject credentials/fragments", () => {
  assert.match(source, /u\.username\|\|u\.password\|\|u\.hash/);
  assert.match(source, /u\.protocol==="https:"/);
  assert.match(source, /u\.protocol==="http:"&&\["localhost","127\.0\.0\.1","\[::1\]"\]\.includes\(u\.hostname\)/);
});

test("OAuth authorization requires an exact registered redirect and PKCE S256", () => {
  assert.match(source, /redirects\.includes\(redirectUri\)/);
  assert.match(source, /get\("code_challenge_method"\)!=="S256"/);
  assert.match(source, /mcpOAuthPkce\(verifier\)!==row\.code_challenge/);
});

test("OAuth callback uses hashed, expiring, single-use state", () => {
  assert.match(source, /state=mcpOAuthRandom\(32\)/);
  assert.match(source, /mcpOAuthHash\(state\)/);
  assert.match(source, /state_hash=\$1 AND expires_at>now\(\) AND consumed_at IS NULL/);
});

test("OAuth scopes default to read-only and require explicit write scope", () => {
  assert.match(source, /String\(value\|\|"mcp:read"\)/);
  assert.match(source, /unique\.some\(x=>!\["mcp:read","mcp:write"\]/);
});

test("OAuth expired-record cleanup is bounded, advisory-locked, and request-driven", () => {
  assert.match(source, /pg_try_advisory_xact_lock\(hashtext\(\$1\)::bigint\)/);
  assert.equal((source.match(/LIMIT 250/g)||[]).length, 4);
  assert.match(source, /Date\.now\(\)-mcpOAuthCleanupLastRun>24\*60\*60\*1000/);
  assert.match(source, /oauth_expired_record_cleanup_failed/);
});

test("authorization-code consumption and token issuance share one transaction", () => {
  assert.match(source, /const context=await mcpOAuthDb\(\)\.begin\(async tx=>\{[\s\S]*?UPDATE mcp_oauth_authorization_codes SET consumed_at=now\(\)[\s\S]*?INSERT INTO mcp_oauth_access_tokens[\s\S]*?INSERT INTO mcp_oauth_refresh_tokens[\s\S]*?return row;/);
});

test("router requires explicit OAuth database readiness for new origins", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /body\?\.oauthDatabaseVerified === true/);
  assert.match(router, /allowLegacyReadiness === true/);
  assert.match(router, /railway-legacy-secondary/);
});

test("router may retry only safe reads on transient upstream gateway statuses", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /RETRYABLE_READ_STATUSES = new Set\(\[502, 503, 504\]\)/);
  assert.match(router, /if \(safeRead && RETRYABLE_READ_STATUSES\.has\(response\.status\)\)/);
  assert.match(router, /if \(!safeRead\) break/);
});

test("Manager readiness checks PostgreSQL when OAuth is enabled", () => {
  assert.match(source, /MCP_OAUTH_ENABLED==="true"/);
  assert.match(source, /mcpOAuthQuery\(mcpOAuthDb\(\),"SELECT 1 AS ok"\)/);
  assert.match(source, /oauthDatabaseVerified:true/);
});

test("Manager supports provider-neutral internal bearer auth with legacy compatibility", () => {
  assert.match(source, /MCP_INTERNAL_BEARER_TOKEN\|\|runtimeEnv\(\)\.RAILWAY_SERVICE_KEY/);
});

test("router caches short-lived health checks and coalesces concurrent probes", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /PROBE_CACHE_TTL_MS = 5000/);
  assert.match(router, /probeCache = new Map/);
  assert.match(router, /probeInFlight = new Map/);
  assert.match(router, /if \(pending\) return pending/);
  assert.match(router, /cachedProbe\(candidate\)/);
});
test("router readiness reports the selected origin actual database verification state", async () => {
  const router = await readFile(new URL("../src/failover-router.ts", import.meta.url), "utf8");
  assert.match(router, /oauthDatabaseVerified: status\.oauthDatabaseVerified/);
  assert.match(router, /oauthDatabaseVerified: selected\.oauthDatabaseVerified/);
  assert.match(router, /oauthDatabaseVerified: body\?\.oauthDatabaseVerified === true/);
});
