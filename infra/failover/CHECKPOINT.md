# Dawn Dotta infrastructure recovery checkpoint

Last updated: 2026-11-13
Scope: **Dawn Dotta / Momentum Movement only**. Do not modify any other Discord project or guild.

## Project and component
- Railway project: Dawn Dotta / Momentum Movement (a1d6b0e4-3169-4c5d-add3-84a70f7dc525)
- Railway production environment: c72ea3d9-2c1c-4651-a265-79723e317fa5
- Primary service: Dawn Dotta Discord Manager (596b402b-936b-490e-97c7-d41d9ed87caf)
- Recovery repository: Blickymania/momentum-movement-fallback (private), branch main
- Recovered manager snapshot: `recovered/railway/dawn-dotta-discord-manager.ts`

## Completed and verified
1. Read-only Discord Manager status: connected; authorized guild 1565048205970767992; bot identity verified; guild identity verified; HTTP identity/guild checks both 200; writes are enabled.
2. Read-only guild audit: passed; 108 channels, 12 roles, 13 forums, 36 commands, 13 categories; no warnings or exceptions.
3. Railway project inventory: 34 production services. Main manager online, latest deployment SUCCESS; Engagement Engine online. One service failure: Dawn Dotta News Forum 24h Retention Cleanup (CRASHED).
4. Existing Railway staged patch df7920c5-7cf6-4d0b-896b-f9e405ac7895 affects only the News Forum cleanup service (3 changes). Preserved untouched; do not commit/discard without reviewing purpose.
5. The core manager is an HTTP MCP server using Bun.serve and Bun.env; it is not a Discord Gateway client. It exposes /healthz and /readyz.
6. The Manager source imports Bun's native SQL module at startup (`await import("bun")`) and uses its SQL. It therefore cannot be copied unchanged into Cloudflare Workers. Its OAuth persistence uses a PostgreSQL DB and tables for OAuth clients, login requests, authorization codes, access tokens, and refresh tokens.
7. Source recovery snapshot added to private GitHub repo at `recovered/railway/dawn-dotta-discord-manager.ts`, commit `10c8319a9bd7ef179c3445c89f08c2dc0c71ef79`. Static secret-pattern scan returned zero matches for Discord bot tokens, GitHub tokens, AWS access keys, private-key blocks, static bearer tokens, and inline OAuth secrets. Fetch-back verification was requested; confirm returned blob SHA before calling this recovery cycle complete.
8. Dedicated LIVE/Events listener is a separate gateway service, not to be combined or cut over with the stateless Manager without an independent migration plan.
9. No Railway Automations available in this account (feature not enabled). No new scheduler, cron, automation, or monitor was created.
10. Candidate research: Cloudflare Workers Free has published free request/CPU limits; Render Free services sleep after inactivity and have bounded hours. Northflank, Deno Deploy, and Koyeb excluded due card/payment-method rules as checked in the current research. Cloudflare/Render no-card signup must be verified independently before relying on either.

## Remaining objectives
- Validate source snapshot fetch/checksum and commit a persistent recovery checkpoint.
- Choose a no-card provider that can actually run the recovered Bun server and retain PostgreSQL OAuth. Avoid a simple Cloudflare port until Bun SQL is replaced with a tested adapter.
- Identify the ownership and exact runtime dependency of OAuth PostgreSQL and any other database before migration; do not migrate unrelated/shared data.
- Prepare a separate migration branch with Docker/runtime configuration and tests; leave production Railway unchanged.
- Confirm a second independent host and edge failover routing. Render workspace selection is a user-only action in the available connector (workspace: My Workspace, ID tea-dbcqe7ss728c73fthlug); ask the user before using it.
- Vercel team access is not authorized (403); do not rely on it without user approval.
- Cloudflare console/account is not connected; require account-side access before creating Workers, routes, secrets, or DNS.
- Any endpoint cutover requires setting all secret variables on the new host, verifying OAuth issuer/resource/Discord redirect configuration, then explicit routing changes; preserve current working manager endpoint until the new endpoint passes readiness and authenticated read/write tests.
- Revalidate manager status and guild audit after final routing cutover.

## Existing scheduler inventory
- Railway Automations feature unavailable to this account; no Railway Automations could be enumerated.
- Railway services include several individual cron schedules. Do not modify any schedule as part of infrastructure failover unless it is confirmed to be Dawn Dotta-only and part of the specific migration.
- No new scheduler created.

## Blockers / user actions
- Choose the Render workspace before Render service inspection/creation: the tool requires an explicit user selection even though only one workspace is listed.
- Provide/authorize Cloudflare account access or perform Cloudflare setup in the dashboard.
- New host must receive secrets through its secret manager; never export secrets into Git.
- Update any MCP client URL/OAuth redirect URI only after the new host is fully tested; client configuration may require user action.

## Last verified state
- Discord manager connected; audit pass.
- Railway manager service online and latest deployment SUCCESS.
- Existing staged News Cleanup change preserved, no changes applied.
- Recovery source file created on main; verify fetch SHA/content before treating it as complete.

## Exact next execution step
1. Confirm recovered source blob hash/content from GitHub.
2. Research and confirm Cloudflare Workers free signup/payment method policy and test a minimal Bun/SQL port feasibility.
3. Inspect OAuth database dependencies and Render service requirements, but do not touch Render until the workspace is explicitly selected.
4. Build and test an isolated migration branch, then deploy a backup endpoint only after the destination workspace/access and secret provisioning are available.


## Cycle checkpoint — 2026-11-13 (Cloudflare account + migration-port review)

### Account inspection (read-only, verified in the user's authenticated browser tab)
- Cloudflare account dashboard is authenticated; account Workers subdomain: `redcell4400.workers.dev`.
- Workers & Pages dashboard shows Free-tier usage counters: 0 / 100,000 requests today and 0 / 200,000 observability events today. The UI displays an Upgrade control but no upgrade was selected.
- Exactly one existing Worker is listed: `empress-discord-cloudflare`. It is another community's resource and is explicitly out of scope; do not inspect secrets, modify, deploy over, or route Dawn traffic through it.
- No Dawn Dotta Worker, Hyperdrive, D1, KV, R2, Queue, or Workflow has been created in this project during this cycle.
- Official Cloudflare documentation states Hyperdrive is included in Workers Free with 100,000 database statements/day; all DB statements count and limits reset daily at 00:00 UTC. Official Cloudflare product information states free signup does not require a credit card. This is consistent with the dashboard's free usage counters; billing/payment settings themselves have not been opened or audited.

