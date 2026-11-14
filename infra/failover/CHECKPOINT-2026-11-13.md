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
