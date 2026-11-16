# Claude MCP Gateway — Staging Deployment Runbook

## Scope and safety
- Deploy only to the staging Worker names in the staging Wrangler configs.
- Do not deploy to production, merge to the production branch, change Discord resources, or modify any Discord bot role.
- Manager Workers remain private: `workers_dev: false`, no public routes, and reachable only through the resource Worker's Service Bindings.
- Do not put bot tokens, write secrets, OAuth client secrets, or encryption keys in source, Wrangler `vars`, command-line arguments, logs, or chat. Use Cloudflare's secret input prompts.

## Why the first deployment needs two phases
Cloudflare documents that Service-Binding target Worker B must already exist before caller Worker A is deployed; otherwise the caller's deployment fails. Workers are deployed separately. See the [Cloudflare Service Bindings deployment guidance](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).

This project has a reciprocal reference:
- Resource/Gateway Worker calls Auth Worker through `AUTH_SERVER`.
- Auth Worker calls Resource/Gateway Worker through `GATEWAY_SERVER`.

A first deployment cannot satisfy both references simultaneously. Bootstrap by temporarily deploying the Auth Worker without its gateway binding, then deploy the Gateway, then redeploy Auth with the final reciprocal binding.

## Required account-owned staging inputs
Do not proceed until the Cloudflare account owner has supplied/configured:
1. A dedicated staging KV namespace for `OAUTH_KV`; set its actual namespace ID in `auth-worker/wrangler.jsonc`.
2. A Cloudflare-managed zone and two HTTPS hostnames:
   - MCP resource endpoint: `MCP_RESOURCE_URL=https://<mcp-host>/mcp`
   - OAuth issuer: `OAUTH_ISSUER_URL=https://<auth-host>`
3. Auth OAuth variables:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_REDIRECT_URI=https://<auth-host>/discord/callback`
   - Five fixed `GUILD_ID_*` values.
4. The same five guild IDs in the resource Worker's `GUILD_ID_*` variables.
5. For each manager config, its matching `DISCORD_GUILD_ID` and `DISCORD_APPLICATION_ID`.
6. Secrets entered through Cloudflare:
   - Auth Worker: `DISCORD_CLIENT_SECRET`, `AUTH_SESSION_ENCRYPTION_KEY`, `OWNER_APPROVAL_INTERNAL_SECRET`.
   - Resource Worker: five distinct `MANAGER_WRITE_SECRET_*` values and the matching `OWNER_APPROVAL_INTERNAL_SECRET`.
   - Each manager Worker: its own `DISCORD_BOT_TOKEN` and matching per-server `MANAGER_WRITE_SECRET`.
7. The same randomly generated `OWNER_APPROVAL_INTERNAL_SECRET` value on Auth and Resource/Gateway Workers. Each manager's write secret must be unique to that manager and match only its corresponding gateway secret.

The resource and auth Wrangler configs currently have `workers_dev: false` and no route/custom-domain declarations. They will not provide a public MCP/OAuth endpoint until the account owner chooses and configures the two HTTPS hostnames and their Cloudflare routes/custom domains. Do not invent a hostname or expose the manager Workers publicly.

## Deployment order

### 1. Configure staging values and secrets
- Fill the blank staging placeholders in the Auth and Resource Wrangler configs.
- Fill each manager's guild and application ID.
- Create the dedicated `OAUTH_KV` namespace and insert its ID.
- Enter secrets using `wrangler secret put` or the Cloudflare dashboard. Never commit secret values.
- Confirm all five guild IDs are valid Snowflakes and pairwise distinct; confirm each manager application ID matches its bot application.
- Confirm the resource and auth URLs use HTTPS and the Discord redirect URI exactly matches the Discord Developer Portal redirect URI.

### 2. Deploy the five private manager Workers
From the `claude-gateway` directory, deploy each separate config:
```bash
npx wrangler deploy --config manager-worker/wrangler.empress.jsonc
npx wrangler deploy --config manager-worker/wrangler.blickymania.jsonc
npx wrangler deploy --config manager-worker/wrangler.bestyouevahad.jsonc
npx wrangler deploy --config manager-worker/wrangler.red-kocaine.jsonc
npx wrangler deploy --config manager-worker/wrangler.dawn-dotta.jsonc
```
Do not add routes or custom domains to these Workers.

### 3. Bootstrap the Auth Worker without its reciprocal Gateway binding
- Make a temporary local copy of `auth-worker/wrangler.jsonc` named `auth-worker/wrangler.bootstrap.jsonc`.
- In the temporary copy only, remove the `GATEWAY_SERVER` entry from `services`. Keep the same Worker name, OAuth/KV settings, Durable Object binding/migration, and configured public OAuth hostname/route.
- Deploy the temporary config:
```bash
npx wrangler deploy --config auth-worker/wrangler.bootstrap.jsonc
```
- Do not commit the temporary bootstrap config. The Auth Worker can now exist as the target of the Gateway's `AUTH_SERVER` binding. Owner-approval callbacks that require `GATEWAY_SERVER` are not ready until step 5.

### 4. Deploy the Resource/Gateway Worker with its final bindings
```bash
npx wrangler deploy --config wrangler.jsonc
```
At this point, all five manager targets and the Auth Worker target exist.

### 5. Redeploy Auth with the final reciprocal Gateway binding
- Deploy the canonical config, which restores `GATEWAY_SERVER`:
```bash
npx wrangler deploy --config auth-worker/wrangler.jsonc
```
- Remove the temporary local `auth-worker/wrangler.bootstrap.jsonc` file.
- Confirm the Auth Worker can call the Gateway through its private binding and the Gateway can call Auth through `AUTH_SERVER`.

## Staging acceptance tests
Do not treat successful deployment as acceptance. Verify:
1. Auth and MCP endpoints respond only on the intended HTTPS hostnames.
2. OAuth protected-resource and authorization-server metadata identify the configured resource/issuer correctly.
3. Discord login, callback browser-state binding, guild filtering, consent, PKCE token exchange, and read-only `mcp:read` grant succeed.
4. MCP client can initialize and list tools.
5. Each of the five managers returns only its own application/guild identity and read inventory.
6. A non-owner cannot approve an owner-only proposal; the guild owner can approve the exact action once.
7. The original authorized requester can execute the approved proposal; another requester or server cannot.
8. Manager write secret isolation, action hash, one-time consumption, execution lease, retry behavior, and audit result are verified.
9. Expired/near-expiry Discord credentials return the tested 401 reconnect challenge; a fresh Discord authorization restores access.
10. Confirm no manager Worker has a public route and no bot-role operations exist in the allowed write surface.

## Rollback
- Keep the last known-good staging Worker versions available until the complete acceptance suite passes.
- If a staging Worker fails, roll back only that staging Worker to its prior known-good version using the Cloudflare dashboard or the supported Wrangler rollback flow.
- If a reciprocal binding change fails, restore the last known-good matching configs for both sides. Do not leave one Worker pointing at a missing or incompatible service.
- Do not roll back or change any production Worker, Discord resource, or bot role under this runbook.

## Current readiness
- Source, static config consistency, OAuth/resource integration tests, and 120 automated tests are verified.
- No Cloudflare staging Worker, KV namespace, route, custom domain, Service Binding, or secret has been created or deployed by this project work.
- The next blocker is account-owned staging setup: Cloudflare zone/hostnames, KV namespace ID, five guild/application IDs, and secret entry. Once these are configured, the two-phase deployment order above can be executed.
