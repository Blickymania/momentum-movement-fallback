# Dawn Dotta failover — execution checkpoint
Updated: 2026-11-13
Scope: Dawn Dotta / Momentum Movement only. No other Discord community or project may be changed.

## Current verified production state
- Railway project: Dawn Dotta / Momentum Movement.
- Railway Manager remains the known-good production endpoint and was last verified online with a successful deployment.
- Discord Manager status previously verified connected; authorized guild identity matched; writes enabled.
- Read-only guild audit previously passed (108 channels, 12 roles, 13 forums, 36 commands, 13 categories; no warnings).
- Preserve Railway production, its secrets, DBs, routes, and scheduled services until a fully verified replacement exists.
- Existing Railway News Forum 24h Retention Cleanup service remains crashed; its pre-existing staged patch `df7920c5-7cf6-4d0b-896b-f9e405ac7895` remains untouched.

## Cloudflare account inspection (read-only)
- User's authenticated browser tab ID 1554475672 is on Workers & Pages for account ID `7738d94fbc5466ad91eb65045ee746f2`.
- Workers subdomain: `redcell4400.workers.dev`.
- Dashboard showed 0 / 100,000 Worker requests today and 0 / 200,000 observability events today, plus one existing Worker: `empress-discord-cloudflare`.
- That existing Worker belongs to another community and is explicitly out of scope. Do not inspect its code/secrets, modify, deploy over, or route Dawn traffic through it.
- No Dawn Dotta Worker, Hyperdrive, D1, KV, R2, Queue, or Workflow has been created by this project.
- The Workers dashboard displayed free daily request allowance. Cloudflare official documentation confirms Workers Free is 100,000 requests/day and 10ms CPU/invocation; Hyperdrive Free is included with 100,000 database statements/day, with over-limit requests failing rather than auto-upgrading. Sources: https://developers.cloudflare.com/workers/platform/pricing/ and https://developers.cloudflare.com/hyperdrive/platform/pricing/
- Cloudflare's official Hyperdrive PostgreSQL guide confirms node-postgres `pg@8.16.3` is supported/recommended with `nodejs_compat`, and demonstrates a fresh `Client` per request backed by Hyperdrive pooling. Source: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/
- Free usage counters do not establish that account signup/payment method requirements have been verified. Do not add a card or enable paid billing.
- The browser inspection connector is read-only; user can open the Hyperdrive page in the same authenticated tab at https://dash.cloudflare.com/7738d94fbc5466ad91eb65045ee746f2/workers/hyperdrive for further inspection.

## Recovery code branch
- Private repository: `Blickymania/momentum-movement-fallback`.
- Working branch: `infra/dawn-dotta-cloudflare-worker`.
- Worker port: `src/index.ts`; router: `src/failover-router.ts`; Wrangler config: `wrangler.jsonc`; tests: `tests/port-invariants.test.mjs`.
- This is isolated migration code only. It is not deployed and has not passed a full build/runtime/integration test.
- Worker config currently has no Hyperdrive binding ID. Do not add a fabricated ID; add a binding only after an actual Dawn-only Hyperdrive resource exists.
- The Worker uses `pg` and a request-scoped client. Cloudflare's docs support that driver/client pattern; runtime behavior still needs Wrangler build and a live test against a Dawn-only DB.
- The Worker DB falls back to `OAUTH_DATABASE_URL`; the Railway OAuth PostgreSQL service uses a private Railway endpoint. Do not assume Cloudflare can reach it. Verify network path or provision a separate dedicated DB with a safe migration/rollback plan.
- `mcpOAuthSchemaPromise` caches schema initialization at isolate scope; verify concurrency/error behavior under actual Workers runtime before production.
- Router is itself a Cloudflare Worker and therefore is not independent of Cloudflare edge availability. It can fail over upstream origins only while the router/Cloudflare platform is reachable. Manual direct-origin recovery remains necessary if Cloudflare itself is unavailable.
- Render cold fallback package exists, but Render workspace selection is a user-only action; do not inspect/create Render resources until the user explicitly selects workspace `My Workspace` (ID `tea-dbcqe7ss728c73fthlug`).
- Existing GitHub Actions CI has previously returned startup failure / zero jobs; no test pass may be claimed.

