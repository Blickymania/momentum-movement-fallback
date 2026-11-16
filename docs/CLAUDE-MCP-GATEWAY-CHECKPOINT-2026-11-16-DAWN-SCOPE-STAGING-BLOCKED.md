# Claude MCP Gateway Checkpoint — 2026-11-16 — Dawn Scope, 122 Tests Green, Staging Blocked

## Project and branch
- Repository: `Blickymania/momentum-movement-fallback`
- Staging branch: `infra/claude-five-server-gateway-staging`
- Components: OAuth authorization Worker, OAuth-protected MCP resource Worker, five-server gateway source, private manager Worker templates, proposal/audit Durable Object.
- The codebase retains the five-server architecture, but the current execution scope is Dawn Dotta / Momentum Movement only. Four other manager projects remain locked. Do not inspect, modify, deploy, audit, or otherwise touch them unless the user explicitly unlocks them.

## Completed and verified
- Approved-write MCP tool is registered and tested through the real MCP handler.
- Owner-approved proposal execution is tested end-to-end in-process, including pending-proposal rejection, original requester binding, selected-server isolation, one-time consume, execution lease, and audit recording.
- OAuth-protected resource Worker integration tests cover:
  - Unauthenticated Bearer challenge.
  - Resource-bound token audience validation.
  - Authenticated MCP tool discovery and manager read after current Discord Administrator verification.
  - Approved proposal execution after OAuth identity and current Admin checks.
  - Missing/near-expiry Discord credential rejection with HTTP 401 `invalid_token` reconnect challenge.
- Auth Worker integration tests cover Discord authorization-code flow, PKCE, browser-bound callback state, consent, read-only scope, fresh Discord reauthorization after the old credential expires, MCP OAuth `offline_access` refresh-token grant, and Claude callback registration.
- MCP OAuth refresh is supported and tested. It renews the MCP OAuth credential but preserves the linked Discord access token. The Discord refresh token is not persisted; an expired Discord credential therefore requires a fresh Discord authorization. That reauthorization flow is integration-tested.
- Claude DCR callback test accepts `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`.
- Added staging deployment runbook documenting the reciprocal Service Binding bootstrap sequence, Claude connector setup, rollback, and external prerequisites.
- Added static config tests scoped to the authorized Dawn manager plus shared Gateway/Auth configs. The test no longer reads the four locked manager configs.

## Latest verification
- Final clean CI run: `43949705016`
- Run commit: `51a1952bfae36727b3fa3699a028fc3af4cc8495`
- Conclusion: `success`
- `npm ci --no-audit --no-fund`: passed.
- `npm run check`: TypeScript passed; 87 unit/configuration tests passed across 10 files.
- `npm run test:workers`:
  - Auth Worker: 11 integration tests passed across 3 files.
  - Proposal/owner-approval/MCP/resource Worker suite: 24 integration tests passed across 4 files.
- Total: 122 passing tests.
- CI is test-only, uses least-privilege `contents: read`, uses `npm ci`, and does not deploy.

## Current staging configuration facts
- Authorized Dawn Dotta manager config:
  - `manager-dawn-dotta-staging`
  - `workers_dev: false`
  - `preview_urls: false`
  - `keep_vars: true`
  - Dashboard-managed variables are omitted from the committed `vars` block.
  - No public routes or embedded secrets.
- Shared Gateway and Auth configs:
  - `workers_dev: false`, `preview_urls: false`, and `keep_vars: true`.
  - Dashboard-managed `vars` are omitted from the committed configs to avoid overwriting existing dashboard values.
  - The resource Gateway still declares Service Bindings to all five manager service names plus Auth.
  - Auth has the reciprocal `GATEWAY_SERVER` Service Binding.
  - Auth declares a dedicated `OAUTH_KV` binding with a blank namespace ID.
  - Durable Object bindings/migrations are present for the proposal store and OAuth one-time store.
- The four other manager projects are locked. Do not inspect or change their configs, secrets, routes, preview settings, or deployment state. Their existing targets are not considered available for this execution.
- Because the shared Gateway config references all five manager services, the full Gateway cannot be deployed while the four manager targets remain locked. The safe options are:
  1. The user explicitly unlocks all five manager projects for the full five-server staging deployment; or
  2. The user explicitly authorizes a separate Dawn-only Gateway/Auth config variant that references only Dawn Dotta.
- No Dawn-only Gateway/Auth variant has been created or deployed.

## External blockers and required account-owned inputs
- No Cloudflare account connector or writable dashboard session is available in this execution. The Browser connector is read-only.
- The Cloudflare staging zone/hostnames, public routes/custom domains, `OAUTH_KV` namespace ID, Discord client ID/redirect URI, guild/application IDs, and secret values remain unconfigured or unverified.
- The committed Auth/Resource configs omit dashboard-managed vars; the account owner must set the required values in Cloudflare dashboard or an uncommitted local config. Do not commit secrets.
- Expected secret inputs (names only):
  - Auth Worker: `DISCORD_CLIENT_SECRET`, `AUTH_SESSION_ENCRYPTION_KEY`, `OWNER_APPROVAL_INTERNAL_SECRET`.
  - Resource Worker: matching `OWNER_APPROVAL_INTERNAL_SECRET` and one distinct `MANAGER_WRITE_SECRET_*` for each manager when that manager is authorized.
  - Dawn manager: `DISCORD_BOT_TOKEN` and its matching unique `MANAGER_WRITE_SECRET`.
- The current five-server Service Binding cycle requires a two-phase Auth bootstrap: deploy Auth without `GATEWAY_SERVER`, deploy Gateway after its targets exist, then redeploy Auth with the final binding. The runbook documents this, but no deployment was attempted.
- Real Claude connector setup and reconnect acceptance remain unperformed. No Ui.Vision workstation is registered in TRIGGERcmd; no remote Ui.Vision execution is possible in this session.

## Safety and scheduler state
- No production deployment or production Discord resource change.
- No Discord bot role changed; preserve role names, permissions, hierarchy, positions, and assignments.
- No secret values read, copied, or written.
- No schedulers, cron jobs, reminders, or recurring maintenance created or changed.
- CI is read-only/test-only and does not deploy.
- No production release authorized.

## Exact next execution step
Obtain one scope decision before staging deployment: keep the four other manager projects locked and authorize a Dawn-only Gateway/Auth config variant, or explicitly unlock all five for the full five-server Gateway. Then obtain the Cloudflare staging hostnames, KV namespace ID, and required account-owned configuration/secrets. Until those decisions and inputs exist, continue only with shared-code tests and Dawn-scoped work; do not deploy.