### Port review findings (source branch; no deployment)
- `wrangler.jsonc` has no `hyperdrive` binding declaration or binding ID. `src/index.ts` expects `env.HYPERDRIVE?.connectionString` and falls back to `OAUTH_DATABASE_URL`; a direct Railway private DB URL is not reachable from a Cloudflare Worker. A real Hyperdrive binding must be provisioned and tested against a reachable Postgres endpoint before OAuth readiness can pass.
- The existing Railway OAuth Postgres service has only a private Railway endpoint (previous inventory: `oauth-postgresql`). No public TCP endpoint has been verified, and no database exposure or firewall change was made.
- `src/index.ts` creates a new `pg.Client` for each Worker request and closes it in `finally`. This lifecycle, Hyperdrive binding configuration, Worker compatibility, and OAuth concurrency have not been exercised in a real Worker runtime. Static regex tests are not evidence of functional compatibility.
- `mcpOAuthSchemaPromise` is module-global while DB clients are request-scoped; concurrent first-time OAuth schema initialization could share work tied to the first request's DB client. This requires a focused concurrency test/fix before deployment.
- `wrangler.router.jsonc` currently configures only the Railway fallback origin; its Cloudflare primary and Render fallback are unset. The router itself is Cloudflare-hosted and is not independent of Cloudflare availability; do not describe it as independent DNS-level failover.
- Existing test suite is static source-pattern assertions. No Node install/typecheck/test/Wrangler dry-run was executed in this cycle, and prior GitHub Actions attempts produced zero jobs/startup failure. Do not claim tests passed.

### Cycle outcome
- Completed: account dashboard inspection; verified visible Workers free quotas; inspected current Worker inventory; reviewed Worker source, router, wrangler configs, tests, and branch checkpoint.
- No code changes, resource creation, secrets, database exposure, DNS edits, billing changes, or production cutover performed.
- Railway production manager remains the known working service; preserve it unchanged.

### Remaining objectives / exact next step
1. Inspect Cloudflare Hyperdrive dashboard and confirm available creation path/limits without creating a paid resource. Inspect Workers Plans and billing only read-only if needed to confirm Free status and no payment requirement.
2. Determine whether the existing Railway OAuth Postgres can be safely reached from Hyperdrive without exposing credentials or opening broad public access. If not, design a dedicated free database migration path and migration/rollback plan; do not use other communities' Supabase projects.
3. Fix/test the Worker DB lifecycle and schema-initialization concurrency; add a declared Hyperdrive binding only after its real binding ID is provisioned.
4. Run actual typecheck, tests, and Wrangler dry-runs in a working isolated checkout/CI runner. Current static tests and failed CI are insufficient.
5. Keep the Cloudflare router and Manager un-deployed until the primary Worker, OAuth flows, Discord status/audit, and failover behavior are all verified.
6. Do not create schedulers/cron. Existing Railway cron services remain untouched; centralized scheduler inventory remains incomplete.

### User-only/external dependency
- The authenticated Cloudflare tab can be inspected read-only. The available browser connector cannot navigate the user's tab; user can open the Hyperdrive dashboard URL `https://dash.cloudflare.com/7738d94fbc5466ad91eb65045ee746f2/workers/hyperdrive` and Workers Plans URL `https://dash.cloudflare.com/7738d94fbc5466ad91eb65045ee746f2/workers/plans`, then the current tab context can be inspected.
- Do not ask for passwords, tokens, or secrets in chat. Do not enable paid billing or add a card.


## Documentation correction — Hyperdrive driver/lifecycle
- Follow-up against current official Cloudflare Hyperdrive docs confirms `pg@8.16.3` is the recommended Node.js driver, `nodejs_compat` is the correct flag, and Cloudflare explicitly recommends creating a new `pg.Client` per request. The current package uses `pg ^8.16.3`, and the current Worker does create a request-scoped Client. These parts are aligned with official guidance, not migration defects.
- Cloudflare also says the edge client is automatically cleaned up at invocation end and does not need `client.end()`; current code calls `client.end()` in finally. Treat removal as a possible simplification, not a verified bug, and test it rather than changing blindly.
- The module-global OAuth schema promise is a concurrency test target, not yet a proven race: its async work runs in the initiating request's async-local context and the initiating request awaits it before closing its client. Add a concurrent-first-initialization test before deciding whether to redesign it.
- Confirmed unresolved requirement: the Worker needs an actual `hyperdrive` binding and valid Hyperdrive config ID in Wrangler. Cloudflare's private database options use a Tunnel + Access service auth, or Workers VPC service; neither has been provisioned. A private Railway hostname alone cannot be passed as a public database host.


## Database network inspection — 2026-11-13
- Read-only Railway inspection of the Dawn Dotta OAuth Postgres service (service `3e71f6b5-a248-40b6-b185-a748a5f5b436`, production environment `c72ea3d9-2c1c-4651-a265-79723e317fa5`) returned `proxies: []`: no public TCP proxy is configured.
- No TCP proxy was created. Do not expose the production OAuth database publicly as a shortcut. Investigate a Cloudflare Tunnel/private-database route or another least-privilege network path; if Railway cannot run a connector due billing/resource limits, document that external blocker rather than opening broad ingress.
- Official Cloudflare guidance confirms `pg` is recommended and request-scoped Clients are correct. Hyperdrive binding/config and reachable private DB path remain the gating dependencies.


## Cycle 11 — Northflank Manager failover integration (2026-11-13)

### Audit conclusion
- Northflank was not integrated because the earlier manager failover work carried forward an obsolete blanket card/payment-method exclusion.
- The existing implementation branch had no Northflank Dockerfile, provider runbook, origin variable, provider-specific readiness requirement, or deployed Northflank service.
- The previous source topology was Cloudflare Worker Manager -> existing Railway Manager -> Render cold fallback. It did not include a persistent independent Bun host.
- The actual production Manager is the Railway HTTP/MCP service. It is not the Bot 005 Discord Gateway. Manager HTTP failover and Bot 005 Gateway ownership failover are separate projects.

### Northflank provider research
- Official Northflank pricing currently advertises a no-card Sandbox, up to $20/month of Northflank Cloud resources, two services, two jobs, one database, and always-on compute without sleep.
- Public compute examples: nf-compute-20 = 0.2 shared vCPU / 512 MB / $5.40 monthly; nf-compute-50 = 0.5 shared vCPU / 1 GB / $12 monthly; nf-compute-100-1 = 1 dedicated vCPU / 1 GB / $18 monthly.
- PostgreSQL compute, persistent disk, build storage, backups, logs, and egress consume resource allowance or billed resources. The public calculator example of a 10 GB PostgreSQL addon is $13.17/month; $12 Manager + that database exceeds the $20 Sandbox allowance.
- A small Manager + small PostgreSQL combination may fit the allowance, but the exact eligible DB plan, minimum disk, actual account quote, and runtime headroom must be verified before provisioning. Never assume $0 total cost and never select Pay as You Go or enter a card.