## Changes in this cycle
- Reviewed the Worker and router source and confirmed no actual deployment or production changes.
- Found a deterministic false-positive in the static test: the no-replay regex matched the source comment "Never retry a timed-out POST", so it would fail even when behavior was correct.
- Replaced that assertion with a narrower invariant that checks the Discord upstream call is issued once.
- GitHub commit: `978a6060ce66bbd0dc62904ec1193fda48eb0adf`.
- Updated test blob SHA: `b980a5a864c19957d1d03547a06d94d731a6a31f`.
- This change is committed on the isolated migration branch only. It has not yet been executed by Node/GitHub Actions, so it is a test correction, not a passing test result.

## Scheduler control
- No new scheduler, cron, reminder, monitor, or automation created.
- Existing Railway cron services remain untouched.
- No centralized maintenance process added; scheduler inventory remains to be completed for Dawn-only services before any future scheduler change.

## Remaining objectives
1. Inspect Hyperdrive dashboard and Workers Plans in the authenticated account; determine whether a Dawn-only Hyperdrive resource can be created within Free tier without payment method. Do not create until DB endpoint/network compatibility is understood.
2. Inspect the Railway OAuth DB's ownership and connectivity requirements; preserve all existing OAuth records and do not migrate unrelated/shared databases.
3. Complete code review for OAuth schema initialization, transaction safety, token rotation/revocation, and Workers CPU/subrequest limits.
4. Obtain an executable test environment; run `npm ci`, `npm run typecheck`, `npm test`, `npm run dry-run`, and router dry-run. Diagnose GitHub Actions startup issue or use a local reproducible build.
5. Fix any build/test/runtime issues, checkpoint each change.
6. Deploy only a non-production Dawn-only test Worker after Hyperdrive and secrets are correctly provisioned; verify /healthz, /readyz, OAuth health/flows, manager status, read-only guild audit, and controlled write tests with writes initially disabled.
7. Validate router failover against verified endpoints; never replay a timed-out Discord write.
8. Only after all tests pass, plan an explicit safe cutover with rollback. Keep Railway live until verified.
9. Investigate the pre-existing News Forum cleanup crash separately; do not apply the existing staged patch without understanding it.
10. Audit existing scheduled jobs and ensure at most one centralized maintenance/recovery process per Dawn project.

## Blockers / exact next action
- Current browser tab is authenticated and already on Workers & Pages. Open https://dash.cloudflare.com/7738d94fbc5466ad91eb65045ee746f2/workers/hyperdrive in that same tab, then allow read-only inspection of the page contents. This will establish the account's actual Hyperdrive inventory and creation requirements.
- No credentials, passwords, API tokens, or payment details should be sent in chat.
- No paid plan, card, production secret, production DB, or DNS change is authorized.


## Follow-up audit — 2026-11-13

### Additional code and infrastructure findings
- Re-read the Worker port, router, package scripts, Wrangler configs, Render deployment notes, and test suite from the current branch.
- The Cloudflare port's use of `pg@8.16.3` and a fresh per-request PostgreSQL client matches Cloudflare's current official Hyperdrive guidance. This confirms driver compatibility on paper only; it does not prove a working database route or successful build. Source: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/
- The production Railway OAuth Postgres endpoint previously inventoried is private-only. Cloudflare Hyperdrive requires a database hostname/IP and port reachable from Cloudflare; the private Railway service hostname must not be assumed reachable. Before binding anything, verify whether Railway exposes a TCP proxy/public endpoint or provision a separate Dawn-only database with an explicit data migration and rollback plan. Source: https://developers.cloudflare.com/hyperdrive/get-started/
- The Worker currently derives its OAuth issuer and Discord callback from `OAUTH_ISSUER_URL` and `DISCORD_OAUTH_REDIRECT_URI`. These values must be set specifically for the new Worker origin and the exact `/oauth/callback` route, and the corresponding redirect must be registered with Discord. Copying Railway's existing values unchanged could send the callback back to Railway. Do not change production OAuth settings during testing.
- The router config currently has only the Railway fallback origin; no Cloudflare primary origin is configured. The Cloudflare router itself is not an independent failover if Cloudflare edge is unavailable. Treat it as an upstream selector only while Cloudflare is reachable, and retain manual direct-origin recovery.
- Render deployment notes correctly identify a free service as a sleeping cold fallback, not a production-availability guarantee. It remains uncreated pending explicit workspace selection.

