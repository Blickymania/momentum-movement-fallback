# Claude MCP Gateway — Dawn Dotta Staging Deployment Runbook

## Scope and safety

- Current execution scope is Dawn Dotta / Momentum Movement only.
- Four other manager projects remain locked. Do not inspect, modify, configure, deploy, audit, or otherwise touch them unless the user explicitly unlocks them.
- The shared five-server configs remain available for a later authorized rollout, but they are not the deployment target for this cycle.
- A separate Dawn-only Gateway/Auth config pair has been created:
  - `wrangler.dawn-dotta.jsonc` → `discord-claude-gateway-dawn-staging`
  - `auth-worker/wrangler.dawn-dotta.jsonc` → `discord-claude-auth-dawn-staging`
  - Existing authorized manager target: `manager-worker/wrangler.dawn-dotta.jsonc` → `manager-dawn-dotta-staging`
- The Dawn-only Gateway binds only to the Dawn manager and Dawn Auth Worker. It does not require the four locked manager targets.
- No production deployment, production branch merge, Discord resource write, or bot-role change is authorized by this runbook.
- Do not put bot tokens, write secrets, OAuth client secrets, or encryption keys in source, Wrangler `vars`, command-line arguments, logs, or chat. Use Cloudflare's encrypted secret prompts/dashboard fields.

## Deployment dependency

Cloudflare requires a Service-Binding target Worker to exist before its caller is deployed. See [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).

The Dawn-only pair has a reciprocal dependency:
- Dawn Gateway calls Dawn Auth through `AUTH_SERVER`.
- Dawn Auth calls Dawn Gateway through `GATEWAY_SERVER`.

Bootstrap Auth without its Gateway binding, deploy Gateway after Auth and the Dawn manager exist, then redeploy Auth with its final Gateway binding. This avoids a missing-target deployment failure without creating a public bootstrap endpoint.

## Current config protections

The active Dawn deployment profiles are deliberately split into private bootstrap/final configs and an opt-in public endpoint profile:

- Dawn manager: `workers_dev: false`, `preview_urls: false`, `keep_vars: true` in every profile. It has no public route.
- Dawn Auth bootstrap and private-final configs: `workers_dev: false`, `preview_urls: false`, `keep_vars: true`.
- Dawn Gateway private-final config: `workers_dev: false`, `preview_urls: false`, `keep_vars: true`.
- Dawn Auth and Gateway `workers.dev` activation profiles: `workers_dev: true`, `preview_urls: false`, `keep_vars: true`. These are deployed only after both reciprocal Service Bindings have been verified.
- Dashboard-managed variables are omitted from committed `vars` blocks, so a blank same-name value cannot overwrite a dashboard value.

The Auth and Gateway `workers.dev` profiles expose only the OAuth issuer and MCP endpoint over HTTPS. Both remain protected by the application OAuth flow; the Discord manager Worker is never public. The `workers.dev` subdomain itself is public, so do not store secrets in URL paths or hostnames.

## Free-tier hosting feasibility

The Dawn stack is compatible with Cloudflare Workers Free at low volume because the design uses Workers, KV, and SQLite-backed Durable Objects; Workers Free supports SQLite-backed Durable Objects, while the older KV-backed Durable Object storage is not available on Free.

Current published Free allowances to plan against:
- Workers: 100,000 requests per day and 10 ms CPU time per invocation.
- Workers KV: 100,000 reads/day, 1,000 writes/day, 1,000 deletes/day, 1,000 list requests/day, and 1 GB stored data.
- SQLite-backed Durable Objects: 100,000 requests/day, 13,000 GB-seconds/day, 5 million rows read/day, 100,000 rows written/day, and 5 GB total SQLite storage.