### Implemented on branch infra/dawn-dotta-northflank-manager
- Added northflank/Dockerfile using oven/bun:1.4.4, canonical recovered Manager source render/manager.ts, port 3000, and no Discord Gateway login.
- Added northflank/DEPLOYMENT.md and northflank/README.md covering Sandbox budget, private PostgreSQL addon, TLS, secrets, OAuth migration, health/readiness, router ordering, rollback, and no-card guardrails.
- Added Northflank as the router's preferred origin: NORTHFLANK_MANAGER_ORIGIN / northflank-primary.
- Router origin priority is now Northflank -> existing Railway legacy origin -> Cloudflare Worker Manager port -> Render cold fallback.
- New Northflank and Cloudflare origins must prove OAuth database readiness (oauthDatabaseVerified: true). The existing Railway origin is temporarily allowed to use its legacy /readyz shape until its source is upgraded; a reported false DB check is always rejected.
- Router may retry only GET/HEAD on transport errors or upstream 502/503/504. It never replays POST/PUT/PATCH/DELETE. If no alternate is ready after a retryable response, it preserves and returns the original response body.
- Updated the Bun Manager candidate to check PostgreSQL with SELECT 1 when OAuth is enabled, fail readiness when the DB is unconfigured/unavailable, expose oauthDatabaseVerified, and support MCP_INTERNAL_BEARER_TOKEN while retaining RAILWAY_SERVICE_KEY compatibility.
- Updated the Cloudflare Worker port to return the new DB readiness field and support the neutral bearer variable name.
- Added Node tests for Northflank Docker configuration, Manager runtime/readiness, no-card deployment guardrails, provider priority, database readiness, and no-write-replay rules.
- Updated Render deployment instructions to reflect database readiness and the neutral bearer name.
- No Northflank service, database, secrets, deploy, billing setting, Cloudflare Worker, DNS route, or production cutover was created or changed.

### Live production recheck
- Railway project: Dawn Dotta / Momentum Movement, production environment c72ea3d9-2c1c-4651-a265-79723e317fa5.
- Live Manager service 596b402b-936b-490e-97c7-d41d9ed87caf remains deployed with SUCCESS state; no config changes were staged.
- Core Shadow service f4839b88-e3c2-4094-af7d-3089bb8f291d remains an earlier read-only preflight build with Gateway takeover disabled. It is unrelated to Manager HTTP failover.
- Railway Manager variables are available by name only through the connected OAuth app; values are redacted. The current OAUTH_DATABASE_URL hostname and exact database owner could not be safely identified.
- No Northflank account/API connector is exposed in this environment. No token or password was requested or stored.
- Existing Railway staged News Forum cleanup patch remains untouched.
- Existing scheduler inventory unchanged; no scheduled automation, cron job, keepalive, or recurring repair was created.

### Remaining verification and blockers
- The GitHub Actions runner history previously shows startup_failure with zero jobs; this does not establish code failure or a successful test run. Verify the new branch CI status before treating tests as passed.
- Run actual Node tests, TypeScript typecheck, Wrangler dry-runs, and a Docker build; static source inspection is not a substitute.
- Northflank account sign-in/resource estimate is not yet available through a connected provider tool. Verify Sandbox/no-card plan and full Manager + DB monthly total in the dashboard before provisioning.
- Current Manager OAuth database ownership/host is unknown because Railway API values are redacted. Identify the Dawn-only database securely before any export or migration.
- After Northflank deployment, verify service /healthz and /readyz, identity checks, OAuth DB check, MCP discovery, OAuth lifecycle, and controlled read/write behavior.
- Cloudflare router account/resources and route remain undeployed. Do not route traffic to Northflank until its actual HTTPS origin passes readiness and OAuth tests.
- Keep Railway production Manager, databases, and current MCP endpoint untouched until rollback has been exercised and user-facing client/OAuth endpoint cutover is separately verified.

### Exact next execution step
1. Verify branch file hashes and Node test patterns; add this branch to the validation workflow and inspect the actual workflow result.
2. Repair test or TypeScript/Docker issues based on actual results.
3. If local/CI tests pass, request only the Northflank account-side setup needed to inspect its Sandbox resource estimate; stop before any card or paid-plan prompt.
4. Identify the production OAuth database owner without exposing credentials, then produce an isolated migration/restore plan.
5. Continue to a pre-production Northflank deployment only when account access, free budget, DB isolation, and secrets are available; keep the live Railway Manager untouched.


## Cycle 12 — shared OAuth database fault-domain audit and test-gate review (2026-11-13 ET / 2026-11-14 UTC)

### New critical architecture finding
- A standalone Northflank PostgreSQL addon is not automatically a safe shared OAuth store for the Northflank, Railway, Cloudflare, and Render Manager origins.
- Northflank addons are private to the project by default. Public TLS TCP access is available for supported PostgreSQL addons, but enabling it is a deliberate security/network decision. The Railway and other fallback origins do not automatically inherit Northflank private-network access.
- A Northflank-only database remains in the same provider fault domain as the Northflank Manager. If Northflank itself has a platform outage, both compute and that database can fail together.
- The router's readiness SELECT 1 check proves only that the candidate can reach a database. It does not prove it is the same logical OAuth dataset as the live Manager or that replication is current.
- The Northflank runbook now blocks provisioning an isolated Northflank OAuth database as the production store. It requires one shared, recoverable OAuth data plane reachable by all active/fallback origins, row-count and canonical digest reconciliation, OAuth lifecycle tests, and restore validation before routing.
- Neon Free was evaluated only as a possible test database: official current documentation lists 100 CU-hours/project/month, 1 GB/project storage, 5 GB egress and scale-to-zero after five minutes. This is not accepted as a production always-on failover database. No Neon project was created.
- No independent shared production PostgreSQL provider has been selected or verified. This remains a hard external dependency and prevents a safe Northflank traffic cutover.

