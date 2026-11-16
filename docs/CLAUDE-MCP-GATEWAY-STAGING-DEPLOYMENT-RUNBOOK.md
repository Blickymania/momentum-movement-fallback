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

The Dawn manager, Dawn Gateway, and Dawn Auth configs set:
- `workers_dev: false`
- `preview_urls: false`
- `keep_vars: true`
- no public route/custom-domain declaration in the bootstrap configs
- dashboard-managed variables omitted from committed `vars` blocks, so a blank same-name value cannot overwrite a dashboard value

The manager remains private and reachable only through the Dawn Gateway Service Binding. Configure public routing only for the final Dawn Gateway MCP endpoint and Dawn Auth OAuth issuer, after both reciprocal Service Bindings work.

## Required Cloudflare-owned staging inputs

Do not proceed until the Cloudflare account owner has configured these values in the staging account only.

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
- Enter its actual namespace ID in `auth-worker/wrangler.dawn-dotta.jsonc` under `OAUTH_KV`.
- The current blank ID is a placeholder and is not deployable.
- Do not reuse a production namespace.

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

- Choose two HTTPS hostnames in a Cloudflare-managed staging zone:
  - OAuth issuer: `https://<auth-host>`
  - MCP resource: `https://<mcp-host>/mcp`
- Configure the Discord Developer Portal redirect URI exactly as `https://<auth-host>/discord/callback`.
- The configs currently have no public routes/custom domains. Do not expose the manager Worker.
- Keep public routes disabled during bootstrap; add routes/custom domains only after both reciprocal Service Bindings are complete.

## Deployment order

All commands below are from the `claude-gateway` directory. Run them only after the account-owned values and secrets above are configured and verified.

### 1. Deploy the authorized Dawn manager

```bash
npx wrangler deploy --config manager-worker/wrangler.dawn-dotta.jsonc
```

Confirm:
- Worker name is exactly `manager-dawn-dotta-staging`.
- `workers_dev` and Version/Preview URLs are disabled.
- No route or custom domain exists.
- Guild/application IDs are the intended Dawn staging values.
- Its `DISCORD_BOT_TOKEN` and `MANAGER_WRITE_SECRET` are configured without displaying their values.

Do not deploy or inspect the four locked manager projects.

### 2. Bootstrap Dawn Auth without the reciprocal Gateway binding

- Make a temporary local copy of `auth-worker/wrangler.dawn-dotta.jsonc` named `auth-worker/wrangler.dawn-dotta.bootstrap.jsonc`.
- In the temporary copy only, remove the `GATEWAY_SERVER` entry from `services`.
- Keep the same Dawn Auth Worker name, dedicated Dawn `OAUTH_KV` binding, Durable Object binding/migration, `keep_vars: true`, and `preview_urls: false`.
- Do not add public routes/custom domains to the bootstrap config.
- Deploy:

```bash
npx wrangler deploy --config auth-worker/wrangler.dawn-dotta.bootstrap.jsonc
```

- Do not commit the temporary bootstrap config. This creates the Auth target needed by the Gateway. OAuth and owner-approval callbacks remain unavailable until final bindings and routes are configured.

### 3. Deploy the Dawn-only Gateway

The Dawn manager and Dawn Auth target now exist. Deploy the config that references only those two services:

```bash
npx wrangler deploy --config wrangler.dawn-dotta.jsonc
```

Confirm the Service Bindings are exactly:
- `AUTH_SERVER` → `discord-claude-auth-dawn-staging`
- `MANAGER_DAWN_DOTTA` → `manager-dawn-dotta-staging`

No other manager binding should be present in this Dawn-only config.

### 4. Redeploy Dawn Auth with its final Gateway binding

Deploy the canonical Dawn Auth config, which restores `GATEWAY_SERVER`:

```bash
npx wrangler deploy --config auth-worker/wrangler.dawn-dotta.jsonc
```

Then remove the temporary local `auth-worker/wrangler.dawn-dotta.bootstrap.jsonc` file.

