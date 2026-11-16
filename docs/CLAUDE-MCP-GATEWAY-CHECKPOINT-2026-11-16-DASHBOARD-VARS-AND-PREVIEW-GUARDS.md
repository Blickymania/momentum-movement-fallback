# Claude MCP Gateway Checkpoint — 2026-11-16 — Dashboard Variables and Preview Guards

## Project and component
- Repository: `Blickymania/momentum-movement-fallback`
- Branch: `infra/claude-five-server-gateway-staging`
- Verified branch head: `33486098724b09451d762e047be62e70946ff52f`
- Components: Cloudflare OAuth authorization Worker, OAuth-protected MCP Gateway, five separate manager Worker templates, and the approved-proposal/audit Durable Object.
- Current execution scope: Dawn Dotta / Momentum Movement only. Four other manager projects remain locked.

## Completed cycle
- Corrected the source-of-truth handling for staging variables. The Auth Worker, shared Gateway, and Dawn Dotta manager Wrangler configs now omit dashboard-managed values from `vars` rather than declaring blank values with the same names.
- Kept `keep_vars: true` on those configs so dashboard-managed staging variables can be retained during deployment.
- Explicitly set `preview_urls: false` on the Auth Worker, shared Gateway, and Dawn Dotta manager config. All three also retain `workers_dev: false`.
- Left the four other manager configs untouched. Their source still contains blank same-name guild/application placeholders and does not explicitly set `preview_urls: false`; they remain locked and must not be deployed or changed until their scope is explicitly unlocked.
- Narrowed `test/staging-config.test.ts` to inspect only Dawn Dotta's manager config and the shared Gateway/Auth binding names. It no longer reads the four locked manager config files.
- Updated the staging runbook to document:
  - The target-first Cloudflare Service Binding rule and two-phase bootstrap for the reciprocal Auth ↔ Gateway reference.
  - No public OAuth/MCP hostname or route until both directions of the Service Binding graph are in place.
  - Explicit Version/Preview URL controls; `workers_dev: false` alone is not sufficient.
  - Dashboard vars must not be duplicated as blank Wrangler vars.
  - Dawn-only scope and the fact that the shared Gateway cannot deploy unless all five manager target services exist.
  - No live Discord message/channel write during acceptance without a separate explicit staging test-write decision.
  - Durable Object migration/rollback caveats.
- Updated `claude-gateway/README.md` with the staging variable/preview safeguards and the runbook link.

## Test and verification evidence
- GitHub Actions run: `43949395686`
- Run URL: https://github.com/Blickymania/momentum-movement-fallback/actions/runs/43949395686
- Tested commit / verified branch head: `33486098724b09451d762e047be62e70946ff52f`
- Result: `success`
- `npm ci --no-audit --no-fund`: passed (315 packages installed from lockfile).
- `npm run check`: strict TypeScript passed; 87 tests passed across 10 files.
- `npm run test:workers`:
  - Auth Worker: 11 integration tests passed across 3 files, including fresh Discord reauthorization after the previous credential expired.
  - Proposal/owner-approval/MCP/resource Worker suites: 24 integration tests passed across 4 files.
- Total: 122 passing tests (87 unit/config + 35 Workers integration).
- All CI workflow steps completed successfully. The workflow runs tests only and has no deployment step.

## Failure and recovery notes
- First config hardening test run failed because three stale assertions still referenced the removed `guildVars` fixture. Removed those stale assertions and clarified the test intent.
- A run on the immediately preceding commit passed the corrected TypeScript/unit stage but its Workers integration job was cancelled by the next push because the existing workflow uses `cancel-in-progress: true`.
- The complete, uncancelled run `43949395686` on the latest branch head passed all stages. No retries remain pending.

## Current readiness and blockers
- Source and automated tests are green. This is still source-level and mocked integration verification only.
- No Cloudflare account was connected or inspected during this cycle. No staging Worker, KV namespace, custom domain, route, Service Binding, or secret was created or deployed.
- Account-owned staging inputs remain unverified/unconfigured: dedicated `OAUTH_KV` namespace ID, OAuth client/redirect settings, approved HTTPS hostnames, guild/application IDs, Discord bot tokens, encryption key, owner-approval internal secret, and the per-manager write secrets.
- The current scope permits only Dawn Dotta / Momentum Movement. The shared Gateway Wrangler config references all five manager Worker targets. Cloudflare requires a Service Binding target Worker to exist before the caller can be deployed. The Gateway therefore remains blocked unless all four locked targets already exist and can be safely verified as staging-only without operating those projects, or their scope is explicitly unlocked and the missing configs are repaired under that authorization.
- Do not deploy the shared Gateway by creating placeholder or public proxy Workers. Do not deploy any of the four locked manager configs.
- Do not perform real Discord message/channel writes or any bot-role changes. Live writes remain outside this staging acceptance cycle.
- Production deployment, production merge/cutover, and production Discord changes remain out of scope.

## Scheduler and recovery state
- No cron, scheduled maintenance task, reminder, duplicate monitor, or recurring repair was created.
- Existing GitHub Actions are push/PR/manual test workflows. Durable Object alarms expire and clean up individual one-time/proposal records; they are not a centralized project maintenance scheduler.
- Source-level recovery primitives remain covered by tests: proposal idempotency, one-time approval consumption, execution leases/fencing tokens, bounded retry attempts, stale-result rejection, and immutable audit rows.

## Last verified state
- Branch head: `33486098724b09451d762e047be62e70946ff52f`
- CI run `43949395686`: success.
- TypeScript: passed.
- Unit/config tests: 87 passed.
- Workers integration tests: 35 passed.
- Total automated tests: 122 passed.
- Auth/Gateway/Dawn config hardening is present and tested.
- No production or live Discord resources changed; no secrets exposed; no bot roles changed.

## Exact next execution step
Complete the account-owned staging preflight once a Cloudflare staging account connection and required values are available. Verify the staging KV namespace, hostnames, current dashboard-managed variables, Worker existence, route/Version/Preview URL states, and secrets without revealing their values. Before any deployment, resolve the four locked manager target dependencies without touching those projects unless explicitly unlocked. Then execute only the documented two-phase Auth ↔ Gateway bootstrap with all targets present, keeping public routes disabled until reciprocal Service Bindings are verified. Keep production and real Discord writes out of scope.