### CI status — newly rechecked
- The branch contains `.github/workflows/validate-worker.yml`, but the latest GitHub Actions run records report `startup_failure`, `path: BuildFailed`, and zero jobs. The latest commits also have zero check runs and no commit statuses. Therefore GitHub Actions is not currently providing executable validation; this is not evidence that the code passed or failed its tests.
- The corrected no-replay static assertion remains committed as `978a6060ce66bbd0dc62904ec1193fda48eb0adf`; it has still not executed.
- No runtime test, Wrangler dry-run, Cloudflare deployment, OAuth integration test, or failover test has passed.

### Current Cloudflare browser state
- The authenticated tab is still on Workers & Pages, not the Hyperdrive page. The account inventory remains unchanged: only `empress-discord-cloudflare` is listed. Do not touch it.
- No Hyperdrive resource or Dawn Worker has been created.
- Exact next dashboard page to inspect in the same authenticated tab: https://dash.cloudflare.com/7738d94fbc5466ad91eb65045ee746f2/workers/hyperdrive

### Cycle outcome
- Inspection completed; one false-positive test repaired in the prior cycle; additional OAuth/network/CI blockers documented.
- No production resources, Discord state, secrets, databases, billing settings, DNS, or schedules were changed.
- Status: `BLOCKED — awaiting Hyperdrive dashboard inspection and a reachable Dawn-only database endpoint; code remains unbuilt/unverified.`


## Follow-up execution cycle — source-level validation

### Work completed
- Re-inspected the current Worker, router, OAuth implementation, static test suite, package scripts, and Wrangler configs.
- Ran 18 focused source-level assertions in an isolated JavaScript execution environment against the exact current GitHub branch contents.
- Assertions covered request-local database context, fresh PostgreSQL client creation, parameterized SQL, schema-init error reset, one-time authorization-code consumption under row lock, refresh-token rotation/revocation, token hashing, Discord guild admin/owner verification, OAuth write-scope enforcement, hard-coded Dawn guild/application identity guard, destructive Discord deletion blocking, no automatic Discord write replay, HTTPS-only router origins, readiness identity verification, one-shot router forwarding, package test/build scripts, and existing static-test coverage.
- Result: **18 passed, 0 failed**.
- These were source-level assertions executed against retrieved source text. They are not the repository's `npm test`, TypeScript compilation, Wrangler dry-run, or live Worker/OAuth/Discord/database tests. Do not report the application as built or runtime-verified.
- No source changes were needed in this cycle; no code commit was created. This avoids adding more static tests while the actual runner remains unavailable.

### Risk review
- OAuth authorization-code and refresh-token one-time semantics are protected by PostgreSQL row locks and transactions in the inspected source.
- OAuth access/refresh token values are hashed before persistence.
- Callback checks that the Discord account is owner or administrator of the exact configured guild.
- Remaining critical external dependency is a verified, reachable Dawn-only PostgreSQL endpoint and Hyperdrive configuration. No resource has been created and no Railway DB/network setting was changed.
- Actual build/runtime validation remains blocked by the GitHub Actions startup failures (zero jobs) and lack of an authorized local/remote build runner.

### Current scheduler inventory
- No new scheduler or recurring automation created.
- Existing Railway cron services remain untouched; the centralized-maintenance maximum-one audit is still outstanding.

### Cycle verification
- Source-level validation: 18/18 passed.
- GitHub Actions: latest recorded runs still startup-failed with zero jobs; not a passing CI result.
- Production Railway, Discord, Cloudflare resources, OAuth DB records, secrets, DNS, and billing: unchanged.

### Exact next execution step
1. Inspect the authenticated Cloudflare Hyperdrive dashboard and Workers plan page using the existing signed-in browser session; do not touch the Empress Worker or create a paid resource.
2. Independently inspect whether the Dawn Railway OAuth Postgres service has a documented/reachable external connection option without changing its configuration.
3. Once a safe Dawn-only endpoint is confirmed, provision the least-privileged database path and run real build/runtime tests; otherwise keep the migration isolated and continue code-side work.
