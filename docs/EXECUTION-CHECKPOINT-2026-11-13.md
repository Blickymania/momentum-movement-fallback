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


## Cycle 6 — Gateway owner supervisor and private-schema migration (source-only)

### Implemented
- Added `implementation/gateway-owner-supervisor.mjs` and `implementation/gateway-owner-supervisor.test.mjs`.
- The supervisor acquires a lease before invoking Gateway login. If acquisition returns no row, it never invokes login.
- It provides a synchronous `assertOwned()` gate for adapter code, starts the lease heartbeat before login, races login against lease loss, and destroys the local Gateway when renewal fails or times out.
- If a Gateway connection resolves after the lease was lost during a pending login, the supervisor issues a second close after that late connection resolves.
- Graceful shutdown stops the heartbeat, destroys the local Gateway, then releases only the matching owner/epoch lease.
- The heartbeat interval and bounded renewal timeout remain referenced in Node so an active supervisor cannot silently exit merely because no other event-loop handle exists.
- Active leases cannot be reacquired by the same owner ID; each process instance must use a unique owner ID.
- The supervisor is source-only. It is not yet integrated into the Bot 005 startup path or the production event/side-effect handlers. A database lease does not physically fence another process; external hard-stop proof remains mandatory.

### Schema and data protection
- Added `migrations/001_gateway_ownership.sql`.
- The migration creates `failover.gateway_ownership` in a dedicated non-public schema, adds length/epoch constraints, and revokes schema/table privileges from `PUBLIC`.
- The lease module now qualifies all SQL against `failover.gateway_ownership`. Its optional schema bootstrap executes schema creation, table creation, and table revoke as three separate SQL statements.
- The migration has not been applied to any database. No schema, data, or credentials were changed.

### Tests and repairs
- The expanded local Node.js v22.16.0 isolated harness ran the eight lease logic tests plus six supervisor lifecycle tests and one schema-bootstrap test: **15 passed, 0 failed**.
- A first combined pass exposed that the heartbeat interval was unreferenced; corrected it so the supervisor itself keeps the Node process alive while active.
- Another pass exposed an old test assertion using the wrong acquisition inequality; corrected it to assert acquisition only when expired and renewal only while active.
- The tests use fake DB responses and injected login/destroy functions. They do not verify live PostgreSQL concurrency, real Discord Gateway behavior, process fencing, or an end-to-end failover.
- Earlier independent preflight tests remain 8/8 in the separate local harness. No hosted test job has executed.

### GitHub Actions and browser diagnosis
- Latest inspected push run: `43552702634` for commit `35aa10ea525e02645a11bd0be3cc4c0c0098c1b8`; result `startup_failure`; jobs endpoint returned an empty array.
- This is now repeated across multiple pushes. No runner started and there are no job-level logs.
- A read-only browser inspection was attempted for the private run and repository Actions settings. It could not access the private repository: `ERR_SOCKS_CONNECTION_FAILED`; the secure sign-in card expired. The exact startup reason and Actions permissions setting were not shown. No repository settings or workflows were modified by that browser attempt.
- Do not guess that the cause is billing, disabled Actions, permissions, or YAML. Those remain unverified.

### Latest verified state
- Lease module, supervisor module, two unit-test files, preflight service/test files, and private-schema SQL migration are committed.
- Local isolated lease + supervisor tests: 15/15 passed.
- Local isolated preflight tests: 8/8 passed in the previous verified run.
- GitHub Actions: latest observed run 43552702634 still startup_failure, zero jobs.
- Render service inventory remains inconclusive (`null`); no Render Postgres or Key Value instances listed.
- Supabase organization remains Free tier with two active OAuth-named projects; neither was repurposed.
- No independent coordination DB selected or connected.
- No Render or Supabase resource was created/upgraded; no billing approval was used.
- Bot 005 remains the sole active production Gateway owner. Its recovered source still calls `client.login(token)` without the new supervisor and includes the hard-coded coaching dependency `http://coaching-workflow.railway.internal:3000/interaction`.
- No standby Gateway session, production write, live failover, or failback test was attempted.

