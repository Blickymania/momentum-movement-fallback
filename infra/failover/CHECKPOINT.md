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

## Additional completed cycles — 2026-11-13

### Cycle 4 exact verification
- Re-extracted the live Railway Manager source from its configured start command.
- Compared it byte-for-byte after UTF-8 decode with the GitHub recovery snapshot payload.
- Current live source length: 44479; saved source length: 44479; exact equality: true.
- The saved source has no detected Discord bot token, GitHub token, AWS access key, private-key block, static Bearer token, or inline OAuth secret.

### Cycle 6 — isolated Cloudflare Worker port
- Branch: `infra/dawn-dotta-cloudflare-worker` (no production deployment or routing change).
- Files: `src/index.ts`, `package.json`, `tsconfig.json`, `wrangler.jsonc`.
- Port converts Bun.serve to the Workers fetch entry point, Bun.env to request-scoped AsyncLocalStorage, and Bun SQL to a parameterized node-postgres adapter.
- PostgreSQL transaction adapter implements BEGIN/COMMIT/ROLLBACK and maps existing unsafe(sql, values) calls.
- /readyz keeps Discord bot/guild identity checks and additionally tests PostgreSQL when OAuth is enabled.
- Static source checks: no Bun-only runtime API/import, Worker entry present, request-local context, parameterized SQL, transactions, readiness DB check, MCP tool surface preserved, no common embedded credential patterns, and no POST retry code.
- Full TypeScript compilation, Wrangler dry-run, live database tests, OAuth lifecycle tests, and Cloudflare deployment remain unverified because no account binding/DB connection is available.

### Cycle 7 — independent Render Bun fallback
- Files on migration branch: `render/manager.ts`, `render/Dockerfile`, `render/DEPLOYMENT.md`.
- Render package contains the exact recovered 44,479-character Bun Manager source. Docker base is the official `oven/bun:1.4.4` image.
- Render Free can host a cold backup with no card, but the provider documents sleep after inactivity, 750 shared instance-hours/month, and says Free services are not for production. It is not a continuous-uptime primary.
- No Render service has been created; the tool requires the user to select the workspace `My Workspace` (ID `tea-dbcqe7ss728c73fthlug`) before any workspace-scoped work.

### Cycle 8 — failover routing candidate
- Files on migration branch: `src/failover-router.ts`, `wrangler.router.jsonc`.
- Priority is Cloudflare Manager primary → existing Railway Manager secondary → Render cold fallback.
- Each origin must answer /readyz with HTTP 200, Manager name exactly `Dawn Dotta Discord Manager`, and `discordVerified: true`.
- Actual incoming request is forwarded to exactly one selected origin. No POST retry/replay occurs after upstream transport failure.
- Status endpoint: `/_failover/status`; router liveness endpoint: `/healthz`; readiness endpoint: `/readyz`.
- The Cloudflare router is itself on Cloudflare. If Cloudflare's global edge is unavailable, manual direct use of the Render or Railway origin is the recovery path; this is not cross-provider DNS failover.

### Validation and CI
- Branch static checks run in the connector-side JavaScript inspection: 12/12 Worker/router invariants passed.
- Added `tests/port-invariants.test.mjs`, package scripts for typecheck/tests/dry-run of both Workers, and push-only GitHub Actions workflow `.github/workflows/validate-worker.yml`.
- GitHub run `43534576722` ended with `startup_failure`, and its jobs endpoint reported `total_count: 0`. This is not a test pass or a compile failure; no runner job started, so the npm/TypeScript/Wrangler validation steps have not executed.
- No scheduled workflow/cron was added. CI is push/pull-request event-driven only.

### New blockers / user actions
1. Cloudflare account access: dashboard sign-in inspection pending. No Workers/Hyperdrive resources, secrets, DNS, or payment methods have been changed.
2. Neon Free database: not yet created. Current production OAUTH_DATABASE_URL must first be ownership-mapped without exposing the secret; a Dawn-only Neon database needs to be provisioned and OAuth rows migrated under secure user-controlled credential handling.
3. Render workspace: explicit user selection of `My Workspace` is required before creating or inspecting services.
4. Provider secrets: owner must place existing bot token, manager key, OAuth client secret, and database connection values directly in destination secret stores; never share them in chat or Git.
5. Router origins: Cloudflare Worker and Render URLs are unknown until created; configure `MANAGER_PRIMARY_ORIGIN` and `RENDER_FALLBACK_ORIGIN` after deployment. The Railway secondary URL is prefilled in the router config.
6. Final cutover, OAuth redirect update, MCP client URL switch, controlled write validation, and post-cutover Discord audit remain pending.

## Last verified state after cycles 6–8
- Existing Railway Manager remains online; production service config was not altered.
- The existing staged News Cleanup patch remains untouched.
- Recovery snapshot exactly matches the current live source: true.
- Cloudflare Worker, Render Docker fallback, and edge router are committed only on `infra/dawn-dotta-cloudflare-worker`.
- Static source checks passed; hosted build/test and provider deployments did not.
- No new scheduler or cron job.