### Additional implementation and repairs
- Router readiness now propagates the selected Manager origin's actual oauthDatabaseVerified status; it no longer reports true unconditionally when the selected origin is the legacy Railway Manager.
- Readiness probes are cached for 5 seconds per candidate and concurrent probes for the same origin are coalesced. The cache is a load/latency optimization only; it is not a lease or authorization primitive.
- The router test suite now checks the selected origin's database-verification propagation and probe-cache behavior; duplicate test blocks were removed and the original readiness matcher corrected.
- The Northflank deployment guide documents the shared OAuth data-plane/fault-domain requirement and the decision to leave NORTHFLANK_MANAGER_ORIGIN unset until proven.
- Static credential-pattern scan of the modified Manager, Worker, router, test, workflow, and Northflank deployment files: no Discord-token-like strings, GitHub tokens, private-key blocks, or static Bearer credentials found.
- Source comparison confirmed the Manager and Worker only differ from the previous migration branch by the intended readiness/auth compatibility additions; the router has the intended new provider priority, DB-status propagation, safe-read retries, and probe caching.

### Test and execution environment status
- GitHub Actions has triggered on every push to the Northflank branch, but the latest workflow run 43556031739 ended in startup_failure; the jobs endpoint returned total_count: 0 and no job logs were available. The previous 17 branch runs have the same zero-job startup failure pattern.
- This is not a source-test failure, and it is not a passing test. The GitHub runner never began.
- Execution environment inventory: Node.js v22.16.0 and npm 10.9.2 are present; Bun and Docker CLIs are unavailable. No complete local project checkout/dependency install was performed in this tool environment, so Node suite, TypeScript typecheck, Wrangler dry-runs, and Docker image build are not claimed as passed.
- No Northflank account provisioning, database creation, secret upload, payment method, DNS, Cloudflare Worker deployment, Render deployment, Railway production change, or Discord write was made.
- No scheduled automation, cron, keepalive, or recurring repair was created.

### Last verified production state
- Railway Manager remains connected with verified bot/guild identity and is still the only known working production Manager origin.
- Railway production Manager service and its deployment were not modified.
- Railway variable values remain redacted by the connected OAuth integration; the current production OAuth database host and precise database owner remain unknown.
- Core Shadow remains a separate, older read-only Bot 005 Gateway preflight service with takeover disabled; not part of this Manager HTTP failover cutover.
- Existing staged News Forum cleanup patch remains untouched.

### Exact next execution sequence
1. Diagnose the GitHub Actions runner startup failure through account/repository Actions settings or GitHub support; there are no job logs from which to infer a code/YAML cause.
2. Obtain authenticated Northflank account access and inspect the Sandbox resource estimator, database minimum resources, and no-card/no-upgrade state. Stop before any card or paid-plan prompt.
3. Identify the production Dawn OAuth database owner securely (without reading or printing credentials) and decide the shared, provider-independent database topology.
4. Only after the shared database, data-plane identity, backup/restore, and provider access path are proven, deploy Northflank as an isolated preproduction Manager with writes disabled.
5. Test MCP discovery, authenticated status/audit, OAuth registration/PKCE/token lifecycle, database outage handling, controlled writes, origin routing, failback, and rollback.
6. Keep Northflank origin unset and the live Railway Manager unchanged until all gates pass.


## Cycle 13 — final source-invariant validation and draft PR checkpoint (2026-11-13 ET / 2026-11-14 UTC)

### Verification completed
- Retrieved the exact current branch versions of the Dockerfile, Northflank runbook, Bun Manager, Cloudflare Worker Manager port, failover router, tests, and validation workflow from GitHub.
- Executed 27 direct source-level invariants against those retrieved file contents in the current JavaScript execution environment: **27 passed, 0 failed**.
- Checks cover pinned Bun runtime and container command, HTTP Manager scope/no Gateway login, PostgreSQL readiness/fail-closed behavior, provider-neutral auth compatibility, Northflank/Railway/Cloudflare/Render priority, required DB-ready response on new origins, legacy Railway compatibility, true readiness propagation, 5-second cache/in-flight probe coalescing, safe-read-only retry behavior, origin URL validation, no-card/no-upgrade guide guardrails, shared OAuth database rollout gate, and common embedded credential-pattern scans.
- Compared the exact base-branch and candidate source contents for Manager and Worker: after applying only the expected readiness/auth changes, each file matched exactly. No additional source drift was found.
- Draft pull request opened: https://github.com/Blickymania/momentum-movement-fallback/pull/2 (base: infra/dawn-dotta-cloudflare-worker; head: infra/dawn-dotta-northflank-manager). It is open, unmerged, and draft. The branch was not merged into the base branch or main.
- GitHub PR metadata reports the draft PR mergeable after the initial metadata refresh. This is not evidence of a successful build or test run.

### Still unverified
- GitHub Actions newest observed run after these changes ended in startup_failure; jobs endpoint reports zero jobs. No CI test steps ran.
- 27/27 are direct source-level invariant checks, not a Node test-suite execution, TypeScript compilation, Wrangler build, Docker build, live Northflank run, live Cloudflare run, OAuth lifecycle, or production failover test.
- Bun and Docker CLIs are not installed in the current execution environment; a full project checkout/dependency install is not available through the connected GitHub tool.
- Northflank account-side Sandbox estimator, card/payment state, and actual resource availability are not verified.
- Shared production OAuth PostgreSQL location/ownership remains unknown; current Railway environment variables are value-redacted.

### Current disposition
- Candidate code and deployment instructions are preserved in the open draft PR.
- NORTHFLANK_MANAGER_ORIGIN must remain unset until the same OAuth data plane is proven across Northflank and the existing fallback origin, and live OAuth/restore tests pass.
- Railway production Manager and all other production services remain unchanged. No database, secret, card, paid plan, cloud resource, DNS, production route, or Discord content was modified.
- No scheduler, cron job, keepalive, or recurring maintenance process was created.

### Next exact action
- Resolve the GitHub Actions zero-job startup failure from repository/account Actions settings or GitHub support, then rerun the branch validation job.
- Obtain Northflank account access for read-only Sandbox resource and no-card verification.
- Identify the existing OAuth database owner/host safely and select a shared provider-independent database path.
- Resume with isolated preproduction deployment only after those external prerequisites are met; do not cut over production.


## Cycle 14 — degraded-readiness signal hardening (2026-11-13 ET / 2026-11-14 UTC)

### Implementation
- The failover router's own GET /readyz now returns HTTP 503 with status "degraded" when it selected the legacy Railway Manager and that origin does not explicitly report oauthDatabaseVerified=true.
- The response still includes managerReady=true and discordVerified=true to distinguish an operational Manager origin from a fully verified OAuth data path.
- The router continues forwarding normal requests to the existing Railway legacy origin; this readiness change does not stop or modify the production service.
- Northflank deployment runbook now documents this behavior so external monitoring cannot mistake the legacy route's HTTP Manager availability for verified shared OAuth data-plane readiness.
- Added source-invariant tests for the degraded/503 readiness response.