### Next execution steps
1. Get repository Actions run/settings visibility through a supported authenticated path; do not keep creating commits merely to provoke the same zero-job startup failure.
2. Resolve the Render service inventory response through a supported read-only API/dashboard path.
3. Compare exact paid persistent compute + database costs between Render and another independent provider; only then seek explicit cost authorization.
4. Migrate the Bot 005 coaching-workflow Railway-internal dependency and audit the Discord Manager `OAUTH_DATABASE_URL` host without printing credentials.
5. Integrate the supervisor into a separate reviewed Bot 005 candidate branch, with event-handler side-effect fencing and a rollback plan. Do not alter the live deployment.
6. Verify an external hard-stop/fencing controller can conclusively stop the old Gateway owner before a standby login.
7. Apply the private schema migration only after provider approval, then run real PostgreSQL concurrency, lease-expiry, DB outage and stale-epoch tests.
8. Only after primary and standby adapters, hard fencing, handler parity, idempotency and rollback are proven should controlled failover/failback be considered.


## Cycle 7 — Cloudflare SQLite Durable Object control-plane candidate (source-only)

### Implemented
- Added `cloudflare/gateway-lease-coordinator.mjs`: a single fixed-scope SQLite Durable Object for `momentum-movement:discord-gateway`.
- Added `cloudflare/worker.mjs`: bearer-authenticated HTTP front door with a public liveness route and an allowlist of four lease routes.
- Added `cloudflare/wrangler.jsonc`: SQLite Durable Object class binding and initial namespace migration.
- Added `implementation/cloudflare-gateway-lease-client.mjs`: bounded-timeout HTTPS client that rejects Railway/local/IP-literal hosts and maps HTTP 409 to a refused lease.
- Refactored `implementation/gateway-owner-supervisor.mjs` to accept a generic `leaseStore` adapter while preserving the PostgreSQL implementation as an alternative. Startup, heartbeat, local Gateway destruction, and release can now call the Cloudflare client without a Postgres client library.
- Added Durable Object SQLite tests and Worker/client integration tests.
- The Cloudflare Durable Object now returns a consistent success envelope from `GET /lease/state`, enforces GET-only on that route, limits request bodies, validates safe fencing epochs, and stores/returns the epoch as text to avoid JavaScript integer precision loss.
- Worker rejects lease service tokens outside 32–512 characters; client enforces the same bound.
- Fixed a client base-URL path bug for root URLs, trailing-slash normalization, and trailing-dot localhost validation.
- The Cloudflare code remains control plane only. It does not open a Discord Gateway or write to a Discord guild.

### Tests and verification
- Local Node.js v22.16.0 simulation harness used Node's real built-in SQLite engine plus a simulated Durable Object context, Worker namespace, and fetch boundary.
- Durable Object/SQLite API tests: 9 passed.
- Worker/client tests: 9 passed.
- Supervisor-to-Worker-to-Durable-Object local end-to-end ownership test: 1 passed.
- **Combined Cloudflare control-plane suite: 19 passed, 0 failed.**
- Coverage includes competing-owner denial, same-owner reacquisition denial, expiry/monotonic epoch increment, owner+epoch-bound renewal and release, state-read precision, invalid TTL/scope/epoch, authentication, method allowlist, JSON errors, timeout fail-closed, root URL composition, secret length validation, and supervisor primary/standby acquisition ordering.
- This is local simulation validation only. It is not a Cloudflare edge preview/runtime test and does not validate account plan, real namespace migrations, deployed secrets, real network partitions, or physical process fencing.
- Updated `docs/CLOUDFLARE-LEASE-CONTROL-PLANE.md` and `docs/INDEPENDENT-HOSTING-ARCHITECTURE.md` with the revised candidate and 19-test result.

### Cloudflare current-plan fit
- Cloudflare's official documentation describes Durable Objects as single-threaded coordination primitives with private, persistent storage and SQLite transactions. SQLite-backed Durable Objects are available on Workers Free and Paid.
- Published Free limits show 100,000 Worker requests/day, 100,000 Durable Object requests/day, 5 million SQLite row reads/day, 100,000 SQLite row writes/day, 5 GB storage, and 13,000 GB-s/day DO compute. If a limit is exhausted, that operation class fails until reset; the fail-closed lease logic must keep the standby disconnected and primary stop/close Gateway when renewal cannot complete.
- Rough baseline: primary heartbeat each 10 sec = 8,640 writes/requests/day; standby state check each 15 sec = 5,760 reads/requests/day; approximately 14,400 combined daily requests before retries/other account traffic. This appears within published Free limits, but actual account plan and usage are not yet verified.
- Cloudflare may remove the extra managed database fee for this control-plane use, but it does not supply the always-on Bot 005/standby runtime.
- Official references: https://developers.cloudflare.com/durable-objects/platform/pricing/ ; https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/ ; https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/ ; https://developers.cloudflare.com/workers/platform/pricing/ ; https://developers.cloudflare.com/workers/platform/limits/
- No Worker, Durable Object namespace, secret, route, DNS record, account plan, or billing setting has been created or modified.

