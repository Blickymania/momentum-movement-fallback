# Dawn Dotta Discord Manager — Northflank deployment

**Scope:** Dawn Dotta / Momentum Movement only. This is an independent HTTP/MCP Manager runtime, not the Bot 005 Discord Gateway. It must not open a second Discord Gateway connection.

## Deployment status

- Source package: prepared on branch `infra/dawn-dotta-northflank-manager`.
- Runtime: Bun 1.4.4, using the recovered Manager source at `render/manager.ts`.
- Container: `northflank/Dockerfile`.
- Build context: repository root.
- Container port: TCP 3000 / HTTP.
- Readiness endpoint: `GET /readyz`.
- Writes: keep `WRITES_ENABLED=false` until identity, OAuth, database, and controlled-write checks pass.
- Production: no Northflank account resources, secrets, databases, or routes have been created by this repository change.

## Northflank Sandbox and budget

Northflank currently advertises a free Sandbox with no credit card required, two services, two jobs, one database, and up to $20/month of resource usage. Workloads are always on and do not sleep.

Currently displayed compute plans on Northflank's public pricing page:
- nf-compute-50: 0.5 vCPU / 1 GB — $12.00/month.
- nf-compute-100-2: 1 vCPU / 2 GB — $24.00/month.
- nf-compute-200: 2 vCPU / 4 GB — $48.00/month.

The $20 Sandbox resource allowance is shared across Northflank Cloud resources; it is not $20 per workload. The displayed 10 GB PostgreSQL calculator example is $13.17/month, so nf-compute-50 ($12) plus that database example totals $25.17/month and exceeds the Sandbox allowance before additional build storage, backups, logs, or network egress. The larger listed compute plans exceed the allowance before a database is added.

A smaller database plan or disk allocation might change the estimate, but its Sandbox eligibility, minimum compute, disk, backups, and actual allowance consumption are not yet verified in the account. Do not assume the full Manager + database stack fits for free. Inspect the account calculator first; do not select Pay as You Go, upgrade, attach a payment card, or accept any charge. Stop if the actual Sandbox estimate exceeds the free allowance.

## Recommended project layout

Create one Northflank project named `momentum-movement-manager` with:

1. One deployment service: `dawn-dotta-discord-manager`.
2. One secret group for runtime credentials and connection settings.

**Do not create a Northflank PostgreSQL addon as the production OAuth store yet.** A private Northflank addon is reachable by services inside the project, but the Railway, Cloudflare, and Render fallback origins do not automatically share that private network. A Northflank-only database would create a second data domain and could make the fallbacks appear healthy while lacking the live OAuth clients, authorization codes, access tokens, and refresh tokens.

For true cross-provider Manager failover, all eligible origins must use the same logical OAuth data plane, or a formally replicated store with measured lag, conflict handling, and a tested promotion process. The database must also survive an outage of the Northflank compute/provider if it is meant to support Railway as a fallback. A database hosted only beside the Northflank service does not satisfy that fault-domain requirement.

Northflank supports private project networking by default, plus optional public TCP ingress with TLS for supported PostgreSQL addons. Public ingress can be restricted with network rules, but it is a security-sensitive change and must not be enabled as a shortcut. Choose the database topology first; then configure only the minimum network path required for every approved Manager origin. 

## Database topology decision

A persistent Manager process and a responsive database do not, by themselves, provide safe provider failover. Northflank and every fallback Manager origin must reach the **same logical OAuth data plane**. Otherwise clients, authorization codes, access tokens, and refresh-token rotations can diverge when the router changes origins.

A Northflank PostgreSQL addon is private to its project by default and remains in the Northflank fault domain. Railway, Cloudflare, or Render do not automatically share that private network; a Northflank-wide outage could affect both its Manager and attached database. Do not use a provider-local addon as the production OAuth store for a cross-provider failover design.

### Neon shared-database candidate

Neon Free is now the preferred candidate to inspect for a shared PostgreSQL data plane because it is external to Northflank, Railway, Cloudflare, and Render. Its current Free plan includes:
- 100 CU-hours per project per month.
- 1 GB PostgreSQL storage per project.
- 5 GB public network transfer per project per month.
- Up to 2 CU autoscaling.
- Scale-to-zero after five minutes of inactivity; this setting is fixed on Free.
- Reactivation after a new query is documented to take a few hundred milliseconds.

At 0.25 CU, 100 CU-hours represents about 400 active compute-hours per month. Actual usage depends on autoscaling, request frequency, and how long the database remains active. When a project's free compute or network-transfer quota is exhausted, Neon documents that its compute is suspended until the next billing period or an upgrade.