If a Workers Free limit is exceeded, further operations of that type fail until the daily allowance resets; this is not an unlimited free tier. Monitor usage, keep authentication/consent writes lean, and do not assume high-traffic availability without paid capacity. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [KV pricing](https://developers.cloudflare.com/workers/kv/platform/pricing/), and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).


## Required Cloudflare-owned staging inputs

Have the approved Dawn staging settings and credentials ready for encrypted entry. For a first deployment, add each Worker's settings after its private Worker exists. Keep public routes disabled until all settings and private bindings have been verified.

### Non-secret dashboard variables

- Dawn Auth Worker:
  - `OAUTH_ISSUER_URL=https://<auth-host>`
  - `MCP_RESOURCE_URL=https://<mcp-host>/mcp`
  - `DISCORD_CLIENT_ID`
  - `DISCORD_REDIRECT_URI=https://<auth-host>/discord/callback`
  - `GUILD_ID_DAWN_DOTTA`
- Dawn Gateway Worker:
  - the same `OAUTH_ISSUER_URL`
  - the same `MCP_RESOURCE_URL`
  - the same `GUILD_ID_DAWN_DOTTA`
- Dawn manager Worker:
  - `DISCORD_GUILD_ID`
  - `DISCORD_APPLICATION_ID`

Do not commit these values. The Auth/Gateway/Dawn manager configs use `keep_vars: true` and omit dashboard-managed `vars` so existing dashboard values are preserved.

### KV namespace

- Create a dedicated staging KV namespace for the Dawn Auth Worker.
- Keep the committed Dawn Auth templates' `OAUTH_KV` IDs blank. Do not put the account-specific namespace ID in a tracked file, GitHub secret, or chat message.
- Prepare the three ignored local Auth deployment profiles by entering the ID through a hidden terminal prompt from `claude-gateway`:
  
  ```bash
  read -rsp "Dedicated Dawn staging OAUTH_KV namespace ID: " DAWN_OAUTH_KV_NAMESPACE_ID
  printf '\n'
  export DAWN_OAUTH_KV_NAMESPACE_ID
  npm run prepare:dawn:deploy-configs
  unset DAWN_OAUTH_KV_NAMESPACE_ID
  ```
- The helper accepts only a nonzero 32-character hexadecimal namespace ID. It validates all three Auth templates and their binding/migration safeguards before creating any output, refuses to overwrite existing local files, writes them with owner-only permissions, and never prints the namespace ID.
- The generated files are:
  - `auth-worker/wrangler.dawn-dotta-bootstrap.local.jsonc`
  - `auth-worker/wrangler.dawn-dotta.local.jsonc`
  - `auth-worker/wrangler.dawn-dotta-workers-dev.local.jsonc`
- These local files are git-ignored. Confirm that the namespace ID belongs to the dedicated Dawn staging namespace before proceeding. Do not reuse a production namespace.

### Secrets

Enter each secret only through Cloudflare's encrypted secret prompt/dashboard field:

- Dawn Auth Worker:
  - `DISCORD_CLIENT_SECRET`
  - `AUTH_SESSION_ENCRYPTION_KEY`
  - `OWNER_APPROVAL_INTERNAL_SECRET`
- Dawn Gateway Worker:
  - `OWNER_APPROVAL_INTERNAL_SECRET` (exact same value as Dawn Auth)
  - `MANAGER_WRITE_SECRET_DAWN_DOTTA`
- Dawn manager Worker:
  - `DISCORD_BOT_TOKEN`
  - `MANAGER_WRITE_SECRET` (exact same unique value as `MANAGER_WRITE_SECRET_DAWN_DOTTA`)

Generate a fresh owner-approval secret for this isolated Dawn staging pair and a separate unique manager write secret for Dawn. Never reuse production secrets or any other manager's write secret.

### Public endpoints

**Default zero-domain staging option: Cloudflare's account-provided `workers.dev` subdomain.**

Cloudflare accounts include a configurable `workers.dev` subdomain, so this option does not require buying a domain or onboarding a custom zone. The stable endpoint names are:

- OAuth issuer: `https://discord-claude-auth-dawn-staging.<account-subdomain>.workers.dev`
- MCP resource: `https://discord-claude-gateway-dawn-staging.<account-subdomain>.workers.dev/mcp`
- Discord redirect URI: `https://discord-claude-auth-dawn-staging.<account-subdomain>.workers.dev/discord/callback`

The account owner must first choose/enable the account subdomain in Cloudflare. The two public URLs are created only when the corresponding `workers.dev` activation configs are deployed after private binding verification. Do not enable Version/Preview URLs. Do not expose the Dawn manager Worker.

Cloudflare describes `workers.dev` as public and intended for personal/hobby projects rather than business-critical production workloads. For a production-critical service, replace this public-host option with a custom domain on a Cloudflare-managed zone after a separate review. See [Cloudflare workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Deployment order

Run the commands from `claude-gateway` in a runner that can reach Cloudflare. Install the locked dependencies with `npm ci --no-audit --no-fund`, then run `npx --no-install wrangler whoami` and confirm the authenticated account is the approved Dawn staging account. Verify the dedicated KV namespace, generate the ignored Auth configs, and have the approved Discord credentials available before starting. For an existing staging Worker, check its route state and record its current version before deploying.

For a new Worker, deploy its private config first and then enter its variables and secrets in **Settings → Variables and Secrets**. The private profiles have no public routes or scheduled triggers. Do not invoke a Worker until its settings are in place. See [Cloudflare's dashboard secret instructions](https://developers.cloudflare.com/workers/configuration/secrets/).

### 1. Deploy the authorized Dawn manager

```bash
npx wrangler deploy --config manager-worker/wrangler.dawn-dotta.jsonc
```

Add the manager variables and encrypted secrets listed above through the Cloudflare dashboard, then confirm:
- Worker name is exactly `manager-dawn-dotta-staging`.
- `workers_dev` and Version/Preview URLs are disabled.
- No route or custom domain exists.
- Guild/application IDs are the intended Dawn staging values.
- Its `DISCORD_BOT_TOKEN` and `MANAGER_WRITE_SECRET` are configured without displaying their values.

Do not deploy or inspect the four locked manager projects.

### 2. Bootstrap Dawn Auth without the reciprocal Gateway binding

Use the generated local bootstrap-only config. It has the final Dawn Auth Worker name, the supplied dedicated staging `OAUTH_KV` namespace ID, the SQLite Durable Object binding/migration, no Service Binding, and no public `workers.dev` route.

```bash
npx wrangler deploy --config auth-worker/wrangler.dawn-dotta-bootstrap.local.jsonc
```

This creates the Auth target needed by the Gateway while keeping the OAuth endpoint private during bootstrap. Add the Auth variables and encrypted secrets listed above and confirm both public routing controls remain disabled.

### 3. Deploy the Dawn-only Gateway

The Dawn manager and Dawn Auth target now exist. Deploy the config that references only those two services:

```bash
npx wrangler deploy --config wrangler.dawn-dotta.jsonc
```

Confirm the Service Bindings are exactly:
- `AUTH_SERVER` → `discord-claude-auth-dawn-staging`
- `MANAGER_DAWN_DOTTA` → `manager-dawn-dotta-staging`

No other manager binding should be present in this Dawn-only config. Add the Gateway variables and encrypted secrets listed above and verify their names in the dashboard.

### 4. Redeploy Dawn Auth with its final Gateway binding

Deploy the canonical private-final Dawn Auth config, which restores `GATEWAY_SERVER` while keeping the endpoint private:

```bash
npx wrangler deploy --config auth-worker/wrangler.dawn-dotta.local.jsonc
```

Confirm both private directions:
- Dawn Gateway → Dawn Auth
- Dawn Auth → Dawn Gateway

Do not enable the public `workers.dev` endpoint yet.

### 5. Check account hostname, settings, and routes before activation

- Verify the account's existing `workers.dev` subdomain in Workers & Pages and confirm the exact Discord callback remains registered on the approved application.
- Verify the dashboard variable values for `OAUTH_ISSUER_URL`, `MCP_RESOURCE_URL`, and `DISCORD_REDIRECT_URI`. Compare the approved secret names without displaying their values.
- Keep `preview_urls: false`; do not enable Version/Preview URLs or Deployment URLs.
- Confirm `workers.dev` is being enabled only for the Dawn Auth and Dawn Gateway Worker names. The Dawn manager remains private.

### 6. Enable the two public HTTPS endpoints last

Only after the private binding graph and dashboard variables are verified, deploy the public endpoint profiles:

```bash
npx wrangler deploy --config auth-worker/wrangler.dawn-dotta-workers-dev.local.jsonc
npx wrangler deploy --config wrangler.dawn-dotta-workers-dev.jsonc
```

These profiles use the same Worker names, Service Bindings, Durable Objects, and KV binding as the already-deployed private configs; their only exposure change is `workers_dev: true`. They preserve `preview_urls: false` and `keep_vars: true`.

Confirm:
- Auth is reachable at the issuer URL and its Discord callback URL over HTTPS.
- Gateway is reachable at the MCP resource URL over HTTPS.
- The manager Worker has no `workers.dev`, route, custom domain, Version URL, or Preview URL.
- OAuth metadata advertises the configured issuer and resource URLs.

If either endpoint or binding fails, disable the two `workers.dev` routes in the Cloudflare dashboard, redeploy the private configs, and repair the staging graph before retrying.

## Staging acceptance tests

Do not treat successful deployment as acceptance. Use a dedicated staging Discord account. Perform only read-only live checks unless a separate explicit approval authorizes a test write.

1. Auth and MCP endpoints respond only on the two intended HTTPS staging hostnames.
2. The manager Worker has no public route, workers.dev hostname, Version URL, Preview URL, or Deployment URL.
3. OAuth protected-resource and authorization-server metadata identify the configured resource and issuer correctly.
4. Discord login, callback browser-state binding, guild filtering, consent, PKCE token exchange, and read-only `mcp:read` grant succeed.
5. MCP client initializes and lists the expected tools.
6. Dawn manager returns only its intended staging guild/application identity and read inventory.
7. A non-owner cannot approve an owner-only proposal; owner identity and permission are rechecked.
8. MCP OAuth refresh works while the linked Discord credential remains current. If the credential is missing, expired, or within the 30-second safety window, the Auth Worker throws OAuth `invalid_grant`; the provider revokes the MCP grant and its tokens. Complete a fresh Discord authorization to restore access. Automatic Discord refresh-token use is not implemented.
9. Verify approved execution only with mocked tests until a separate explicit staging test-write approval exists.
10. Record Worker version IDs, binding names, route states, test outcomes, and rollback targets without recording secret values.

Do not send a real Discord message or perform a live channel update as part of this runbook. Do not use role mutations, permission overwrites, deletes, or bulk actions; those are outside the executor allowlist.

## Connect Claude after staging is deployed

Anthropic's current documentation lists remote MCP custom connectors for Claude, Cowork, and Claude Desktop on Free, Pro, Max, Ultra, Team, and Enterprise plans; Free users are limited to one custom connector. Claude connects from Anthropic's cloud infrastructure, so the MCP endpoint must be publicly reachable over HTTPS on port 443. Team and Enterprise organization connectors must be added by an Owner or Primary Owner. See [Claude's current remote MCP connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

After the Dawn Auth and MCP endpoints are live and staging acceptance passes:
1. In Claude or Claude Desktop, open **Settings → Connectors**.
2. Choose **Add custom connector**. For Team/Enterprise, an Owner or Primary Owner must enable the organization connector.
3. Enter the Dawn staging MCP resource URL, including `/mcp`.
4. Add the connector, then use **Search and tools → Connect** to complete OAuth.
5. Sign in to Discord and review `mcp:read` and `offline_access` consent.
6. Confirm the tool list appears and test a read-only inventory call first.
7. Verify MCP OAuth refresh while the Discord credential is current. Verify that missing/expired/near-expiry Discord credential props cause `invalid_grant` and revocation of the MCP grant; then complete a fresh Discord authorization. The Discord refresh token is not persisted.
8. Review each owner-approved write carefully. Do not use Claude Research for write-capable tools.

The Auth Worker DCR test accepts both `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`. Claude Desktop remote connectors must be added through **Settings → Connectors**, not by adding a remote server to `claude_desktop_config.json`.

No Claude connector has been connected in this work. Real Claude UI connection and reconnect acceptance remain pending the live staging endpoint and user Discord consent.

## Rollback

- Record the previous deployed version ID for each staging Worker before enabling its endpoint.
- If the Auth/Gateway binding graph fails, disable public routing first, then restore compatible staging configs in reverse dependency order.
- Roll back only the affected Dawn staging Worker to a prior known-good version using Cloudflare's supported rollback workflow.
- Worker rollback does not roll back connected KV/DO resources or data. Do not assume the v1 Durable Object migration can be undone by rolling back code. Retain the migrated class/version and follow Cloudflare's migration-aware recovery guidance.
- Do not roll back or change production Workers, Discord resources, bot roles, or the four locked manager projects.

## Current readiness

- Latest verified application-code CI is [run 43982612715](https://github.com/Blickymania/momentum-movement-fallback/actions/runs/43982612715) on `d0f22d6f07ba1d292646b575310728dce7df5cb5`. Strict TypeScript, 134 tests, and six offline Wrangler dry-runs passed. The dry-runs exited before upload.
- The unit/configuration suite includes five tests for `prepare:dawn:deploy-configs`: required namespace ID, three-profile generation, unchanged tracked templates, no ID leakage to stdout, owner-only file permissions, overwrite protection, validate-before-write behavior, and Git ignore coverage.
- Dawn has a private bootstrap/final binding sequence plus separate opt-in public `workers.dev` profiles for Auth and Gateway. The manager remains private in all profiles. Five config integration checks verify the private/public profile boundaries, binding graph, and no embedded secrets. Six Wrangler dry-runs validate the manager and all five Auth/Gateway profile combinations.
- The deployment runbook now uses the guarded local-config preparation helper and generated ignored `.local.jsonc` profiles. The current recovery checkpoint is `docs/CLAUDE-MCP-GATEWAY-CHECKPOINT-2026-11-16-DAWN-LOCAL-AUTH-CONFIGS-VERIFIED.md`.
- The successful CI run validates source, tests, and offline bundles only. It does not prove live Cloudflare bindings, OAuth consent/reconnect, or Discord API access.
- The Cloudflare account subdomain, dedicated Dawn OAuth KV namespace and binding, and Discord OAuth callback registration have been verified. No staging Worker has been deployed.
- Remaining deployment inputs are a Cloudflare-authenticated runner with API connectivity and secure access to the approved Discord credentials. Configure the Dawn variables and secrets during private bootstrap before enabling the two public routes.
- No live Discord writes, bot-role changes, or production changes were performed.
- No scheduler, cron, reminder, or recurring maintenance was created.