### GitHub Actions status
- Most recent inspected run after the Cloudflare implementation commits: `43553376060`, head SHA `83c1222260e50cc2bcef0ab878d081887dd8626b`, push event, conclusion `startup_failure`; jobs endpoint returned an empty list.
- Other immediately preceding runs `43553359701` and `43553352346` failed the same way.
- No runner executed the test workflow. Do not report GitHub-hosted CI as passing and do not continue pushing commits solely to provoke the same startup failure. Exact account Actions plan/permission cause remains unknown; the prior browser attempt could not retrieve the private repository page.

### Verified current state
- Cloudflare SQLite Durable Object control-plane code and its worker/client adapter are committed but undeployed.
- Cloudflare local simulation suite: 19/19 passed.
- PostgreSQL lease backend remains source-only alternative; migration unapplied.
- No independent runtime or production lease store has been selected/deployed.
- Render service inventory remains inconclusive (`null`); no Render Postgres/Key Value listed.
- Supabase Free organization retains two active OAuth-named projects; no re-use/upgrade/new project.
- Cloudflare account plan and usage have not yet been verified; a read-only dashboard inspection was started, with no account setting changed.
- Bot 005 remains sole production Gateway owner, untouched. It still has the hard-coded Railway-internal coaching-workflow URL and no supervisor integration.
- Discord Manager OAuth DB host still unknown; no credentials exposed.
- No external hard-stop controller exists yet. No standby Gateway session, production Discord write, live failover/failback, or physical process-fencing test has been performed.

### Next steps
1. Complete read-only Cloudflare account plan/usage and Durable Object inventory inspection. Do not create resources or change plan.
2. Complete a read-only Render dashboard inventory to resolve the null service-list response.
3. Select the persistent independent Gateway runtime only after reviewing actual always-on pricing and operational features.
4. Migrate the Bot 005 coaching workflow internal dependency and audit the Discord Manager OAuth database host safely.
5. Build a candidate Bot 005 adapter against the Cloudflare leaseStore interface on a separate review branch; gate every privileged event handler and side effect with ownership assertion/fencing.
6. Implement and verify out-of-band hard-stop control for the old Gateway process before any standby login can occur.
7. Deploy only preproduction control plane/runtime after account plan, cost, secrets and service scope are reviewed and explicitly authorized. Do not connect it to the production guild during preproduction.
8. Run real edge tests, failover/failback, expired lease, DB/Worker outage, late login, duplicate side-effect, process kill, and rollback before any controlled production cutover.


## Cycle 8 — Bot 005 event and outbound egress fencing adapters (source-only)

### Implemented
- Added implementation/discord-gateway-ownership-guards.mjs.
- Added implementation/discord-gateway-ownership-guards.test.mjs.
- Added implementation/fenced-discord-gateway-owner.mjs.
- Added implementation/fenced-discord-gateway-owner.test.mjs.
- Ownership guard wraps Discord client.login(), client.on(), client.once(), client.rest.request(), and the configured process fetch target.
- Direct Gateway login and event listeners are denied until the supervisor supplies a live ownership assertion.
- Every non-coordinator outbound fetch requires the active lease assertion. Railway hostnames (including the recovered coaching-workflow.railway.internal URL) and rlwy.net endpoints are rejected regardless of whether a lease is held.
- The one-time event wrapper preserves listeners when an event fires before ownership exists; an event without ownership is dropped without consuming the once-listener.
- The prepared owner adapter creates the Cloudflare lease client before global fetch is wrapped, installs egress guards immediately after Discord Client construction, and only allows the shared supervisor to invoke client.login().
- A denied lease returns lease_unavailable and keeps the bot disconnected. Graceful shutdown revokes outbound calls, destroys the local client, then releases the exact owner/epoch lease.