### Validation
- Re-ran the direct source-level checks against the exact current branch files: **30 passed, 0 failed**.
- Checks include the degraded readiness response/status code, DB status propagation, Northflank deployment gate, runtime packaging, auth compatibility, provider order, caching, safe retries, source credential scans, and test/workflow presence.
- This remains source-level validation in the code execution tool. Node test-suite execution, Bun runtime, Docker build, TypeScript compile, Wrangler dry-run, live OAuth lifecycle, and provider deployment remain unverified.

### Current blocker state
- GitHub Actions continues to terminate before job creation (startup_failure, zero jobs).
- Northflank provider account/API is not connected; no account-side free-tier/resource estimator or payment-method state can be inspected.
- Production OAuth database owner/host is still unknown from the connected Railway API because values are redacted. No safe shared database topology has been selected.
- Draft PR #2 remains open, unmerged, and in draft review; no production routing is configured.

### Exact next action
- Fix or obtain account-side access for GitHub Actions runner startup, then execute the committed test workflow.
- Connect or authorize Northflank account access for read-only Sandbox/resource/billing inspection; do not accept a card or paid upgrade.
- Establish a shared provider-independent OAuth data plane before attempting isolated Northflank preproduction routing or cutover.


## Cycle 15 — final Manager/Worker shared-database consistency audit (2026-11-13 ET / 2026-11-14 UTC)

### Findings
- Verified that the Cloudflare Worker fallback already executes its Hyperdrive-backed PostgreSQL SELECT 1 check when MCP_OAUTH_ENABLED=true before returning oauthDatabaseVerified=true; an unavailable backend returns HTTP 503. The readiness field is not hard-coded without a database probe.
- Corrected the Northflank runbook's OAUTH_DATABASE_URL entry: it now explicitly requires the selected shared OAuth data plane and forbids an isolated Northflank-only production database.
- Confirmed both the Bun Manager candidate and Worker Manager port have explicit DB checks, and the router rejects new origins lacking oauthDatabaseVerified=true.
- Router /readyz now reports status=degraded and HTTP 503 when it selects the legacy Railway origin without explicit DB verification. Ordinary request routing to that legacy origin continues; the degraded response prevents monitoring from treating unverified OAuth data as fully ready.

### Verification
- Final retrieved-source invariant validation: **35 passed, 0 failed**.
- Verified files: Northflank Dockerfile/runbook, recovered Bun Manager candidate, Cloudflare Worker Manager port, failover router, Northflank/router tests, and GitHub validation workflow.
- Validation included Manager/Worker database query ordering and fail-closed status, neutral bearer key compatibility, provider order, readiness truth propagation, degraded/503 state, 5-second cache and in-flight coalescing, GET/HEAD-only retry, no automatic write replay, HTTPS-origin validation, database fault-domain rollout gate, no-card guardrails, and credential-pattern scans.
- Source-only invariant validation does not equal a full Node test run, TypeScript build, Wrangler build, Docker build, live OAuth lifecycle, or live failover test; these remain unverified.

### Outstanding external blockers
- GitHub Actions has not created a runner job; latest observed run for the prior branch head ended startup_failure with zero jobs.
- No Northflank account/API connection is available. The Sandbox plan, no-card status, actual service/database minimums, and combined resource estimate are not verified in the account.
- No independent shared PostgreSQL provider/data plane has been selected. The production Railway OAuth database owner/host remains unknown because variable values are redacted.
- No production resource, route, secret, billing/payment setting, database, or Discord content was changed.

### Project disposition
- Draft PR #2 remains the implementation/review record, open and unmerged.
- Northflank Manager package and router integration are source-prepared only.
- Do not set NORTHFLANK_MANAGER_ORIGIN, deploy the Worker/router, migrate OAuth records, or change the production MCP URL until the shared data plane and all runtime tests are verified.
- No scheduler, cron, keepalive, or recurring repair was created.

### Resume step
1. Resolve GitHub Actions account/repository runner startup so the actual test workflow executes.
2. Connect Northflank account access for read-only free-tier/billing inspection; stop at card/upgrade prompts.
3. Resolve the shared provider-independent PostgreSQL topology and existing production DB owner securely.
4. Resume isolated preproduction deployment, OAuth lifecycle, routing, and rollback tests only after the shared DB prerequisite is met.


## Cycle 16 — shared-database candidate and current resource-price review (2026-11-13 ET / 2026-11-14 UTC)

### Northflank price correction
- Rechecked the current official Northflank pricing page. Current displayed compute plans are nf-compute-50 (0.5 vCPU / 1 GB, $12/month), nf-compute-100-2 (1 vCPU / 2 GB, $24/month), and nf-compute-200 (2 vCPU / 4 GB, $48/month).
- The Sandbox includes up to $20/month of combined Northflank Cloud resources, not $20 per resource.
- The public calculator's example 10 GB PostgreSQL database is $13.17/month. Adding it to nf-compute-50 gives $25.17/month before extra logs, builds, backups, and egress, above the Sandbox allowance.
- Prior references in this checkpoint to nf-compute-20 ($5.40) and nf-compute-100-1 ($18) are historical plan information and are not the currently displayed standard plan table. The deployment guide has been updated to current plan names/prices.
- No assumption is made that the Manager+database stack can run for free. Actual plan/addon availability and account estimate remain unverified.

### Neon shared PostgreSQL candidate review
- Current official Neon Free documentation reports 100 CU-hours/project/month, 1 GB PostgreSQL storage/project, 5 GB public network transfer/project/month, up to 2 CU autoscaling, 10 branches, and a fixed 5-minute scale-to-zero window.
- Neon documents that compute reactivates after a query within a few hundred milliseconds. This could be acceptable for an OAuth data plane under low/moderate request traffic, subject to latency tests.
- At 0.25 CU, 100 CU-hours permits about 400 active compute-hours/month. If traffic or frequent health checks keep the database active, the quota can be consumed. When compute or transfer quota is exhausted, Neon documents that the Free project's compute is suspended until the next billing period or an upgrade.
- Neon IP Allow is available on Scale, not Free. Free plan network protection must therefore rely on SSL/TLS, strong unique passwords, least-privilege database roles, secrets only in provider secret stores, credential rotation, and careful usage monitoring.
- No periodic ping/keepalive should be used to prevent scale-to-zero; do not add a new scheduler or background polling process.
- Neon is now the preferred shared-database candidate to inspect, because it is outside the Northflank/Railway/Cloudflare/Render compute fault domains. It is not approved for production yet. Need to measure the existing OAuth DB size and traffic, verify available project status and current quota, test pooled/unpooled TLS connection paths from each runtime, check restore and OAuth lifecycle, and observe cold-start latency before any data copy/cutover.
- Current plugin discovery now shows Neon as installed. However, no callable Neon project/database actions are exposed in the current execution tool manifest, and no Neon account data could be inspected. No project or database was created or changed.

