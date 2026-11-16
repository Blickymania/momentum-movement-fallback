# Claude MCP Gateway — Staging Deployment Runbook

## Scope and safety
- Deploy only to the staging Worker names in the staging Wrangler configs.
- Do not deploy to production, merge to the production branch, change Discord resources, or modify any Discord bot role.
- Manager Workers remain private: `workers_dev: false`, no public routes/custom domains, and Version/Preview URLs explicitly disabled; they are reachable only through the resource Worker's Service Bindings.
- The current authorized deployment scope is Dawn Dotta / Momentum Movement only. Do not create, inspect, configure, or deploy the other four manager Workers. Because the shared gateway config declares all five manager Service Bindings, a live gateway deployment is blocked until the other four target services are already present and verified as staging-only, or their scope is explicitly unlocked. Do not work around this dependency by exposing temporary public endpoints.
- Do not put bot tokens, write secrets, OAuth client secrets, or encryption keys in source, Wrangler `vars`, command-line arguments, logs, or chat. Use Cloudflare's secret input prompts.

## Why the first deployment needs two phases
Cloudflare documents that Service-Binding target Worker B must already exist before caller Worker A is deployed; otherwise the caller's deployment fails. Workers are deployed separately. See the [Cloudflare Service Bindings deployment guidance](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).

This project has a reciprocal reference:
- Resource/Gateway Worker calls Auth Worker through `AUTH_SERVER`.
- Auth Worker calls Resource/Gateway Worker through `GATEWAY_SERVER`.

A first deployment cannot satisfy both references simultaneously. Bootstrap by temporarily deploying the Auth Worker without its gateway binding, then deploy the Gateway, then redeploy Auth with the final reciprocal binding.

## Required account-owned staging inputs