### Repairs discovered by tests
- First guard test run exposed EventEmitter.once() internally calling .on(), which double-wrapped one-time listeners. Replaced it with an explicit once wrapper registered through the original on method.
- A second test showed the one-time listener could be consumed before ownership when an event arrives early. The wrapper now checks ownership before removing itself, preserving the listener until the first authorized invocation.
- The direct REST and fetch wrappers throw synchronously when lease ownership is missing/revoked; tests were updated to assert the synchronous fail-closed contract.
- Added an unconditional Railway endpoint rejection so an active lease cannot accidentally re-enable the old in-cluster coaching dependency.

### Verification
- Reran the whole local suite under Node.js v22.16.0 with real Node SQLite for the Durable Object simulation and mocked Discord clients/HTTP transport.
- Cloudflare Durable Object and Worker/client suite: 19 passed.
- Ownership guard suite: 6 passed.
- Prepared Discord owner adapter integration suite: 2 passed.
- **Combined latest local test result: 27 passed, 0 failed.**
- The prepared-owner test verifies guard installation, pre-lease listener suppression, lease acquisition before client.login, authorized REST/fetch while owned, egress revocation on shutdown, exact lease release, and no login when acquisition returns conflict.
- These are isolated local tests. No real Discord.js package/runtime integration, Cloudflare edge deployment, real process kill, real network partition, or end-to-end production failover was tested.

### Critical remaining integration constraints
- The helper must be invoked immediately after constructing the Bot 005 Discord Client and before registering the source's application event listeners. It has not yet been inserted into the recovered Bot 005 application.
- The exact deployed Discord.js version is not recorded in the recovered source snapshot. The helper requires a writable client.rest.request hook; if the runtime does not expose it, setup throws before Gateway login. Verify against the exact runtime package before preparing a candidate release.
- A REST request already transmitted cannot be cancelled by this guard after lease loss. Side effects need handler-level fencing/idempotency and reconciliation.
- The hard-coded coaching workflow endpoint is now explicitly denied by the guard; the service must be moved to a public HTTPS endpoint and configured before coaching handlers are available.
- The out-of-band hard-stop controller is still absent. A lease or REST gate does not close a different process's already-open Gateway socket.

### Latest verified state
- Cloudflare lease control plane remains source-only and has 27 combined local tests passing.
- PostgreSQL backend/migration remain unused source-only alternatives.
- No Cloudflare resource, Worker, Durable Object namespace, service secret, plan, route, DNS, or billing setting has been created or modified.
- Cloudflare account plan/usage browser inspection is still running with no findings returned; no account setting changed.
- GitHub Actions remains blocked before job creation (startup_failure, empty job list). This new push will also be event-triggered; do not call hosted CI successful or infer a cause.
- Render inventory remains inconclusive for services; no Render Postgres or Key Value instance was found.
- Supabase remains Free with its two active OAuth-named projects; neither has been changed.
- Bot 005 remains the sole live Gateway owner. No production changes, standby login, guild write, failover or failback test.
- No billing authorization or paid provisioning.

### Next actions
1. Complete read-only Cloudflare account plan/namespace inventory; if browser inspection cannot finish, record unavailable and do not change account resources.
2. Resolve Render service inventory and inspect candidate persistent worker configuration without creating resources.
3. Identify the exact Discord.js/Bun runtime version for Bot 005 and run compatibility tests for client.login and client.rest.request interception.
4. Migrate the coaching-workflow service and replace the hard-coded Railway URL with a required HTTPS environment setting; keep it disabled until target service parity is proven.
5. Audit Discord Manager OAUTH_DATABASE_URL host without exposing the credential.
6. Build a reviewed candidate copy of Bot 005 source with the guard installed immediately after Client construction, before all listeners, and the prepared owner at startup. Do not modify the recovered production snapshot or deploy to production.
7. Implement an independent hard-stop controller with process/service identity and positive termination confirmation.
8. Complete real Cloudflare preproduction namespace testing, exact runtime compatibility, PostgreSQL/SQLite coordination outage testing, failover/failback, side-effect idempotency, and rollback before production cutover.


## Cycle 9 — verified hard-stop takeover gate and application readiness (source-only)