Neon requires encrypted SSL/TLS connections; use a pooled connection string where supported and keep `sslmode=require`. A dedicated database role with only the OAuth schema privileges is preferable to an owner credential in each Manager. Neon IP Allow is currently a Scale-plan feature, not a Free-plan security control, so the free endpoint must be protected with strong unique credentials, TLS, secret-manager-only storage, least privilege, and credential rotation. Do not assume IP allowlisting is available on Free.

**Operational caveat:** No periodic ping or keepalive should be added to prevent scale-to-zero. Normal Manager requests can wake the database. The application must tolerate the brief cold-start delay and surface quota exhaustion as a real readiness failure. Monitor CU-hours and network transfer through the Neon account tooling once available; do not keep the database awake with artificial traffic.

Neon is a candidate, not yet an approved production dependency. Before using it, measure the existing OAuth database size and traffic, verify the current account's free-plan quota and project state, create only an isolated staging database, test pooled and unpooled connections from each intended runtime, prove the OAuth lifecycle and backup restore, and confirm acceptable cold-start latency and quota headroom. No production data should be copied until all tests pass.

**Current decision: no independent shared production PostgreSQL provider has been selected or verified.** Do not create a second isolated OAuth database and do not configure `NORTHFLANK_MANAGER_ORIGIN` in the router until the candidate and existing Railway Manager are proven to use the same logical database, with row-count/digest reconciliation, OAuth lifecycle tests, and a rehearsed restore path.

References:
- Northflank PostgreSQL network access: https://northflank.com/docs/v1/application/databases-and-persistence/access-a-database
- Northflank current Sandbox and compute prices: https://northflank.com/pricing
- Neon current Free plan quotas: https://neon.com/docs/introduction/plans
- Neon current scale-to-zero behavior: https://neon.com/docs/introduction/scale-to-zero
- Neon pooled connection strings and TLS: https://neon.com/docs/connect/connect-from-any-app
- Neon IP Allow availability: https://neon.com/docs/manage/ip-allow

## Service configuration

In Northflank, connect the private repository and configure:

- Project: `momentum-movement-manager`
- Service: `dawn-dotta-discord-manager`
- Service type: deployment
- Build context: repository root
- Dockerfile: `northflank/Dockerfile`
- Runtime port: `3000`
- Public HTTP ingress: enabled for the Manager service, with Northflank HTTPS termination
- Replicas: 1
- Initial compute candidate: `nf-compute-50` (0.5 vCPU / 1 GB), subject to the $20 combined Sandbox allowance
- Health check: HTTP readiness probe on `/readyz`, port 3000; use a 15-second probe timeout because readiness checks Discord and PostgreSQL
- Auto-deploy: off until the migration branch is reviewed and a first manual deployment is verified

Do not use a Render or Cloudflare Docker image as a substitute for building the current repository revision. Keep the source revision and deployment ID in the checkpoint.

## Runtime variables and secrets

Set these inside Northflank's encrypted secret/variable management. Never place values in Git, CI logs, screenshots, or chat.

**Secrets**
- `DISCORD_BOT_TOKEN`
- `MCP_INTERNAL_BEARER_TOKEN` — preferred static internal MCP credential
- `RAILWAY_SERVICE_KEY` — compatibility alias for existing clients still using the legacy credential name; set to the same intended secret only where needed
- `DISCORD_OAUTH_CLIENT_SECRET`
- `OAUTH_DATABASE_URL` — connection string for the selected shared OAuth data plane; it must be reachable from every eligible Manager origin and must not point to an isolated Northflank-only production database
- `OAUTH_SIGNING_KEY`
- `OAUTH_TOKEN_ENCRYPTION_KEY`

**Non-secret or provider-managed variables**
- `APPLICATION_ID`
- `AUTHORIZED_GUILD_ID`
- `WRITES_ENABLED=false`
- `MCP_OAUTH_ENABLED=true` when the OAuth database and OAuth setup have passed validation
- `DISCORD_OAUTH_CLIENT_ID`
- `DISCORD_OAUTH_REDIRECT_URI`
- `OAUTH_ISSUER_URL`
- `OAUTH_RESOURCE_URL`
- `PORT=3000`
- `DEPLOYMENT_PLATFORM=northflank`

Use the exact Dawn Dotta application and guild identifiers from the approved production configuration. Do not reuse another community's IDs, credentials, database, or OAuth project.

The legacy production Manager currently exposes a `RAILWAY_SERVICE_KEY` compatibility name. The candidate runtime accepts `MCP_INTERNAL_BEARER_TOKEN` first and retains `RAILWAY_SERVICE_KEY` as a compatibility fallback. Do not rotate the production secret as part of this migration.

