# Momentum Movement failover — checkpoint
Updated: 2026-11-13
Scope: Dawn Dotta / Momentum Movement only. No other community may be changed.

## Latest cycle: Cloudflare permissions and production inventory

### Cloudflare account permission — verified
- Account: Redcell4400@gmail.com's Account (account ID `7738d94fbc5466ad91eb65045ee746f2`).
- Authenticated member: `redcell4400@gmail.com`.
- Member permission policy page: `/members/8d991c673ebed0041bf06be51ddc3262/policies`.
- Exact displayed policy: Scope = entire account; Role = **Super Administrator - All Privileges**; Granted by = Account.
- This verifies the account's assigned Super Administrator policy. It does not itself create or verify a VPC Service, Tunnel, or Hyperdrive binding. Cloudflare's VPC documentation separately names Connectivity Directory Admin for VPC Service creation; do not silently change role assignments. Verify actual operation access when provisioning is otherwise ready.
- No Cloudflare resource, Worker, Tunnel, VPC Service, Hyperdrive, secret, DNS, or billing change was made.

### Railway production — re-inventoried
- Project: Dawn Dotta / Momentum Movement; project ID `a1d6b0e4-3169-4c5d-add3-84a70f7dc525`.
- Production environment: `c72ea3d9-2c1c-4651-a265-79723e317fa5`.
- Environment inventory: 34 services; 0 staged changes.
- Manager service `596b402b-936b-490e-97c7-d41d9ed87caf` latest deployment remains SUCCESS: `f878c9c8-4513-4d44-9a80-d546096d074f`. Keep production untouched.
- OAuth PostgreSQL service `3e71f6b5-a248-40b6-b185-a748a5f5b436` remains private-only with persistent volume; prior TCP proxy inventory was empty. No public TCP endpoint has been created.
- Existing News Forum 24h Retention Cleanup deployment remains CRASHED; known root cause is Discord 404 Unknown Channel for retired forum target. Current service start command is configured as no-op, but expired Railway trial blocks applying it via redeploy. No retry or service change in this cycle.
- Existing cron services were inventoried in prior checkpoint (15 existing scheduled services); no new schedule, automation, reminder, cron, or monitor created. Railway Automations listing was attempted and returned "Railway Automations is not enabled for this user." No centralized maintenance/recovery scheduler was found in the inventory; do not create one or consolidate existing jobs without a source/dependency audit.

### CI execution failure — rechecked
- Repository: `Blickymania/momentum-movement-fallback`.
- Branch: `infra/dawn-dotta-cloudflare-worker`.
- Latest observed Actions run: `43537580422`, workflow ID `417875803`, branch run event push, conclusion `startup_failure`, path `BuildFailed`, zero jobs returned.
- The latest commit status is pending with zero status contexts. This is not a passing CI result.
- Re-running an empty job list cannot repair a workflow that fails before job creation. Do not keep retrying without new evidence or change application source to compensate for an Actions control-plane/startup failure.
- Source-level checks from prior checkpoint: 18 Worker invariants and 9 config/parity assertions passed in isolated JS execution. They are not npm tests, TypeScript compilation, Wrangler dry-run, or runtime tests.
- The workflow YAML itself is simple: checkout, setup Node 22, npm install, npm run check. No evidence yet that its steps execute.

## Architecture and safety posture
- Preferred private path remains Cloudflare Worker → Hyperdrive → Workers VPC TCP Service → Cloudflare Tunnel running inside the same Railway private network → Railway private OAuth PostgreSQL.
- This avoids public database exposure, but a continuously running `cloudflared` process inside the Railway private network is still required.
- Railway trial expiry currently blocks provisioning a new persistent connector service. Do not repurpose the production Manager or database, enable public TCP proxy, select a paid plan, or add a card.
- Render cold fallback package exists, but the Render workspace has not been explicitly selected by the user. Do not create or deploy Render resources without that selection.
- Existing Cloudflare Worker `empress-discord-cloudflare` is another community's resource; never modify or route Momentum Movement through it.
- Router/Worker code remains isolated in GitHub; no Cloudflare deployment or production cutover has occurred. Worker config intentionally has no fabricated Hyperdrive ID.

## Cycle result
- Cloudflare account Super Administrator policy: verified from the member Permission Policies page.
- Railway production inventory and no-staged-change state: verified.
- Manager latest deployment: SUCCESS.
- Railway Automations feature: unavailable to this account.
- GitHub Actions startup failure: reconfirmed; zero jobs.
- No production services, databases, Discord resources, credentials, DNS, billing, or scheduled processes changed.

