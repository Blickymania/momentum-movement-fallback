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

A persistent manager process and a ready database do not, by themselves, provide a safe provider failover. Northflank and every fallback Manager origin must reach the **same logical OAuth data plane**. Otherwise tokens, registrations, authorization codes, and refresh-token rotations can diverge when the router changes origins.

Northflank PostgreSQL supports external TLS TCP access for supported addons, so another provider can be configured to reach the same addon. However, that database remains in Northflank's fault domain. A Northflank-wide outage would remove both the Manager and its database; it is therefore not a fully independent database layer even if Railway can connect to it.

A separately hosted database is preferable for cross-provider resilience, but it must be selected and costed before provisioning. Neon Free is one test candidate, not a production recommendation: its current free-plan documentation lists 100 CU-hours per project/month, 1 GB storage, 5 GB egress, and scale-to-zero after five minutes. That sleep behavior and its prototype/small-team positioning make it unsuitable as the only always-on production OAuth data plane without an accepted wake-up/availability risk.

**Current decision: no independent shared production PostgreSQL provider has been selected or verified.** Do not create a second isolated OAuth database and do not configure `NORTHFLANK_MANAGER_ORIGIN` in the router until the candidate and existing Railway Manager are proven to use the same logical database, with row-count/digest reconciliation, OAuth lifecycle tests, and a rehearsed restore path.

References:
- Northflank PostgreSQL network access: https://northflank.com/docs/v1/application/databases-and-persistence/access-a-database
- Neon free-plan limits: https://neon.com/docs/introduction/plans

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

The failover router's own `/readyz` is stricter: it returns HTTP 503 with `status: "degraded"` when it selected the legacy Railway origin but that origin does not explicitly report OAuth database verification. The router can still forward requests to the existing Railway Manager; it must not advertise full readiness until the selected origin proves the database check.

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