## OAuth database migration

The Manager uses PostgreSQL for OAuth clients, login requests, authorization codes, access tokens, and refresh tokens. The existing production `OAUTH_DATABASE_URL` hostname is not readable through the current connected Railway API (the connection returns variable names only). The exact owning database therefore remains unverified.

**This is a hard deployment gate.** A successful `SELECT 1` only proves that a host can reach *a* database; it does not prove that it is the same OAuth dataset as the live Railway Manager. The Northflank candidate must not receive traffic while its database is empty, stale, or different from the database used by another eligible origin.

Before copying data:
1. Identify the current database owner and confirm it is Dawn-only.
2. Record the exact schema, extensions, indexes, constraints, row counts, and backup coverage without exposing credentials.
3. Choose one shared data-plane design that can be reached securely by Northflank and every fallback origin. Evaluate provider diversity, TLS, IP/network restrictions, connection pooling, backup/restore, limits, and outage behavior.
4. Verify the selected provider's no-card policy and the full compute + database + disk + egress budget. A free database that scales to zero or expires is not automatically suitable for production failover.
5. Export/import only the Dawn Manager OAuth schema using secure database-to-database tooling.
6. Compare table row counts and canonical data digests; verify PKCE, single-use authorization code consumption, refresh-token rotation, expiry cleanup, and restore from backup.
7. Keep the original database and its backups unchanged for rollback.
8. Prove both candidate Manager origins read the same data plane and can complete a controlled OAuth lifecycle before enabling either one in the router.

Do not point the new Manager at a guessed Railway database or repurpose either existing Supabase OAuth project. Do not treat a separately created Northflank database as shared state merely because it has the same schema or passes `SELECT 1`.

## Readiness and routing contract

The Manager's `/readyz` must return HTTP 200 and:
- `status: "ready"`
- `manager: "Dawn Dotta Discord Manager"`
- `discordVerified: true`
- `oauthDatabaseVerified: true`

Readiness fails closed when the OAuth database is enabled but cannot answer `SELECT 1`, or when the Discord bot/application/guild identity check fails.

The failover router's own `/readyz` and `/_failover/status` are strict: they return HTTP 503 with `status: "degraded"` when a Manager origin is reachable but no ready origin explicitly verifies the shared OAuth database. The router can still forward requests to the existing Railway Manager; it must not advertise full readiness until the selected origin proves the database check.

After Northflank has a real HTTPS origin and its readiness endpoint passes:
- Set `NORTHFLANK_MANAGER_ORIGIN` on the Cloudflare failover router.
- Keep the verified Railway origin as the legacy secondary.
- Keep the Cloudflare Worker Manager port as an optional tertiary only after its real database binding is deployed and validated.
- Keep Render last as a cold fallback.
- Do not change the MCP client URL or OAuth issuer/redirect settings until router readiness, OAuth lifecycle, read tests, controlled write tests, and rollback are verified.

## Verification and rollback

Run these checks before enabling Northflank in the router:
1. Container build succeeds from the selected Git commit.
2. Service stays running; no sleep/scale-to-zero behavior is configured.
3. `/healthz` returns HTTP 200.
4. `/readyz` returns the exact identity fields and `oauthDatabaseVerified: true`.
5. Database outage causes `/readyz` to return HTTP 503.
6. Discord bot token and guild/application identity checks succeed.
7. MCP discovery/initialize/tools/list work through the candidate origin.
8. OAuth discovery, registration, authorization, callback, PKCE exchange, refresh-token rotation, revocation, and expiry cleanup pass.
9. Writes remain disabled until read and security tests pass; then perform a single controlled owner-authorized write with explicit rollback.
10. Router status marks Northflank ready and safely selects the next origin when Northflank is unavailable.
11. A failed write is never automatically replayed to another origin.

Keep Railway production, its OAuth database, and existing MCP endpoint untouched until the new route passes and rollback is rehearsed. Do not run two Manager origins with different OAuth databases as active writable endpoints unless the data and token semantics have been synchronized and verified.

## External account steps

A Northflank account/API connector is not connected in this execution environment. Repository changes can prepare the deployment, but project creation, secret injection, database creation, and live deployment require an authenticated Northflank account. Do not paste tokens or passwords into chat; use Northflank's secret manager or an authorized deployment workflow.


## Neon staging account verification (2026-11-14)

An isolated Neon Free staging project was created for connectivity experiments only:

- Project: `momentum-movement-oauth-failover-staging` (`autumn-moon-71501044`)
- Region: `aws-us-west-2`; PostgreSQL 18
- Default branch/database/role: `staging` / `momentum_oauth_staging` / `momentum_oauth_staging`
- Compute min/max: 0.25 CU
- Read-only SQL connectivity and server-version check passed; the database has zero application tables.
- No production OAuth data, clients, tokens, or schema were imported.

