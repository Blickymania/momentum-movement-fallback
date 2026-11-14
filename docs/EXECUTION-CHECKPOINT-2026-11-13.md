# Execution Checkpoint — Dawn Dotta / Momentum Movement Failover

Updated: 2026-11-13 US Eastern (latest execution through 2026-11-14 03:31 UTC)

## Project and locked architecture
Dawn Dotta / Momentum Movement — Railway-independent Core Shadow / Bot 005 failover.

- Railway is not a deployment dependency for recovery, coordination, or future failover.
- Bot 005 remains the only production Discord Gateway owner until a verified, controlled cutover is possible.
- Core Shadow must run on a genuinely independent persistent host.
- The coordination database must be independent of Railway.
- Primary and standby must use the same lease/heartbeat/monotonic-fencing protocol.
- A database lease is not physical fencing of an already-open Discord Gateway socket. The old process must be positively stopped before a new Gateway owner can log in.
- Cloudflare is limited to HTTP control-plane/monitoring duties; it is not the persistent Discord Gateway runtime.
- No split-brain, duplicate Gateway owner, or unsafe automated failback is acceptable.

## Production baseline and safety
- Discord guild: `1565048205970767992`
- Bot application: `1565304619838742598`
- Railway project/environment/services remain historical/current production footprint only; no Railway deploy or recovery action is permitted.
- Recovered Bot 005 source calls `client.login(token)` directly and has no shared lease acquisition/heartbeat/fencing protocol.
- Recovered Core Shadow source is read-only HTTP and does not own a Gateway or write Discord data.
- The previous Bun preflight source at `implementation/momentum-movement-core-shadow-preflight.ts` is legacy/source-only. It accepts generic `DATABASE_URL` and is not the approved independent-host entry point. Do not deploy it for the independent runtime.
- No production Bot 005 process was stopped, restarted, redeployed, or modified.
- No standby Gateway connection was opened. No production Discord writes were enabled.

## Completed implementation

### Cycle 1 — recovery inspection and architecture decision
- Read back the recovered Bot 005, Core Shadow, and preflight artifacts.
- Verified the primary startup path does not yet implement lease fencing and that the old Core Shadow is read-only.
- Committed `docs/INDEPENDENT-HOSTING-ARCHITECTURE.md`.
- Inspected Cloudflare browser tab metadata; it was an account member-policy page, not a Worker deployment page. No Cloudflare resources were created or modified.

### Cycle 2 — shared lease primitives (source-only)
- Added `implementation/shared-gateway-lease.mjs` with atomic PostgreSQL upsert acquisition, database-clock expiry, owner/epoch-scoped renewal and release, monotonic fencing epoch advancement, and fail-closed heartbeat behavior.
- Added `implementation/shared-gateway-lease.test.mjs`; the current suite has eight tests.
- Hardened acquisition so an unexpired lease cannot be reacquired even by a process reusing the same owner ID. Every process start must use a unique owner ID.
- Added a bounded renewal timeout so a hung database heartbeat triggers the fail-closed callback instead of waiting indefinitely.
- A test initially exposed that an unreferenced timeout could let a quiet Node process exit before fail-closed handling. Removed `unref()` from the renewal timeout, reran the suite, and verified 8 passed, 0 failed under Node.js v22.16.0.
- Tests remain mock-backed SQL/logic tests, not live PostgreSQL concurrency or physical Gateway-fencing tests.

### Cycle 3 — GitHub Actions and Render inspection
- User confirmed Render workspace `My Workspace`, ID `tea-dbcqe7ss728c73fthlug`.
- Render service inventory returned literal `null` on multiple calls. This remains inconclusive; it does not prove that no services exist.
- Render Postgres inventory returned `No Postgres instances found`.
- Render Key Value inventory returned `No Key Value instances found`.
- No Render resource or paid service was created.
- Added `package.json` and event-triggered `.github/workflows/failover-tests.yml`; no scheduled trigger was added.
- GitHub Actions run `43550719031`, commit `cc3f630ccdb0351f5f02bca4f1300465eeec7119`, concluded `startup_failure`. The Actions API showed zero jobs, so no runner/job executed and there are no job logs. The exact cause was not returned.
- The repository is private and the connected GitHub repository response reports admin/push access. The available GitHub fetch endpoint rejected the Actions permissions/check-suite metadata routes; exact repository Actions policy/billing settings remain unverified.
- Correction: the six lease tests did pass in an isolated local harness, but the repository GitHub Actions workflow did not execute on that run.

### Cycle 4 — independent Node.js preflight service (source and tests committed)
- Added `implementation/momentum-movement-independent-preflight.mjs`.
- Added `implementation/momentum-movement-independent-preflight.test.mjs`.
- Updated `package.json` with a Node.js start command and pinned `postgres` driver version `3.4.7`.
- The service provides read-only `GET /healthz`, `GET /readyz`, and `GET /preflight` endpoints; non-GET requests return 405.
- Readiness requires `COORDINATION_DATABASE_URL`; it validates a PostgreSQL URL and rejects Railway hostnames and local/private loopback-style hosts. It does not fall back to the legacy generic `DATABASE_URL`.
- Optional `PRIMARY_HEALTH_URL` probing requires HTTPS and rejects all hostnames containing Railway references (including public Railway domains), local hostnames, and literal IPv4/IPv6 addresses. The coordination database URL also rejects Railway hostnames and all IP literals. This probe is diagnostic only and does not authorize takeover.
- The service uses no Discord client, opens no Gateway, performs no Discord writes, never returns configured URLs/credentials, and has graceful SIGTERM/SIGINT shutdown.
- Local Node.js v22.16.0 run of the committed implementation/test logic: 8 tests passed, 0 failed, including Railway-domain and IPv4/IPv6 literal rejection. Tests use an injected fake DB driver; they verify endpoint behavior, input validation, and fail-closed readiness, not a real hosted database connection.
- No deploy was triggered and no infrastructure was provisioned. Bot 005 remains untouched.
- GitHub Actions was configured to run for changes under `implementation/**`. Runs `43550719031`, `43551272700`, `43551816064`, `43552064479`, and `43552078940` all ended `startup_failure`; direct jobs reads for the latest three IDs returned empty job arrays. The runner never started, so no job-level logs exist and the exact root cause remains unknown.