## Remaining objectives
1. Find a permitted, persistent, no-cost/renewable host for `cloudflared` inside the Dawn Railway private network, or another officially supported private connectivity option. Do not expose the OAuth DB publicly.
2. Verify Cloudflare VPC Service creation permission at actual provisioning time; account Super Admin policy alone is not a substitute for a successful VPC API/dashboard authorization.
3. Diagnose GitHub Actions startup failure from available run/job metadata or repository Actions settings; avoid repeated empty reruns. If no runner can be authorized, record this external blocker and do not claim build success.
4. Obtain a real executable environment for `npm run typecheck`, `npm test`, both Wrangler dry-runs, and OAuth/Discord integration tests. Do not claim these have passed until output is inspected.
5. Review OAuth DB initialization and concurrency/transaction behavior; test against an isolated Dawn-only database before any production binding.
6. Deploy only isolated Dawn test resources after the private network and DB path are available. Verify health, readiness, OAuth flows, bot identity, read-only audit, and controlled write tests with writes disabled initially.
7. Validate router failover against verified endpoints; never replay a timed-out Discord write.
8. Resolve the retired News Forum cleanup crash only when a permitted deployment path is available; apply the already-configured no-op and verify its runtime exit.
9. Preserve Railway as production until the replacement and rollback are fully verified.

## Exact next execution step
Continue independent code/CI diagnostics and investigate no-cost persistent connector hosting/private-network options. Re-check current Cloudflare Hyperdrive/VPC inventory when the authenticated tab is navigated there. Keep production and private database configuration unchanged.


## Additional independent diagnosis — plan limits and Actions dispatcher

### Railway free-tier capacity constraint
- Current Railway pricing page states the Free plan becomes limited to 3 services per project after the trial (and 1 project), while this Dawn production project currently inventories 34 services. Hobby has a $5 minimum usage commitment.
- Therefore, adding a new cloudflared service to this already 34-service project is not a credible no-cost path after trial expiry. Do not attempt it, delete/merge existing production services to make room, or select Hobby without user authorization.
- Pricing source reviewed: https://railway.com/pricing

### GitHub Actions startup failure diagnosis
- Latest run metadata confirms an empty workflow name, synthetic path `BuildFailed`, conclusion `startup_failure`, and zero jobs. The dedicated jobs endpoint also returned an empty list.
- This failure occurs before any runner/job exists; therefore the workflow's npm/typecheck/test steps never ran. Rewriting source or changing npm scripts cannot repair a failure that occurs before job construction.
- Similar 2026 GitHub Community reports document the same signature (BuildFailed, startup_failure, zero jobs) and discuss repository workflow-dispatch/registration or account-level restrictions, but these are community reports and do not establish this repository's root cause. No account billing setting was inspected or changed.
- Evidence source: https://github.com/orgs/community/discussions/209847
- The GitHub connector rejected direct check-suite and workflow-registry API reads as unsupported. No evidence supports deleting/recreating workflows or altering repository Actions settings. Preserve workflow history and avoid speculative mutations.

### Result and next step
- No new infrastructure, billing, workflow, or production changes.
- The two major blockers are now more precisely bounded: no permitted always-on private-network connector host on the current no-paid-plan constraint, and GitHub Actions dispatcher failure before job creation.
- Continue isolated code review and identify any other safe non-deployment verification. Resume provisioning only when a compliant private-network host and an executable test path exist.


## Additional alternative-path review — managed free Postgres

- Reviewed current official free-tier limits for two managed Postgres options as possible alternatives to a Railway-hosted `cloudflared` connector.
- Neon Free: 1 GB Postgres storage/project, 100 compute-unit-hours/project/month, 5 GB public transfer, but compute is forced to scale to zero after 5 minutes idle and cannot be configured always-on on Free. A continuously active 0.25-CU database would exceed the monthly compute allowance. This is a cold/low-traffic test option, not a dependable always-on production OAuth database. Sources: https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md and https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md
- Supabase Free: 500 MB Postgres/project; a project with insufficient user database activity over 7 days may be paused. This also cannot be treated as an always-on production dependency. Sources: https://supabase.com/pricing and https://supabase.com/docs/guides/platform/free-project-pausing
- Existing Supabase projects are for other community scopes and remain untouched. No Neon or Supabase project was created, no account was connected, and no database was migrated.
- Either provider could potentially support an isolated compatibility test or cold fallback, but transparent primary/fallback continuity would require both Railway and Cloudflare to share the same OAuth state, a carefully planned migration, and a verified rollback. Do not create a separate divergent OAuth database and call it failover.
- Conclusion: no verified zero-cost always-on shared database/network path is available from current connected resources. Continue design/review without modifying production until a suitable persistent host or user-approved shared DB migration path exists.


