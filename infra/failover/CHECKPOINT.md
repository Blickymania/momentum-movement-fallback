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