### Router status consistency repair
- Fixed GET /_failover/status to distinguish managerAvailable from fullyReady. It now returns status "degraded" and HTTP 503 when a Manager is reachable but no ready origin also reports oauthDatabaseVerified=true. It returns "ready"/200 only when a ready origin verifies the shared OAuth database.
- This matches the stricter /readyz behavior. Ordinary traffic can still be routed to the known Railway Manager when it is available, but monitoring no longer treats the legacy DB-unverified origin as fully ready.
- Added test coverage for the aggregate degraded state.

### Verification status
- Latest direct source-invariant count before these last documentation/test changes was 40/42. Two checks were themselves too strict: they rejected nf-compute-200 as a substring match of the retired nf-compute-20 plan, and expected capitalization that differed from the guide. Those assertions are being corrected; do not report the 40/42 as a code failure or as a final pass.
- The GitHub Actions runner still fails before any job starts (startup_failure, zero jobs). No Node tests, TypeScript check, Wrangler build, Docker build, or live integration test is claimed.
- Bun and Docker are not installed in the current execution environment.
- Draft PR #2 remains open, draft, unmerged, and mergeable. Current pricing/data-plane changes are committed to the same isolated branch.

### Last verified production and account state
- Railway production Manager remains unchanged and is still the only known working production Manager origin.
- Railway variable values remain redacted; production OAuth database host and owner are unknown.
- Neon plugin search reports it as installed, but no Neon tool actions are exposed to inspect existing projects or provisioning; no Neon database action has been taken.
- No Northflank account resources, databases, secrets, deployments, payment cards, or paid upgrades were created.
- No Cloudflare Worker/router was deployed and no origin, DNS, or MCP endpoint was changed.
- No Discord write, other-community access, scheduler, cron, keepalive, or recurring repair was created.

### Exact next step
1. Re-run the direct source invariant checks with corrected plan-label and case-insensitive no-card assertions.
2. Verify the latest GitHub Actions run state; if jobs are still zero, preserve as runner/account blocker rather than source-test failure.
3. Get a working Neon project-management tool surface, inspect whether an appropriate existing staging project already exists, and only then decide whether a new isolated test project is warranted. Never write production OAuth data without explicit migration/restore evidence.
4. Measure and identify current production OAuth DB owner/size safely; test the shared Neon candidate with all Manager runtimes and a restore path before routing.
5. Keep Northflank inactive in the router until the shared DB prerequisite, budget, runtime tests, and rollback gates pass.


## Cycle 17 — final source validation and PR checkpoint (2026-11-13 ET / 2026-11-14 UTC)

### Final verified result
- Retrieved the exact current branch files for Northflank Docker/runtime guidance, Bun Manager, Cloudflare Worker Manager, failover router, Northflank/router tests, and CI workflow.
- Executed **46 direct source-level invariants: 46 passed, 0 failed**.
- Coverage includes pinned Bun container, Manager/Worker runtime identity, real PostgreSQL SELECT 1 readiness checks, fail-closed database errors, neutral bearer compatibility, origin priority, selected-origin DB-status propagation, both router endpoints' degraded/503 behavior, 5-second health cache, concurrent-probe coalescing, safe GET/HEAD retries, no mutation replay, HTTPS origin validation, shared OAuth data-plane requirement, Neon quotas/scale-to-zero/IP Allow tier limits, current Northflank Sandbox prices, no-card guardrails, and credential-pattern scans.
- Rechecked GitHub branch: head SHA f7780c14bf956c3594592036f37463da96064804 at the time of this checkpoint.
- Draft PR #2 is open, mergeable, unmerged, and still in draft: https://github.com/Blickymania/momentum-movement-fallback/pull/2. PR body updated to reflect the 46/46 source checks, Neon candidate, current pricing and outstanding gates.
- GitHub Actions latest observed run 43556844490 ended with startup_failure. Its jobs endpoint returned total_count=0. No CI runner job or test logs were produced.

### Neon connector state
- Current plugin discovery reports Neon as installed/enabled after the user's connection confirmation.
- The current execution tool manifest contains no callable Neon project/database operations, and the skill list contains no Neon skill. The account's project inventory, quotas, connection URLs, secrets, and database resources therefore could not be inspected or changed in this session.
- No Neon project or database has been created, migrated, or edited.
- Neon Free is a candidate, not an approved production database. Current published limits and security tradeoffs are in northflank/DEPLOYMENT.md.

### Current final disposition
- The code and deployment package are source-prepared on an isolated branch and preserved in a draft PR.
- The latest direct source check passes, but actual Node tests, TypeScript compilation, Wrangler build, Docker build, live Neon database connections, OAuth lifecycle, and live failover are not verified.
- GitHub Actions zero-job startup failure remains an external runner/account blocker.
- Current production OAuth database owner/host and dataset size remain unknown due to redacted Railway variables.
- The Neon account actions are not callable in this execution session despite installed status, so inspection of existing Neon projects remains a connector-surface blocker.
- No Northflank/Neon resources, paid plan, payment card, secret, production database, DNS, Cloudflare route, Railway service, MCP client URL, Discord message, role, channel, or production bot setting has been modified.
- No scheduler, cron, keepalive, or recurring repair was created.

### Exact next execution step
1. Restore GitHub Actions job creation (latest run has zero jobs; inspect account/repository Actions runner policy or GitHub support).
2. Expose/use the connected Neon project-management actions, inspect existing projects first, and verify free-plan resource availability without creating or modifying production data.
3. Identify the live Dawn OAuth database host, owner, size, schema, and backups securely.
4. Evaluate a Neon staging project only after its account quota and network constraints are confirmed; test TLS/pooled connections, cold starts, database quota behavior, OAuth lifecycle, and restore from backup across intended runtimes.
5. Do not enable Northflank routing or change live Railway until shared data identity, full tests, and rollback are proven.


## Cycle 18 — Neon staging account inspection and isolated connectivity test (2026-11-14 UTC)