**Important Free-plan limitation observed:** requesting a 300-second suspend timeout at project creation returned HTTP 412 because this account does not permit modifying the suspend interval. The created endpoint reports `suspend_timeout_seconds: 0`, so automatic scale-to-zero is not verified and must not be assumed. The endpoint was manually suspended after the SQL check, then set `disabled: true`; a fresh listing confirms `current_state: idle` and `disabled: true`. This blocks accidental wakeups until deliberately re-enabled for a test. Explicitly suspend and disable it again after every test and monitor account usage. Do not connect a live service to this project until a safe idle/cost-control strategy is proven.

This staging project is not a production database candidate yet. Still required: secure TLS app-runtime connection test, pooler test, network-access review, schema parity, measured usage, backup/restore test, OAuth authorization/PKCE/refresh/revocation/expiry tests, and successful integration across every intended Manager origin. No Railway variables or Northflank secrets were set.

Production inventory also found two distinct Railway PostgreSQL services: `OAuth PostgreSQL` (1GB volume) and `Postgres` (5GB volume). Manager's OAuth variables are present but values are redacted. The live temporary diagnostic function uses `OAUTH_DB_*` variables and its historical SQL health checks returned HTTP 200, but its database target is not yet proven identical to the Manager's. Identify the exact reference before any migration or shared-database design decision.


## Production PostgreSQL backup coverage finding (2026-11-14)

Read-only Railway network-flow tracing identified two separate paths:

- The temporary OAuth diagnostic function reaches the `OAuth PostgreSQL` service on private TCP 5432. Its destination address matches the source/listener address recorded by that Postgres service.
- The existing `Postgres Daily Backup` worker reaches the separate `Postgres` service on private TCP 5432. Its destination address matches that service's recorded address.

The existing daily backup worker's logs show successful custom-format dumps on Nov 11–13 (31,806 bytes each), with archive listing, remote object-size, and SHA-256 metadata checks. Those logs do not prove a full restore. No worker-to-`OAuth PostgreSQL` traffic was observed, and no other OAuth PostgreSQL backup/restore mechanism has been verified. Therefore **OAuth PostgreSQL backup coverage is an unresolved critical gate**; do not migrate or designate a new shared OAuth store until a restorable backup is proven.

The Manager has the same OAUTH_DB_* variable names as the diagnostic function, but Railway redacts the values and they are not project shared-variable names. Same names do not prove same targets. The Manager's actual DB target remains unresolved pending an authorized safe diagnostic. No production service, DB, backup schedule, or credentials were changed.


## Production Manager OAuth identity and readiness audit (2026-11-14)

The currently deployed Railway Manager source was inspected directly (Bun 1.4.4, no staged change). It constructs the OAuth SQL client exclusively from `OAUTH_DATABASE_URL`; the live source does not read `OAUTH_DB_HOST/NAME/USER/PASSWORD`. The separate temporary Railway diagnostic function uses those `OAUTH_DB_*` variables and has been network-traced to the `OAuth PostgreSQL` service. Consequently, the diagnostic function's connection to `OAuth PostgreSQL` does not prove that the Manager's `OAUTH_DATABASE_URL` uses the same database. Railway's connected OAuth integration redacts the Manager variable value; resolve its service reference through an authorized owner-visible configuration check before any migration or topology decision. Never paste the secret URL into chat.

The live Manager's `GET /readyz` checks Discord bot identity and guild access and then returns `discordVerified: true`; it does **not** verify `MCP_OAUTH_ENABLED`, `OAUTH_DATABASE_URL`, or run `SELECT 1`. Its `/healthz` is HTTP-only. Recent retained telemetry contained only `POST /mcp` in 501 HTTP records, no database ports in the matching network sample, and DNS entries only for `discord.com`. This means no OAuth/database usage was observed in that retained sample, not that it has never been used.

Therefore the existing live Manager can report ready while OAuth storage is unavailable or incorrectly configured. Do not use that legacy readiness response as evidence of shared database readiness. The proposed Northflank/Worker candidates must continue to fail closed when OAuth is enabled and their database check fails. Production Manager readiness must eventually be upgraded in a separately tested release, with OAuth database readiness included before router cutover.

The temporary diagnostic function's public Railway domain is unauthenticated at the application layer and its GET handler returns a database name plus a simple database connectivity result. This does not expose credentials or rows, but unnecessarily reveals DB identity/availability; restrict or retire it once an authenticated replacement is established. No change was made to the diagnostic function in this audit.
