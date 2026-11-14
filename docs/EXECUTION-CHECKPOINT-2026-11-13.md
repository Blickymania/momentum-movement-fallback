# Execution Checkpoint — Dawn Dotta / Momentum Movement Failover

Updated: 2026-11-13 US Eastern (latest execution through 2026-11-14 03:xx UTC)

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
- Added `implementation/shared-gateway-lease.test.mjs` with six tests.
- Local isolated Node.js v22.16.0 test harness: 6 passed, 0 failed. This is mock-backed SQL/logic testing, not a live PostgreSQL concurrency or physical Gateway-fencing test.

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
- Optional `PRIMARY_HEALTH_URL` probing requires HTTPS and rejects Railway internal hosts and local/private targets. This probe is diagnostic only and does not authorize takeover.
- The service uses no Discord client, opens no Gateway, performs no Discord writes, never returns configured URLs/credentials, and has graceful SIGTERM/SIGINT shutdown.
- Local Node.js v22.16.0 run of the committed implementation/test logic: 8 tests passed, 0 failed. Tests use an injected fake DB driver; they verify endpoint behavior, input validation, and fail-closed readiness, not a real hosted database connection.
- No deploy was triggered and no infrastructure was provisioned. Bot 005 remains untouched.
- GitHub Actions was configured to run for changes under `implementation/**`, so these new commits are eligible to trigger CI. The available connector does not expose a push-run listing method; a successful hosted CI run has not been verified.

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
- Lease module committed; mock-backed local tests: 6/6 passed.
- Independent Node preflight service and tests committed; local Node tests: 8/8 passed.
- GitHub Actions last inspected run: startup_failure, zero jobs; cause still unknown.
- Render workspace confirmed; services inventory inconclusive; no Render Postgres or Key Value instances listed.
- No independent coordination database is connected.
- No independent standby runtime is deployed.
- Production Bot 005 remains the sole Gateway owner.
- No production lease/fencing integration or hard-stop/fencing controller exists yet.
- No live failover/failback test has been attempted.
- No paid resource or billing change has been authorized or made.

## Next execution steps
1. Read back the new GitHub files and verify committed contents match the locally tested files.
2. Diagnose the GitHub Actions startup_failure with any supported run/check metadata; do not claim a root cause while there are no runner logs.
3. Resolve Render service inventory through another supported read-only route; do not infer an empty workspace from a null response.
4. Select and inspect an external coordination database that is independent of Railway; do not place secrets in source or logs.
5. Add a versioned lease-table migration and run integration tests against a disposable real PostgreSQL instance before using any production database.
6. Implement the primary Bot 005 lease adapter and external hard-stop controller. Keep existing Bot 005 untouched until a reviewed, reversible migration can be applied safely.
7. Implement the standby runtime with Gateway login permanently disabled until the primary and hard-stop path are verified.
8. Execute failover/failback, lease expiry, DB outage, split-brain, duplicate-event, process termination, and rollback tests before any live cutover.

## Explicit gates
- Do not deploy this preflight service until an independent coordination database is available and its URL is validated.
- Do not provision billable resources without explicit approval of the exact recurring cost.
- Do not deploy a free sleeping web service as an always-on standby.
- Do not use Railway DATABASE_URL, Railway PostgreSQL, or Railway internal hostnames for coordination.
- Do not attempt any Gateway takeover or primary shutdown as part of a test until lease integration and positive physical fencing are proven.
