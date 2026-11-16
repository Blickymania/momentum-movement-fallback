# Claude MCP Gateway Checkpoint — 2026-11-16 — Dawn-Only Staging Variant Ready

## Project and scope
- Repository: `Blickymania/momentum-movement-fallback`
- Staging branch: `infra/claude-five-server-gateway-staging`
- Current execution scope: Dawn Dotta / Momentum Movement only.
- Four other manager projects remain locked. They were not inspected, modified, configured, or deployed in this cycle. Do not touch them unless the user explicitly unlocks them.
- The full five-server gateway configs remain preserved for a later authorized rollout.

## Completed work
- Created a separate Dawn-only Resource/Gateway config:
  - File: `claude-gateway/wrangler.dawn-dotta.jsonc`
  - Worker: `discord-claude-gateway-dawn-staging`
  - Service Bindings: `AUTH_SERVER` → `discord-claude-auth-dawn-staging`; `MANAGER_DAWN_DOTTA` → `manager-dawn-dotta-staging`.
- Created a separate Dawn-only Auth config:
  - File: `claude-gateway/auth-worker/wrangler.dawn-dotta.jsonc`
  - Worker: `discord-claude-auth-dawn-staging`
  - Reciprocal Service Binding: `GATEWAY_SERVER` → `discord-claude-gateway-dawn-staging`.
  - Dedicated `OAUTH_KV` namespace ID remains blank until created in the staging Cloudflare account.
- The Dawn-only Resource/Auth configs and authorized Dawn manager config use `workers_dev: false`, `preview_urls: false`, `keep_vars: true`, and omit dashboard-managed `vars`.
- Added a fourth static config test to verify the Dawn-only Gateway/Auth pair has exactly the intended two service bindings and no references to the four locked manager targets.
- Scoped the config test so it reads only the Dawn manager config and shared Gateway/Auth configs; it no longer reads the four locked manager configs.
- Rewrote the deployment runbook for the Dawn-only staging target, including:
  - Account-owned values and secrets.
  - Two-phase Auth bootstrap to resolve reciprocal Service Binding target ordering.
  - Dawn manager → Auth bootstrap → Dawn Gateway → final Auth → public routes last.
  - Claude custom connector OAuth setup, token refresh vs Discord reauthorization, and rollback precautions.
- The full five-server configs remain unchanged and are not the deployment target for this execution.

## Verification
- Latest green CI run: `43950271609`
- Run commit: `707b27b5b3d97a35ee43504f6e1b185f33495e96`
- Conclusion: `success`
- Clean Node 22 `npm ci --no-audit --no-fund`: passed.
- `npm run check`: TypeScript passed; 88 unit/configuration tests passed across 10 files.
- `npm run test:workers`:
  - Auth Worker: 11 integration tests passed across 3 files.
  - Proposal/owner-approval/MCP/resource Worker suite: 24 integration tests passed across 4 files.
- Total: 123 passing tests.
- CI remains test-only, least-privilege (`contents: read`), and does not deploy.

## Other verified project capabilities
- MCP handler tests verify registration, owner-approved execution, pending proposal refusal, requester binding, and server isolation.
- Resource Worker tests verify OAuth token audience, Bearer challenge, authenticated MCP read, approved execution, and Discord credential expiry/reconnect challenge.
- Auth Worker tests verify fresh Discord reauthorization after expiry, MCP OAuth `offline_access` refresh, and Claude DCR callback URIs.
- MCP OAuth refresh is supported; it preserves the linked Discord credential. Discord refresh tokens are not persisted, so expired Discord credentials require fresh Discord authorization. The fresh authorization path is integration-tested.
- The executor remains limited to `message.send` and allowlisted `channel.update`; no role changes, permission overwrites, deletes, or bulk operations.

## External staging blockers
- No Cloudflare account connector or writable dashboard session is available. Browser access is read-only.
- Required account-owned values are still missing/unverified:
  - Dedicated Dawn staging `OAUTH_KV` namespace and its ID.
  - Dawn Discord guild/application IDs.
  - Discord OAuth client ID/secret and exact redirect URI.
  - Two approved HTTPS hostnames (OAuth issuer and MCP resource).
  - Dawn bot token, Dawn manager write secret, matching Gateway write secret, Auth/Gateway owner-approval secret, and Auth session encryption key.
- The Auth/Gateway/manager secret names are documented in the runbook. No secret values were read, copied, or written.
- No Cloudflare Worker, KV namespace, route, custom domain, Service Binding, or secret has been created or deployed by this project work.
- Real Claude UI connection/reconnect acceptance remains pending the deployed endpoint and user Discord consent. Browser connector is read-only; no Claude UI actions were performed.
- No Ui.Vision workstation is registered in TRIGGERcmd; no remote Ui.Vision execution is available in this session.

## Safety and scheduler state
- No production deployment or production Discord resource change.
- No Discord bot roles changed; preserve names, permissions, hierarchy, positions, and assignments.
- The four locked manager projects remain untouched.
- No secrets exposed.
- No schedulers, cron jobs, reminders, or recurring maintenance created or changed.
- No production release authorized.

## Exact next execution step
The Dawn-only staging code/config is ready for account setup. The Cloudflare account owner must create the dedicated Dawn `OAUTH_KV` namespace, choose the two HTTPS hostnames, set the dashboard-managed OAuth/guild/application variables, and enter the listed staging secrets. Once those are in place, execute the runbook's Dawn-only two-phase deployment. Do not deploy the full five-server config or touch the four locked manager projects.