Keep real environment values out of this public repository. Cloudflare documents `keep_vars: true` as retaining dashboard-managed variables on deploy, but it does not make a same-name blank value in the Wrangler `vars` block safe: variables declared in the config are still Wrangler-managed. Therefore, dashboard-managed keys must be omitted from `vars` entirely. The shared Gateway/Auth configs and Dawn Dotta manager config now omit those keys and explicitly set `preview_urls: false`. The four locked manager configs still declare blank `DISCORD_GUILD_ID` and `DISCORD_APPLICATION_ID` placeholders; do not deploy them until an authorized change removes those same-name placeholders or deliberately supplies nonblank source-of-truth values. See [Wrangler configuration — source of truth](https://developers.cloudflare.com/workers/wrangler/configuration/).

Do not proceed until the Cloudflare account owner has configured, in the staging account only:

1. A dedicated staging KV namespace for `OAUTH_KV`; enter its actual namespace ID into the Auth Worker's staging binding. The blank ID in source is a placeholder, not a deployable namespace.
2. The five valid staging guild IDs, pairwise distinct, in both Auth and Gateway variables; the five matching application IDs and guild IDs in the corresponding manager Workers. Do not commit them to this public repository.
3. The OAuth client ID, client secret, encryption key, redirect URI, and shared owner-approval secret. Enter secrets only through Cloudflare's encrypted secret prompts/dashboard fields.
4. Five independently generated manager write secrets. Each secret must match only the corresponding manager's `MANAGER_WRITE_SECRET` and its gateway-side `MANAGER_WRITE_SECRET_*` value.
5. Two chosen HTTPS hostnames: one for the OAuth issuer/callback and one for the MCP resource. Do not attach routes or custom domains during the bootstrap phases; select them now, but configure public routing only after reciprocal Service Bindings are complete.
6. A staging-only Cloudflare account/zone and credentials with sufficient scope to manage these exact staging Worker names, KV namespace, secrets, Durable Object migrations, and two final public hostnames. Never use production credentials or resource names.

**No secrets, bot tokens, encryption keys, OAuth client secrets, or actual IDs should be posted in chat or committed.** The current environment has no verified Cloudflare account state.
## Deployment order

Cloudflare requires a Service-Binding target Worker to exist before its caller is deployed. This project contains a reciprocal dependency: Gateway `AUTH_SERVER` → Auth, and Auth `GATEWAY_SERVER` → Gateway. Cloudflare's documented target-first rule requires a temporary two-phase Auth deployment; deploy the Auth Worker first without its Gateway binding, deploy Gateway against that Auth Worker, then redeploy Auth with the reciprocal binding. See [Cloudflare Service Bindings — Deployment](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).

### Preflight — no deployment yet

- Confirm the account, zone, Worker names, and every resource are staging-only.
- Confirm there is no existing route, custom domain, `workers.dev` hostname, Version URL, Preview URL, or Deployment URL exposing any manager or bootstrap Worker.
- Explicitly disable Version/Preview URLs for each staging Worker in Wrangler or Cloudflare settings. Gateway, Auth, and Dawn Dotta configs now set `preview_urls: false`. The four locked manager configs still omit this setting, so verify it is disabled in the Cloudflare dashboard; if not, stop and wait for an authorized config repair. `workers_dev: false` by itself does **not** disable Version URLs, Preview URLs, or Deployment URLs; and omitting `preview_urls` can leave an existing setting unchanged. See [Cloudflare workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) and [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).
- Keep `workers_dev: false` on every service Worker, no manager routes/custom domains, and no public bootstrap endpoint.
- Confirm `keep_vars: true` is present and the dashboard-managed keys are absent from the config `vars` blocks for each Worker being deployed. Gateway, Auth, and Dawn Dotta now follow this pattern. The four locked manager configs do not yet: their blank same-name placeholders make them unsafe to deploy until their scope is unlocked and corrected. Verify all intended dashboard values without displaying secrets.
- Validate all secret names and one-to-one manager secret pairings without displaying secret values.
- Confirm the five manager target Worker services exist in the same Cloudflare account. Under the current Dawn-only scope, do not create or modify the other four communities' Workers. If any locked target is missing or its staging identity cannot be verified, stop before deploying Gateway. The current shared Gateway config references all five targets, so all five targets must exist before the Gateway caller can deploy.
- Review the first-time Durable Object migrations (`WRITE_PROPOSAL_STORE` and `OAUTH_ONE_TIME_STORE`). Their v1 SQLite class creation is a persistent resource lifecycle action, not a routine code rollback. Cloudflare warns rollbacks do not revert connected resource state and certain Durable Object lifecycle changes can prevent rollback to earlier versions. See [Cloudflare Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/). Back up/record existing staging state and approve this migration plan before the first deployment.

### 1. Deploy only already-authorized private manager targets

For the current scope, this step may deploy the Dawn Dotta manager only, and only after Dawn's staging values and secret pair have been configured and verified. Do not deploy the Empress, Blickymania, BestYouEvaHad, or Red Kocaine managers under the current scope.

Example from the `claude-gateway` directory:
```bash
npx wrangler deploy --config manager-worker/wrangler.dawn-dotta.jsonc
```

Keep the manager private: no route, no custom domain, `workers_dev: false`, Version/Preview URLs disabled. The full shared Gateway cannot deploy until the other four referenced manager services already exist and are confirmed as authorized staging resources. If they do not, stop here; do not deploy placeholder or public proxy Workers.

### 2. Bootstrap the Auth Worker without its reciprocal Gateway binding

- Make a temporary local copy of `auth-worker/wrangler.jsonc` named `auth-worker/wrangler.bootstrap.jsonc`.
- In the temporary copy only, remove the `GATEWAY_SERVER` entry from `services`. Keep the same staging Worker name, the real `OAUTH_KV` namespace binding, Durable Object binding/migration, and `keep_vars: true`.
- Leave public OAuth/MCP URLs blank and do not add a route, custom domain, or public endpoint. With the URLs blank, normal OAuth requests fail closed; the worker exists only to satisfy the Gateway's Service Binding target.
- Ensure Version/Preview URLs are disabled explicitly for this Worker.
- Deploy the temporary config:
```bash
npx wrangler deploy --config auth-worker/wrangler.bootstrap.jsonc
```
- Do not commit the temporary file. Do not expose the OAuth endpoint yet. The owner-approval callback path is intentionally unavailable until the final Gateway binding is attached.

### 3. Deploy the Gateway with its final Auth and manager bindings

Only after **all six targets** exist (Auth plus five private manager Workers), deploy:
```bash
npx wrangler deploy --config wrangler.jsonc
```

Keep `MCP_RESOURCE_URL` and `OAUTH_ISSUER_URL` blank and leave all public routes disabled. Internal owner-approval paths are checked before the public MCP resource handler, but they must remain inaccessible from the public internet during bootstrap.

### 4. Redeploy Auth with the final reciprocal Gateway binding

- Deploy the canonical config, which restores `GATEWAY_SERVER`:
```bash
npx wrangler deploy --config auth-worker/wrangler.jsonc
```
- Remove the temporary local `auth-worker/wrangler.bootstrap.jsonc` file.
- Verify both private directions: Auth → Gateway and Gateway → Auth. Verify the five manager bindings remain private and point to the intended staging targets.
- Keep public routing disabled until these checks pass.

### 5. Configure the two public staging endpoints last

- Set the dashboard-managed `OAUTH_ISSUER_URL`, `MCP_RESOURCE_URL`, and exact Discord redirect URI to the approved HTTPS staging hostnames. Confirm `keep_vars: true` preserves them on any subsequent Wrangler deploy.
- Add public routing/custom domains only for the Auth OAuth Worker and Gateway MCP Worker. Do not expose manager Workers or intermediate bootstrap configs.
- Keep Version/Preview URLs disabled; verify the setting in Cloudflare after deployment.
- Only now run external OAuth/MCP acceptance tests. If either binding or hostname fails, remove/disable the affected public route and repair the staging binding graph before retrying.
## Staging acceptance tests

Do not treat successful deployment as acceptance. Perform only read-only live checks unless a separate explicit approval authorizes a test write:

1. Auth and MCP endpoints respond only on the two intended HTTPS staging hostnames; manager workers and bootstrap workers have no public route.
2. Version/Preview URLs are disabled for every staging Worker.
3. OAuth protected-resource and authorization-server metadata identify the configured resource/issuer correctly.
4. Using a dedicated staging test Discord account, verify login, callback browser-state binding, guild filtering, consent, PKCE token exchange, and the read-only `mcp:read` grant.
5. Verify the MCP client can initialize and list tools.
6. Verify Dawn Dotta's manager returns only its intended staging guild/application identity and read inventory. Do not query locked community managers.
7. Verify a non-owner cannot approve an owner-only proposal and that owner verification is rechecked. Use reject/expiry paths for live validation; approved execution remains covered by mocked integration tests until a separate test-write approval exists.
8. Verify the expired/near-expiry credential 401 reconnect challenge and a fresh Discord authorization restores access.
9. Confirm the executable write surface remains limited to `message.send` and allowlisted `channel.update`; bot-role/role changes, permission overwrites, deletes, and bulk actions remain unavailable.
10. Record Worker version IDs, binding names, route states, test outcomes, and rollback targets without recording secret values.

Do not send a real Discord message or perform a live channel update as part of this runbook.
## Connect Claude after staging is deployed

Anthropic documents remote MCP support for Claude and Claude Desktop on Pro, Max, Team, and Enterprise plans. Claude supports Streamable HTTP, OAuth-based remote MCP, Dynamic Client Registration, and token refresh. See [Anthropic's remote MCP connector guide](https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers).

After the resource and auth hostnames are live and the staging acceptance tests pass:
1. In Claude or Claude Desktop, open **Settings → Connectors**.
2. Choose **Add custom connector** (for Team/Enterprise, an Owner or Primary Owner must first enable the organization connector).
3. Enter the staging MCP resource URL, including `/mcp`.
4. Add the connector, then use **Search and tools → Connect** to complete the OAuth flow.
5. Sign in to Discord, review the requested `mcp:read` and `offline_access` scopes, and consent only to the intended five-server list.
6. Confirm the tool list appears. Test a read-only inventory call before testing the proposal/owner-approval flow.
7. Verify the connector can refresh its MCP OAuth token. If the underlying Discord credential has expired, the gateway deliberately returns a 401 reconnect challenge; complete a fresh Discord authorization. The Discord refresh token is not persisted, so refreshing the MCP OAuth token alone does not renew the Discord credential.
8. Disable any tools not needed for the test and review each owner-approved write carefully. Do not use Claude Research for write-capable tools.

Claude's documented OAuth callback is currently `https://claude.ai/api/mcp/auth_callback`; Anthropic notes it may change to `https://claude.com/api/mcp/auth_callback`. The Auth Worker DCR test verifies that both callback URIs are accepted. Claude Desktop remote connectors must be added through **Settings → Connectors**, not by adding a remote server to `claude_desktop_config.json`.

This project cannot complete the real Claude UI connection until the staging endpoint is deployed and the user performs the Discord consent interaction. No Claude connector has been connected in this work.

## Rollback

- Record the previous deployed version ID for every staging Worker before enabling its endpoint.
- If the Auth/Gateway binding graph fails, disable public routing first; then restore compatible staging configs in reverse dependency order. Do not leave either Worker publicly exposed while its counterpart is missing or incompatible.
- Roll back only the affected staging Worker to a prior known-good version using Cloudflare's supported rollback workflow.
- A Worker rollback does not roll back connected KV/DO resources or data. Do not assume the v1 Durable Object migration can be undone by rolling back code. If a Durable Object lifecycle change has occurred, follow Cloudflare's migration-aware recovery guidance and retain the migrated class/version; never delete a namespace to force a rollback.
- Do not roll back or change any production Worker, Discord resource, bot role, or locked community service under this runbook.
## Current readiness

- Source and static config checks are green. Latest verified Actions run: `43948016687` on code commit `c4ddee478ec9ce320f5f4f5c195fd9a0bbdd4d50`; 87 unit/configuration tests and 33 Cloudflare Workers integration tests passed (120 total).
- The runbook's bootstrap order is documentation-only. No Cloudflare staging Worker, KV namespace, route, custom domain, Service Binding, or secret has been created or deployed by this project work.
- Cloudflare account values remain unverified: staging KV namespace ID, OAuth client/redirect settings, hostnames, five guild/application IDs, bot tokens, owner-approval secret, and five separate manager write secrets.
- Scope gate: only Dawn Dotta / Momentum Movement is currently authorized for live project work. Do not deploy or otherwise operate the Empress, Blickymania, BestYouEvaHad, or Red Kocaine manager services. The shared Gateway configuration references all five targets, and Cloudflare requires each binding target to exist before deploying the caller. Therefore Gateway deployment remains blocked unless the other four staging targets are already present and can be verified as staging-only without modifying them, or their scope is explicitly unlocked.
- Before any deployment, confirm all staging workers have no public route during bootstrap and explicitly disable Version/Preview URLs; `workers_dev: false` alone is insufficient protection. Keep OAuth/MCP hostnames unbound until the Auth↔Gateway reciprocal Service Bindings are complete.
- Do not perform live Discord writes. The executor remains covered by mocked tests; real message/channel mutations require a separate explicit staging test-write decision. No bot roles, production resources, or production deployments may be changed.
- No cron, scheduled maintenance, or duplicate monitoring was added. Existing GitHub Actions are push/PR/manual test workflows; Durable Object alarms are record-expiry cleanup, not a project-wide maintenance scheduler.