## Continuation protocol locked in
- Added `infra/failover/CONTINUATION-PROTOCOL.md` as the durable execution contract for this project.
- Protocol explicitly requires autonomous next-cycle selection after each checkpoint; no "NEXT" prompt; continue independent tasks around blockers; no background-work claims; resume from newest checkpoint.
- Scheduler policy locked: no new cron/reminder/automation/duplicate monitor; preserve existing schedules and maximum one centralized maintenance/recovery process only if later required.
- Production/security guardrails and exact checkpoint fields are documented in the protocol.
- This is a repository-level continuation contract, not a background daemon or scheduled automation. No scheduler was created or changed.
- Next action: continue independent code/security review of the isolated Worker and router, then make the smallest evidence-backed correction and test it in an executable environment if available.


## Continuation lock-in and next code-review cycle

### Durable continuation protocol — committed and read back
- Added `infra/failover/CONTINUATION-PROTOCOL.md`.
- Protocol commit: `35a3fc0b1ea2749d6f8dd2d8f27452aca41c288f`.
- Read-back verified protocol status ACTIVE, no "NEXT" prompt requirement, checkpoint fields, scheduler restrictions, production safeguards, objective queue, and session-boundary truthfulness.
- Updated this checkpoint with the continuation record: commit `26c742a4125d34f4308c7b2a4a952cb8a64dbcd8`.
- This is a persistent repository-level execution contract, not a background agent or recurring job. No scheduler was created or changed.

### OAuth code-review and test-coverage cycle
- Reviewed Worker OAuth registration, authorization, callback, code exchange, refresh rotation, revocation, authentication, schema initialization, and per-request PostgreSQL client lifecycle.
- Verified in source that authorization codes are selected with `FOR UPDATE` and marked consumed; refresh tokens are selected with `FOR UPDATE`, revoked with `replaced_by`, and replaced in the same transaction; bearer tokens are SHA-256 hashed before persistence; DB client lifetime is request-scoped and closed in `finally`.
- Added five static source-invariant tests for schema retry after failed initialization, one-time authorization-code consumption, atomic refresh-token rotation, token hashing, and request-scoped DB client cleanup.
- Test change commit: `1a96aac82a3de3fad3b4c4c010ddd9aac9c3cea9`; test blob SHA `3b3fdab11d127169ecb21c95f157a8f5ccb4d9c3`.
- Read-back verified 14 test cases in the test file. An isolated V8 syntax parse of the test module (after removing Node imports and replacing the file URL reference) succeeded. Five corresponding assertions evaluated true against the fetched current Worker source.
- These are static source checks only. Node's `node --test`, TypeScript compilation, Wrangler dry-run, DB integration, and OAuth flow tests have NOT been executed.

### GitHub Actions failure — latest push reconfirmed
- New push run ID `43541928680`, commit `1a96aac82a3de3fad3b4c4c010ddd9aac9c3cea9`.
- Result: `startup_failure`, path `BuildFailed`, zero jobs. The workflow's npm/test steps did not execute.
- This reproduces the pre-job startup failure; no additional blind rerun was made. Do not describe CI as passing.

### Production and scheduler state
- No Railway, Cloudflare, Discord, database, secret, DNS, billing, or production resource was modified in this cycle.
- No scheduler, cron, reminder, automation, monitor, or recurring repair process was created or changed.
- Railway production remains the authoritative Manager.

### Exact next execution step
Continue independent security and runtime-compatibility review of the isolated Worker/router, prioritizing request limits, timeout/cancellation behavior, health/readiness semantics, and OAuth edge cases. Add only evidence-backed tests or fixes. Keep pursuing an executable test path without paid services or production changes.


## Runtime-boundary review cycle — bounded Discord calls