### Account and production inventory
- Neon connector is now callable. Listed the account organization: `org-icy-salad-18689157` (Free plan). Before provisioning, the organization had zero projects.
- Read-only Railway production inventory confirms the project is `Dawn Dotta / Momentum Movement`, environment `production`, with no staged changes. The live `Dawn Dotta Discord Manager` deployment is SUCCESS and has one replica.
- Production contains two distinct PostgreSQL services: `OAuth PostgreSQL` with a 1GB persistent volume and `Postgres` with a 5GB persistent volume. Manager has OAuth database host/name/user/password configuration variables, but Railway returns values redacted. No assumption was made about which database the Manager references.
- The existing `OAuth Database Diagnostic Function - Temp` is a live Bun function configured with the same OAUTH_DB_* variable names and its historical logs include successful HTTP 200 requests. Its source executes `SELECT current_database()`; this proves that diagnostic function's configured connection worked at those times, not that its target is the Manager's exact database. Its public Railway domain and unauthenticated request behavior need a separate security review. No changes were made to it.
- Manager's recent HTTP logs show successful MCP POST requests (HTTP 200) and no upstream errors in the sampled window. This is observational evidence only, not an OAuth lifecycle/failover test.

### Isolated Neon staging resource
- Created a new Free-plan-only Neon project: `momentum-movement-oauth-failover-staging`, project ID `autumn-moon-71501044`, region `aws-us-west-2`, PostgreSQL 18.
- Created an empty default branch `staging` (`br-long-rice-bfm97hf6`) with database `momentum_oauth_staging` and role `momentum_oauth_staging`.
- Compute is constrained to 0.25 CU min/max. First create request attempted to set a 300-second suspend timeout, but Neon returned HTTP 412: modifying the suspend interval is not permitted on this account. The successful project response reported `suspend_timeout_seconds: 0`; do not claim automatic scale-to-zero is configured on this account.
- To prevent an unattended compute from remaining active, the endpoint was explicitly suspended after provisioning and again after tests. Final endpoint listing reports `current_state: idle`. It may wake on the next SQL/connection operation; explicitly suspend it again after future tests. No keepalive/scheduler was configured.
- Read-only connectivity test succeeded: `SELECT current_database(), current_user, current_setting('server_version'), 1` returned database `momentum_oauth_staging`, role `momentum_oauth_staging`, PostgreSQL `18.7`, and check value `1`.
- Schema inspection returned zero user tables. No schema, production rows, OAuth clients, tokens, or user data were imported or created. No connection string or credential was retrieved or stored in Railway/Northflank.
- The staging database is not yet approved for production. It currently has no verified 300-second autosuspend, no network allowlist, no app-runtime connection test, no pooler validation, no schema parity, no backup/restore exercise, and no OAuth flow test.

### Safety boundary and blockers
- No Railway service, variable, volume, deployment, database, route, DNS, or production data was modified. No Northflank resource or paid plan was created. No Discord action was taken.
- Neon Free account's suspend-timeout restriction means a future app connection can wake compute and leave it active until explicitly suspended; account quota/cost monitoring is required. Do not attach it to an app until an approved idle/suspension strategy is proven.
- The production database target remains unresolved because Manager variable values are redacted and the diagnostic service is not yet proven to target the same DB. Next safe action is to inspect DB service configuration/schema/backup metadata and determine the actual Manager-to-Postgres service reference without exposing secrets, then compare with the diagnostic function's reference.
- GitHub Actions runner startup failure remains unresolved; 46 prior direct source invariants passed, but no actual Node/TS/Wrangler/Docker CI run has completed.
- Draft PR #2 remains the only code delivery; do not merge or route Northflank until runtime tests, shared-database identity, and rollback gates pass.

### Next cycle
1. Read-only inspect both Railway Postgres services' service config, volume/backup metadata, and database schema/size using an approved diagnostic path; never expose credentials or dump user/token rows.
2. Identify whether Manager's OAUTH_DATABASE_URL and OAUTH_DB_* resolve to the OAuth PostgreSQL service or the other Postgres service. If Railway redaction prevents proof, stop and report the precise missing evidence.
3. Resolve Neon Free suspend behavior and test a minimal TLS/pooler connection only after safe staging credentials and app-runtime access are established; explicitly suspend after every test.
4. Restore GitHub Actions runner job creation and run actual unit/build/container tests.
5. Keep Northflank origin unset and production unchanged until every gate passes.


## Cycle 19 — lock down staging compute and latest CI verification (2026-11-14 UTC)

- After confirming Neon Free cannot change the suspend timeout, the staging endpoint was manually suspended and then set `disabled: true`. A fresh endpoint listing confirms both `current_state: idle` and `disabled: true`; this prevents the staging compute from being unintentionally woken by an external connection until deliberately re-enabled.
- Neon project usage fields currently report zero compute seconds, active seconds, CPU seconds, data transfer, written bytes, and storage-hours. No connection string/password was retrieved and no app secret was configured.
- The staging project remains an empty isolated test DB. No app runtime is connected to it.
- Latest PR-head GitHub Actions runs after the checkpoint/docs update: `43561741910` and `43561728887`, both `startup_failure`; each jobs endpoint returns an empty array. Combined commit status has no statuses. This remains a runner-startup blocker, not a code-test failure.
- Final read-only Railway inventory still shows no production staged changes and the live Manager deployment SUCCESS. No production changes were made.
- Draft PR #2 is open, draft, mergeable, unmerged, head `a7d53a3d52e528f09f9c80ec5a12de5202b9e4be` at the time of this checkpoint.

### Next safe action
Continue read-only inspection of the two Railway PostgreSQL services and their volume/backup metadata to identify the Manager's actual OAuth DB reference. Do not expose secret values, read token/user payloads, or change DB contents. If service references remain hidden by Railway's OAuth redaction, stop and request an approved safe diagnostic route rather than guessing. Keep the Neon staging endpoint disabled until the next explicitly controlled test window.


## Cycle 20 — trace PostgreSQL service traffic and backup coverage (2026-11-14 UTC)

### Confirmed private-network paths
- Railway network-flow records from the temporary OAuth diagnostic function show repeated egress TCP connections to private IPv6 address `fd12:b37c:13be:1:d000:203:e58b:311:5432`. Matching ingress/egress records on the `OAuth PostgreSQL` service show that exact address as the PostgreSQL source/listener, confirming the diagnostic function reaches the `OAuth PostgreSQL` service (not the separate `Postgres` service).
- The existing `Postgres Daily Backup` service's network-flow record shows TCP egress from its private address `10.176.109.24` to `10.234.136.250:5432`. Matching records on the separate `Postgres` service show `10.234.136.250` as its PostgreSQL address. Thus the existing daily backup worker targets the separate `Postgres` service, not the `OAuth PostgreSQL` service.
- Backup worker logs show three consecutive successful backup outputs on Nov 11, 12, and 13 (each 31,806 bytes), with a custom-format pg_dump, pg_restore --list validation, remote object-size comparison, and SHA-256 metadata. This verifies archive creation/transfer/listability, not a full restore rehearsal.
- No traffic from the existing daily backup worker to `OAuth PostgreSQL` was observed. No other OAuth PostgreSQL backup/restore mechanism has been verified. Treat OAuth DB backup coverage as an unresolved critical gap until proven otherwise.