### Implemented
- Added implementation/standby-hard-stop-controller.mjs and implementation/standby-hard-stop-controller.test.mjs.
- The controller reads the Momentum Movement lease and refuses to stop an unexpected active owner.
- It requires provider stop evidence that matches the exact primary owner ID, deployment ID, and process ID, with state=stopped, confirmed=true, and gatewayClosed=true.
- If any field is missing, mismatched, false, or the provider adapter throws, the controller does not release the lease and does not invoke standby startup.
- Once stop proof is exact, it releases only the matching old primary lease epoch, re-reads the lease, and refuses takeover if an active owner remains.
- Only then does it invoke a standby callback. That callback must start through the fenced owner supervisor, not direct client.login.
- Added application-level readiness signaling to implementation/fenced-discord-gateway-owner.mjs:
  - markApplicationReady() must be called by the application only after verifying the expected bot identity and target guild.
  - markApplicationNotReady() clears that state if the bot/guild verification is lost.
  - waitUntilReady() allows the orchestration layer to wait for the application-level ready signal.
  - The ready getter now requires both supervisor Gateway login completion and explicit application readiness.
  - Lease loss/shutdown clears readiness and rejects outstanding readiness waiters.
- The standby hard-stop controller accepts the standby only when the start callback returns an owner reporting ready=true. The callback must await the prepared owner's waitUntilReady() before returning that confirmation.

### Tests and repair
- Local Node.js v22.16.0 combined test suite: **35 passed, 0 failed**.
  - 19 Cloudflare/SQLite coordinator and Worker/client tests.
  - 6 Gateway ownership guard tests.
  - 2 prepared owner/application readiness tests.
  - 8 hard-stop controller tests.
- Tests cover exact primary stop identity, explicit Gateway closure, unexpected owner denial, controller failure, expired lease handling, lease release/re-read, application READY gating, denied lease no-login, and egress revocation.
- Tests use Node's SQLite engine for the local Durable Object simulation and fake Discord client / fake provider stop responses. They do not kill a real runtime process, connect to live Discord Gateway, or validate Cloudflare edge execution.
- Updated the Cloudflare control-plane and independent-hosting architecture docs with the new contract and remaining limitations.

### Physical stop integration status
- No provider-specific processControl.stopAndConfirm adapter exists yet.
- Render service inventory still returned null, so the exact runtime service identity/process API has not been resolved.
- Existing Bot 005 still runs on the legacy Railway footprint. The locked policy does not allow future recovery/failover to depend on Railway.
- A one-time controlled migration away from the existing Railway primary is distinct from the future failover mechanism; it must be manually/externally controlled and verified before any independent standby login.
- The hard-stop controller is not usable for production until the exact host adapter can positively prove the old process is stopped and its Gateway connection has closed.

### Latest verified state
- Cloudflare Durable Object control-plane and client remain source-only, with 19 control-plane tests passing.
- Gateway event/REST/fetch guards and prepared owner adapter are source-only; Bot 005 recovered source has not been patched.
- Standby hard-stop orchestration is source-only, without provider API adapter.
- Full local test suite: 35/35 passed.
- GitHub Actions latest inspected push runs still fail with startup_failure and zero jobs; no runner logs exist. No claim of hosted CI success.
- Cloudflare account plan/usage browser inspection run remains non-terminal after 510 seconds with no findings. No Cloudflare settings/resources were changed.
- Render service inventory is inconclusive; Postgres and Key Value inventory returned no instances.
- Supabase Free account remains with two active OAuth projects; no new project or upgrade.
- No Cloudflare Worker, Durable Object namespace, secret, host service, database, or paid resource created.
- Bot 005 remains sole production Gateway owner and has not been stopped, restarted, redeployed, or changed.

### Next execution steps
1. Resolve the read-only Cloudflare plan/resource inventory through a responsive account page or connector route; if not available, record as unavailable and do not change account settings.
2. Resolve Render service inventory through a responsive dashboard/API route and identify whether a paid persistent Worker/Background Worker can be used.
3. Determine exact Bot 005 runtime framework and discord.js version from a source/package artifact independent of Railway deployment data; verify guard interception against that exact version.
4. Prepare a separate candidate copy of Bot 005 that installs ownership guards immediately after Client construction, before all event listeners, then calls the prepared owner adapter. Keep recovered production snapshot unchanged.
5. Replace the coaching workflow Railway-internal URL with a required public HTTPS service endpoint after that service's migration and parity test.
6. Implement the provider-specific stopAndConfirm adapter and verify it can terminate the old process by exact identity and report Gateway closure.
7. Audit Discord Manager OAUTH_DATABASE_URL host without printing credentials.
8. Only after provider plan/cost, hard-stop, runtime compatibility, independent coordination and rollback are verified should any preproduction deployment or production cutover be considered.