### Evidence reviewed
- Reviewed the Worker request handler, readiness endpoint, OAuth handlers, guild audit, capability inventory, and Discord API call sites.
- Cloudflare's current Workers limits page (updated Nov 13, 2026) states Free plan: 10 ms CPU per HTTP request, 128 MB memory, 50 subrequests per invocation, and 6 simultaneous outgoing connections. HTTP-triggered request wall time has no hard limit while the client remains connected. Source: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare's Workers best-practices documentation recommends enforcing request-body limits before fully buffering user input and streaming large payloads. Source: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- The router's 70-second Render cold-fallback probe is not independently disqualified by a hard HTTP wall-time cap, but still depends on the calling client remaining connected and on Render actually waking. It remains a cold fallback only, not a verified primary.
- Reviewed outbound fetch call sites. Most already use AbortSignal timeouts; the channel ownership lookup and final Discord API operation did not.

### Implemented
- Added a 12-second timeout to the Discord channel ownership lookup.
- Added a 15-second timeout to the final Discord API read/write operation. No retry was added; a timed-out write remains an unknown outcome and must not be replayed automatically.
- Source change commit: `6dcc729aec9e1971d74fa3e42cd1472e2fc16fa2`.
- Added two static source-invariant tests for those bounded timeouts.
- Test change commit: `5ffdff921eae4d96b3be3fa967156ae1cba57328`.
- Read-back verified both timeout patterns in the source and 16 test cases in the test file. Isolated V8 syntax parsing succeeded after removing Node-specific imports and the `import.meta` file reference.
- This did not run the Node test runner, TypeScript compiler, Wrangler build, or live Discord tests.

### CI failure reconfirmed
- Push run for latest test commit: `43542084034`, conclusion `startup_failure`, path `BuildFailed`.
- Jobs endpoint returned an empty array. Workflow steps did not execute.
- Several sequential push runs show the same pre-job startup failure. No further blind retries were made.

### Production and scheduler
- No production service, Discord resource, database, Cloudflare resource, secret, DNS, or billing setting changed.
- No scheduled automation, cron, reminder, monitor, or recovery process created or changed.

### Next execution step
Continue reviewing Worker input validation, MCP request parsing, and OAuth redirect/state edge cases. Preserve no-retry semantics for any Discord write whose outcome is uncertain. Seek a local reproducible Node/Wrangler test path without a paid service or production mutation.


## Bounded request parsing cycle — implemented and exercised

### Changes
- Added `readBoundedText`, which checks declared Content-Length, streams request chunks, tracks bytes, cancels the reader on overflow, and releases the reader lock.
- Applied separate limits: MCP JSON-RPC requests 2 MiB; dynamic OAuth client registration 64 KiB; OAuth token and revocation form bodies 16 KiB each.
- Oversized payloads are rejected with HTTP 413 rather than fully buffered and parsed.
- Source change commit: `30b3545781e22b9986e7eea6852c97201497395c`.
- During isolated V8 execution of the helper, caught a bug in the first implementation: the Content-Length decimal regex had an extra escape and rejected valid digit strings. Repaired it in commit `d9651a0cb67e2b6c0df22c9717f1f9b76739ef07`.
- Added static tests for bounded streaming, endpoint-specific limits, 413 behavior, and decimal Content-Length validation. Latest test commit: `81d28db9386299893b94d2ece592c14e5a681de5`.
- Read-back confirms 21 test cases and valid test-module syntax under isolated V8 parsing (Node imports and `import.meta` removed for parsing only).
- Executed the actual extracted bounded-reader implementation in isolated V8 with mocked stream readers: valid 10-byte multi-chunk body returned `helloworld`; declared 11-byte body was rejected before reading; chunked overflow was rejected, stream canceled, and lock released. All five checks passed.
- This does not substitute for the full Node test runner, TypeScript compiler, Wrangler build, or live Worker integration.

### CI and source state
- Latest push run for commit `81d28db9386299893b94d2ece592c14e5a681de5`: run `43542242326`, conclusion `startup_failure`, path `BuildFailed`; jobs endpoint returned an empty array.
- No CI tests executed. Do not claim the test suite passes.
- No production services, Discord resources, databases, Cloudflare resources, credentials, DNS, billing, or scheduler settings changed.

### Next execution step
Continue independent validation of request method/content-type handling, MCP JSON-RPC shape validation, OAuth endpoint error handling, and router request forwarding. Do not introduce retry behavior for any ambiguous write.