## Render workspace inventory — latest
Workspace: `My Workspace` (`tea-dbcqe7ss728c73fthlug`).
- Workspace list confirms it is available.
- Service list returned literal `null` on three reads across preview-inclusive and preview-excluded calls; inventory remains unknown.
- Postgres list: no Postgres instances found.
- Key Value list: no Key Value instances found.
- No resources were created, updated, deleted, deployed, or charged.

## Existing scheduled processes
The prior automation inventory contained 25 tasks. Relevant five-server/Dawn/Momentum maintenance/failover tasks were disabled. No scheduler, cron, reminder, or recurring repair was created or changed. Preserve the user's maximum-one-centralized-maintenance-process rule; do not duplicate existing tasks.

## Verified state now
- Lease module committed; mock-backed local tests: 8/8 passed after duplicate-owner and hung-heartbeat timeout hardening.
- Independent Node preflight service and tests committed; current local Node tests: 8/8 passed after expanding Railway hostname and literal-IP rejection.
- GitHub Actions latest inspected runs `43552064479` and `43552078940`: startup_failure, zero jobs; no runner logs and cause still unknown. Earlier inspected runs `43550719031`, `43551272700`, and `43551816064` failed the same way.
- Render workspace confirmed; services inventory inconclusive; no Render Postgres or Key Value instances listed.
- No independent coordination database is connected. Supabase Free already has two active OAuth-named projects; Render has no listed Postgres/Key Value store and its service inventory response is inconclusive.
- No independent standby runtime is deployed.
- Production Bot 005 remains the sole Gateway owner.
- No production lease/fencing integration or hard-stop/fencing controller exists yet.
- No live failover/failback test has been attempted.
- No paid resource or billing change has been authorized or made.

## Next execution steps
1. Continue diagnosing GitHub Actions startup failure through any supported UI or connector route; no further workflow edits should be made until its environment blocker is understood.
2. Resolve Render service inventory via another supported read-only route; do not infer an empty workspace from a null response.
3. Choose the independent coordination database: compare Render paid Postgres against a dedicated Supabase Pro project and present exact costs before any paid provisioning.
4. Migrate or replace the Bot 005 coaching-workflow Railway-internal dependency and audit the Discord Manager OAuth database host/config before a Railway-independent claim.
5. Add a versioned lease-table migration only after the database provider is approved, then run integration tests against a disposable real PostgreSQL instance.
6. Implement the primary Bot 005 lease adapter and an external hard-stop controller. Keep existing Bot 005 untouched until a reviewed, reversible migration can be applied safely.
7. Implement standby runtime with Gateway login disabled until primary and hard-stop path are verified.
8. Execute failover/failback, lease expiry, DB outage, split-brain, duplicate-event, process termination, and rollback tests before any live cutover.

## Explicit gates
- Do not deploy this preflight service until an independent coordination database is available and its URL is validated.
- Do not provision billable resources without explicit approval of the exact recurring cost.
- Do not deploy a free sleeping web service as an always-on standby.
- Do not use Railway DATABASE_URL, Railway PostgreSQL, or Railway internal hostnames for coordination.
- Do not attempt any Gateway takeover or primary shutdown as part of a test until lease integration and positive physical fencing are proven.


### Cycle 5 — database/provider constraints and full dependency scan
- Read Supabase organization details: organization `Blickymania` is on the Free tier.
- Listed two active healthy Supabase projects: `discord-oauth-control-plane` and `blickymania-discord-oauth`. The inspected `public` and `private` schemas contained no tables. Both projects were left untouched because they are OAuth-named resources and the organization already uses its two Free active-project slots.
- Current Supabase pricing states Free is limited to two active projects, and Pro starts at $25/month with additional projects from $10/month. No upgrade or new Supabase project was created. Source: https://supabase.com/pricing.
- Current Render pricing lists the smallest persistent service/background worker at $7/month and the smallest paid Postgres instance at $6/month. Reference floor is approximately $13/month for one process plus one DB, excluding usage/workspace-specific charges. Render Free Postgres expires after 30 days, has no backups, and may be restarted; it is not suitable for production coordination. Sources: https://render.com/pricing and https://render.com/docs/free.
- Full-string scan of recovered Bot 005 source found a hard-coded internal dependency: `http://coaching-workflow.railway.internal:3000/interaction`. That coaching service path must be migrated or replaced before the full runtime can be called Railway-independent.
- Recovered Discord Manager source reads `RAILWAY_SERVICE_KEY` and `OAUTH_DATABASE_URL`; the actual OAuth database host is not in source and remains unverified. Its health payload reports `service: "railway"`, and write-guard messages refer to Railway. This requires configuration/identity cleanup and a credential-free host audit during migration.
- Recovered Core Shadow source body contains no `.railway.internal` or `DATABASE_URL` reference; it is still read-only and does not open a Gateway.
- No Render/Supabase resources, services, databases, or credentials were created or changed. No billing or plan upgrade was performed.
