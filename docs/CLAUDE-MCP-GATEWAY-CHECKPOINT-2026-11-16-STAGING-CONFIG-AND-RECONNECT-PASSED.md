# Claude MCP Gateway Checkpoint — 2026-11-16 — Staging Config and Reauthorization Verified

## Project and component
- Repository: `Blickymania/momentum-movement-fallback`
- Staging branch: `infra/claude-five-server-gateway-staging`
- Components: OAuth authorization Worker, OAuth-protected MCP resource Worker, five private manager Workers, proposal/audit Durable Object.
- Scope: five independent Discord communities; no merging.

## Completed cycle
- Audited the five separate manager Wrangler configs, resource Worker config, and auth Worker config.
- Found that the MCP resource Worker code requires five fixed `GUILD_ID_*` variables, but its Wrangler config did not declare them. Added all five as blank staging placeholders.
- Added `test/staging-config.test.ts` to validate:
  - Five unique private manager Worker names/config files.
  - `workers_dev: false` and no public routes on every manager.
  - Blank guild/application ID placeholders and no embedded bot/write secrets.
  - Resource Worker bindings to the auth Worker and all five manager Workers.
  - Reciprocal auth-to-resource Service Binding.
  - Resource Worker `WRITE_PROPOSAL_STORE` and auth Worker `OAUTH_ONE_TIME_STORE` Durable Object bindings.
  - Dedicated `OAUTH_KV` binding placeholder.
- The first config-test attempt exposed that the gateway tsconfig intentionally limits global types to Cloudflare Worker types. Added the existing `@types/node@26.6.6` package as a direct dev dependency and scoped its triple-slash type reference to the Node-only config test. The lockfile was updated; no Worker runtime globals were changed.
- Added an auth-worker integration helper and test that completes a fresh Discord authorization-code/consent/token flow after the old Discord credential is rejected. The new grant contains the fresh Discord access token and current guild access is restored. This verifies the supported reconnect path; it does not add automatic refresh-token persistence.
- Updated README test evidence and documented the refresh-token limitation and required Cloudflare staging setup.

## Test and verification evidence
- Final clean CI run: `43947251381`
- Run commit: `730b4366724e95225dbed0f7d56f1245814d054a`
- Run conclusion: `success`
- `npm ci --no-audit --no-fund`: passed.
- `npm run check`: TypeScript passed; 87 unit/config tests passed across 10 files.
- `npm run test:workers`:
  - Auth Worker: 9 integration tests passed across 3 files, including fresh Discord reauthorization after expiry.
  - Proposal/owner-approval/MCP/resource Worker suite: 24 integration tests passed across 4 files.
- Total verified tests: 120 passed.
- CI remains least-privilege (`contents: read`), uses `npm ci`, runs tests only, and does not deploy.

## Staging configuration audit
- Resource Worker `wrangler.jsonc`:
  - Six private Service Bindings: `AUTH_SERVER` plus five manager services.
  - `WRITE_PROPOSAL_STORE` Durable Object binding/migration.
  - `MCP_RESOURCE_URL`, `OAUTH_ISSUER_URL`, and all five `GUILD_ID_*` values are blank placeholders.
- Auth Worker `auth-worker/wrangler.jsonc`:
  - Private `GATEWAY_SERVER` binding to `discord-claude-gateway-staging`.
  - `OAUTH_ONE_TIME_STORE` Durable Object binding/migration.
  - Dedicated `OAUTH_KV` binding exists with blank namespace ID.
  - OAuth URLs, Discord client ID/redirect URI, and five guild IDs are blank placeholders.
- Five manager configs:
  - `manager-empress-staging`
  - `manager-blickymania-staging`
  - `manager-bestyouevahad-staging`
  - `manager-red-kocaine-staging`
  - `manager-dawn-dotta-staging`
  - Each has `workers_dev: false`, blank guild/application ID placeholders, no public routes, and no embedded secrets.
  - Service names match the resource Worker's five private manager bindings.
- Secret values are not present in source/config and were not read. Expected secret bindings:
  - Auth Worker: `DISCORD_CLIENT_SECRET`, `AUTH_SESSION_ENCRYPTION_KEY`, `OWNER_APPROVAL_INTERNAL_SECRET`.
  - Resource Worker: five distinct `MANAGER_WRITE_SECRET_*` values and the matching `OWNER_APPROVAL_INTERNAL_SECRET`.
  - Each manager Worker: its own `DISCORD_BOT_TOKEN` and corresponding `MANAGER_WRITE_SECRET`.
- No live Cloudflare account state was inspected; existence of services, KV namespace, secrets, and Service Binding connectivity remains unverified.

## Remaining objectives
1. Determine and document a safe bootstrap/deployment order for the reciprocal Auth Worker ↔ resource Worker Service Bindings and five manager Worker bindings. Confirm whether Cloudflare accepts forward references or whether a two-phase staging bootstrap is needed.
2. Obtain the staging-only `OAUTH_KV` namespace ID and the five actual guild/application IDs from the Cloudflare account, then set them only in staging config.
3. Create/configure the five staging manager Workers and their unique bot/write secrets, the gateway's five corresponding write secrets, the auth Discord client secrets, and the shared owner-approval internal secret. Do not expose secret values.
4. Deploy only to staging after the account owner has supplied/configured those values; then verify each private Service Binding and real OAuth flow with test credentials.
5. Complete real Claude client authorization and reconnect acceptance. Browser connector is read-only and no Ui.Vision workstation is registered, so no direct client UI or Ui.Vision execution has been claimed.
6. Keep production deployment, production branch merge/cutover, Discord resource writes, and all bot-role changes out of scope until full staging acceptance and a separate release decision.

## Safety and scheduler state
- No production deployment or production Discord resource change.
- No Discord bot roles changed; preserve names, permissions, hierarchy, positions, and assignments.
- No secret values read, copied, or written.
- No schedulers, cron jobs, reminders, or recurring maintenance created or changed.
- CI is read-only/test-only and does not deploy.
- No production release authorized.

## Last verified state
- Clean install: passed.
- Unit/config tests: 87 passed.
- Auth Worker integration tests: 9 passed.
- Proposal/owner-approval/MCP/resource Worker integration tests: 24 passed.
- Total: 120 passing tests.
- CI run `43947251381`: completed successfully.
- All five manager configs and reciprocal service-binding names are statically consistent.
- All required staging IDs/URLs/KV namespace ID remain placeholders; Cloudflare resources and secrets remain unverified.
- Automatic Discord refresh-token persistence is not implemented. The supported reconnect path is a new Discord authorization flow, now integration-tested.
- Production state unchanged.

## Exact next execution step
Research and verify Cloudflare's service-binding deployment semantics for reciprocal Worker references. Based on authoritative Cloudflare documentation, prepare a staging-only bootstrap sequence that avoids broken references or temporary public endpoints. Do not deploy.