Confirm both private directions:
- Dawn Gateway → Dawn Auth
- Dawn Auth → Dawn Gateway

Do not enable public routes yet.

### 5. Configure the two public endpoints last

Only after the private binding graph is verified:
- Add the approved HTTPS route/custom domain for the Dawn Auth OAuth issuer.
- Add the approved HTTPS route/custom domain for the Dawn Gateway MCP resource.
- Set/verify the dashboard-managed `OAUTH_ISSUER_URL`, `MCP_RESOURCE_URL`, and exact Discord redirect URI.
- Verify Version/Preview URLs remain disabled.
- Confirm the manager Worker remains private with no public route.

If either binding or hostname fails, keep public routes disabled and repair the staging binding graph before retrying.

## Staging acceptance tests

Do not treat successful deployment as acceptance. Use a dedicated staging Discord account. Perform only read-only live checks unless a separate explicit approval authorizes a test write.

1. Auth and MCP endpoints respond only on the two intended HTTPS staging hostnames.
2. The manager Worker has no public route, workers.dev hostname, Version URL, Preview URL, or Deployment URL.
3. OAuth protected-resource and authorization-server metadata identify the configured resource and issuer correctly.
4. Discord login, callback browser-state binding, guild filtering, consent, PKCE token exchange, and read-only `mcp:read` grant succeed.
5. MCP client initializes and lists the expected tools.
6. Dawn manager returns only its intended staging guild/application identity and read inventory.
7. A non-owner cannot approve an owner-only proposal; owner identity and permission are rechecked.
8. MCP OAuth refresh works; expired/near-expiry Discord credentials return the tested 401 reconnect challenge; a fresh Discord authorization restores access.
9. Verify approved execution only with mocked tests until a separate explicit staging test-write approval exists.
10. Record Worker version IDs, binding names, route states, test outcomes, and rollback targets without recording secret values.

Do not send a real Discord message or perform a live channel update as part of this runbook. Do not use role mutations, permission overwrites, deletes, or bulk actions; those are outside the executor allowlist.

## Connect Claude after staging is deployed

Anthropic documents remote MCP support for Claude and Claude Desktop on Pro, Max, Team, and Enterprise plans, including Streamable HTTP, OAuth, Dynamic Client Registration, and token refresh. See [Anthropic's remote MCP connector guide](https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers).

After the Dawn Auth and MCP endpoints are live and staging acceptance passes:
1. In Claude or Claude Desktop, open **Settings → Connectors**.
2. Choose **Add custom connector**. For Team/Enterprise, an Owner or Primary Owner must enable the organization connector.
3. Enter the Dawn staging MCP resource URL, including `/mcp`.
4. Add the connector, then use **Search and tools → Connect** to complete OAuth.
5. Sign in to Discord and review `mcp:read` and `offline_access` consent.
6. Confirm the tool list appears and test a read-only inventory call first.
7. Verify MCP OAuth refresh. If the underlying Discord credential has expired, complete a fresh Discord authorization; the Discord refresh token is not persisted, so refreshing the MCP OAuth token alone does not renew the Discord credential.
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

- Source and static config checks are green. Latest verified Actions run: `43950059288` on staging head `ff1684923ac9b7924cac684173c2f2dea4699984`; strict TypeScript, 88 unit/configuration tests, and 35 Cloudflare Workers integration tests passed (123 total).
- The Dawn-only Gateway/Auth config pair exists and references only Dawn Auth and Dawn manager services; its four static config checks pass. The full five-server configs remain available but are not the current deployment target.
- No Cloudflare staging Worker, KV namespace, route, custom domain, Service Binding, or secret has been created or deployed by this work.
- Account-owned prerequisites remain: dedicated Dawn `OAUTH_KV` namespace ID, Dawn guild/application IDs, Discord client settings, two HTTPS hostnames, and the Dawn bot/write/owner-approval secrets.
- No live Discord writes, bot-role changes, or production changes were performed.
- No scheduler, cron, reminder, or recurring maintenance was created.