### Remaining identity question
- The diagnostic function is proven to reach `OAuth PostgreSQL`; it uses `OAUTH_DB_HOST/NAME/USER/PASSWORD`. The Manager has variables with those same names plus `OAUTH_DATABASE_URL`, but Railway OAuth redacts values and they are not shared-variable names. Therefore identical Manager-to-diagnostic database targeting remains unproven. Do not equate same variable names with same values.
- Manager network-flow sample did not establish a TCP 5432 peer. It is not evidence that the Manager is disconnected; the sample may not include an OAuth transaction. Need an authorized, read-only runtime diagnostic from the Manager process or a Railway-supported secure variable-reference inspection.

### Safety and next step
- No service, backup schedule, volume, database, credential, or production configuration was changed. Existing daily backup schedule remains as-is; no new schedule was created.
- Before selecting Neon or Northflank for OAuth failover, first prove Manager's actual DB target and ensure that exact database has tested backups and a restore path. If OAuth PostgreSQL is the live target, the existing daily backup worker is currently not shown to cover it.
- Neon staging remains empty, endpoint idle and disabled; no app connection or credential configured.


## Cycle 21 — final checkpoint verification (2026-11-14 UTC)

- After the Cycle 20 documentation commit, latest GitHub Actions runs `43561875746` and `43561869750` both completed with `startup_failure`; both job lists are empty. No source tests ran.
- PR #2 remains open/draft/mergeable/unmerged at head `2ca7424f304f31fed427c845115371935753674e` before this checkpoint-only update.
- Railway production environment remains without staged changes. Dawn Dotta Discord Manager remains live, one replica, latest deployment SUCCESS.
- Neon staging endpoint is still `idle` and `disabled: true`; project usage fields are zero. No app secrets or connections were created.
- The next unresolved gate is the Manager's exact OAuth database reference and tested backup/restore coverage. Diagnostic function -> OAuth PostgreSQL is confirmed; existing daily backup worker -> separate Postgres is confirmed. Do not assume the latter backs up the former.


## Cycle 22 — inspect deployed production Manager OAuth wiring and readiness (2026-11-14 UTC)

### Exact live Manager source findings
- Retrieved the deployed source of the production Railway service `Dawn Dotta Discord Manager` (Bun 1.4.4), with no staged replacement.
- Its OAuth database handle is constructed only from `Bun.env.OAUTH_DATABASE_URL`:
  `const mcpOAuthDb = Bun.env.OAUTH_DATABASE_URL ? new McpOAuthSQL(Bun.env.OAUTH_DATABASE_URL) : null`.
- The deployed Manager source does not reference `OAUTH_DB_HOST`, `OAUTH_DB_NAME`, `OAUTH_DB_USER`, or `OAUTH_DB_PASSWORD`. Those variables are used by the separate temporary diagnostic function. Therefore the diagnostic function's successful connection to OAuth PostgreSQL does **not** prove where the Manager's `OAUTH_DATABASE_URL` points.
- The Manager's live `GET /readyz` calls Discord `/users/@me` and `/guilds/{id}`, verifies bot/application and guild identity, then returns `{status:"ready", manager, discordVerified:true}`. It does not check `MCP_OAUTH_ENABLED`, `OAUTH_DATABASE_URL`, or issue `SELECT 1`.
- The Manager's `GET /healthz` returns an unconditional platform/HTTP health response. It is not a database probe.

### Correlated live telemetry
- The latest available HTTP sample contains 501 requests, all `POST /mcp`; no `/oauth/*`, `/register`, or OAuth discovery requests appear in that sample.
- The corresponding 501 network-flow sample contains no traffic to PostgreSQL ports 5432, 5433, or 6432.
- The 454 DNS records in the sample resolve only `discord.com` (A/AAAA); no Railway Postgres service hostname or Neon hostname appears.
- These samples establish that no OAuth/PostgreSQL traffic was observed in that sampled window. They do not establish that OAuth has never been used or that database traffic is absent outside the retained sample.

### Implications
- The live Manager can advertise `ready` while its OAuth database is unavailable or misconfigured. The current legacy-readiness compatibility in the draft router must not be mistaken for verified OAuth readiness; a live cutover needs a tested DB-aware production readiness release or a separate independently authenticated DB probe.
- The only database identity that matters for the Manager's OAuth tokens is the database targeted by `OAUTH_DATABASE_URL`. The value is redacted by Railway's connected OAuth integration. The separate `OAUTH_DB_*` target and its confirmed private connection cannot substitute as proof.
- The existing temporary diagnostic function is exposed on a public Railway service domain without an authorization check in its deployed GET handler; when configured, it returns the current database name and a SELECT 1 result. Historical logs show public HTTP 200 requests. It is read-only, but unnecessarily exposes DB identity/availability and its access should be restricted or the temporary endpoint retired after a replacement is proven. No change was made to it.
- Existing daily backup service targets the separate `Postgres` service; no verified backup/restore coverage for `OAuth PostgreSQL` was discovered. The Manager's actual target remains unknown pending a safe inspection of `OAUTH_DATABASE_URL`.

### Next cycle
1. Obtain a safe, owner-visible resolution of the Manager's `OAUTH_DATABASE_URL` reference (e.g. confirm which Railway service's DATABASE_URL it references); do not paste the secret value into chat.
2. If it resolves to `OAuth PostgreSQL`, require a verified backup/archive and an isolated restore rehearsal for that service before considering any cutover.
3. If it resolves to `Postgres`, verify the existing daily backup is that exact dataset and test a restore; do not rely on volume names alone.
4. Update the production readiness contract in an isolated release candidate so `/readyz` fails closed when OAuth is enabled but DB connectivity is unverified, then run full OAuth lifecycle and rollback tests before deploying.
5. Restrict or retire the public temporary diagnostic endpoint after an authenticated replacement is established; do not break a relied-upon monitor without confirming dependencies.

No production service, variable, DB, volume, route, credential, schedule, Discord configuration, or client endpoint was changed in this cycle.