## Exact next execution steps
1. Complete the pending Cloudflare browser session check; do not make changes unless already authenticated and no-card Free plan is confirmed.
2. Diagnose why the GitHub Actions run created no job and decide if a user-side repository Actions setting is blocking runners; otherwise use a local build path with npm dependencies.
3. Get explicit Render workspace selection before Render service creation.
4. Identify the existing Dawn Manager OAuth database without reading/displaying its secret; create isolated Neon Free DB and migrate only Dawn OAuth tables securely.
5. Configure Hyperdrive and the Worker secrets. Run typecheck, tests, Wrangler dry-runs, DB/OAuth/Discord read tests, then a controlled write test.
6. Create the Render cold fallback with secrets configured; validate /readyz and MCP connectivity.
7. Configure and test the router with all three origins; verify no POST replay.
8. Perform reversible endpoint cutover only after every readiness and rollback condition passes. Re-run status, guild audit, OAuth, and MCP tests.


## Cycle 9 — provider access and final state revalidation (2026-11-13)

### Browser access check
- Opened Cloudflare dashboard in an isolated read-only browser task.
- Result: could not verify authentication/account/plan because dashboard failed to load with `ERR_SOCKS_CONNECTION_FAILED` / `ERR_QUIC_PROTOCOL_ERROR`.
- No Cloudflare resources, account settings, DNS, secrets, or payment methods were changed.
- User must provide working Cloudflare account/session access (Free/no card) before Worker, Hyperdrive, or routing resources can be created.

### CI recovery
- Checked all 8 latest workflow runs on `infra/dawn-dotta-cloudflare-worker`.
- All 8 ended `startup_failure`.
- Latest run ID `43534837859`; jobs endpoint returns `total_count: 0`. Repeated behavior across each branch update rules out a one-off failed unit test: GitHub never started a runner.
- No compiler/test logs available. Do not report GitHub Actions tests as passed. Root cause cannot be verified with the available GitHub read API; account/repository Actions service availability or runner startup must be investigated in the GitHub account UI/support.
- Local static source inspection remains the only completed code validation in this environment; typecheck, npm tests, Wrangler dry runs have not executed.

### Current production checks rerun
- Dawn Dotta Manager status: connected; bot identity/guild match; HTTP 200 for Discord identity and guild.
- Read-only audit passed again at 2026-11-14T00:34:10Z, warnings none, no exceptions.
- Railway prod Manager is currently reported online; production configuration and deployment untouched.
- Existing News Forum staged patch still untouched.

### Exact next user-only access requirement
- Render connector listed only workspace `My Workspace` (ID `tea-dbcqe7ss728c73fthlug`), but requires explicit user workspace selection before scoped service operations. No Render service created.
- Cloudflare dashboard access needs a usable authenticated session; the attempted read-only browser connection failed at proxy/network before login. No Cloudflare deployment possible until this is fixed.
- Production OAuth database ownership and safe export route still need identifying; do not reuse the unrelated Supabase projects.


## Cycle 10 — Cloudflare account access and dependency recheck (2026-11-13 ET / 2026-11-14 UTC)

### Confirmed
- The user's connected browser now exposes a signed-in Cloudflare account home page. Account dashboard access is confirmed; this is not yet confirmation of the Workers plan, payment-method status, or enabled resources.
- Cloudflare's current official public materials advertise Workers Free with no credit card required and document 100,000 requests/day, 10 ms CPU time/request, 128 MB memory, 50 subrequests/request, and 6 simultaneous outgoing connections/request.
- Hyperdrive is included on Workers Free with 100,000 database statements/day; when a free limit is exceeded, additional operations fail until reset rather than silently becoming unlimited.
- The existing Railway OAuth PostgreSQL is its own service with a private-only service endpoint, no public domain, and a 1 GB persistent volume. Do not assume Cloudflare or Render can connect to that private hostname.
- The Manager's environment-variable names include Discord credentials, manager bearer key, OAuth client ID/secret/redirect, issuer/resource URLs, database URL and host/user/password values, signing/encryption keys, and write flag. Values were not read or copied.
- Render workspace metadata shows one workspace named "My Workspace" (tea-dbcqe7ss728c73fthlug). Its service tools explicitly require the user to choose a workspace before workspace-scoped operations; no Render resource was created.

### Not completed / not claimed
- The Cloudflare Workers & Pages page has not been inspected; current account page does not show existing Worker scripts, Hyperdrive configs, databases, KV, R2, or Queue resources.
- The Cloudflare browser-control task remained non-terminal after 240 seconds. It yielded no completed resource inventory. No second automation run was launched.
- No Cloudflare resources, plan changes, payment details, API tokens, secrets, DNS, or deployments were created or changed.
- GitHub Actions CI remains unverified: prior runs returned startup_failure with zero jobs. This is not a code-test pass.
- The migration branch's local/static invariants are not a substitute for TypeScript compilation, npm tests, Wrangler dry-runs, live database/OAuth tests, or deployment verification.

### Next step
- Inspect the signed-in Cloudflare account's Workers & Pages view, Workers plan, and billing status without changing settings. The user's connected browser can supply that view by opening:
  https://dash.cloudflare.com/7738d94fbc5466ad91eb65045ee746f2/workers-and-pages
- Only use Workers Free and zero-cost resources. Stop at any upgrade, paid-plan, payment-method, or card prompt.
- Before deploying the Worker, fix and verify the Postgres/Hyperdrive binding in wrangler.jsonc, and define a secure migration route for the private Railway OAuth database. Keep the current Railway Manager and OAuth database available until the new endpoint passes real readiness, OAuth lifecycle, MCP read, controlled write, and rollback tests.
- Preserve the separate LIVE/Events Gateway listener; do not combine it with the stateless Manager migration.
- Do not create scheduled jobs or new cron processes.
