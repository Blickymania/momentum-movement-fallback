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

Published container compute examples:
- `nf-compute-20`: 0.2 shared vCPU / 512 MB — $5.40/month.
- `nf-compute-50`: 0.5 shared vCPU / 1 GB — $12.00/month.
- `nf-compute-100-1`: 1 dedicated vCPU / 1 GB — $18.00/month.

The $20 allowance applies to the combined managed resources; it is not $20 per workload. PostgreSQL compute, persistent disk, backups, build storage, logging, and network egress can consume the same allowance or create additional usage. The Northflank pricing calculator's example PostgreSQL database (10 GB disk) is $13.17/month. Therefore a $12 Manager plus that database exceeds the advertised $20 allowance.

A theoretical lower-cost configuration could combine a $12 Manager with a small PostgreSQL plan and minimal disk, but the exact available database plan, disk minimum, and live resource estimate must be verified in the account before any resource is created. Do not select Pay as You Go, upgrade, attach a payment card, or accept any charge. Stop if the actual Sandbox estimate exceeds the free allowance.

## Recommended project layout

Create one Northflank project named `momentum-movement-manager`:

1. One deployment service: `dawn-dotta-discord-manager`.
2. One PostgreSQL addon dedicated to the Manager's OAuth persistence.
3. One secret group for runtime credentials and connection settings.

Keep the database private to the project. Enable TLS for PostgreSQL and link its connection details to the Manager service through Northflank's secret/variable mechanism. Do not expose the database publicly just to make it reachable.

Northflank documentation says services and addons in the same project can communicate over private networking. A database is private by default unless public access is explicitly enabled.

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
- `OAUTH_DATABASE_URL` — Northflank private PostgreSQL connection string with TLS enabled
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

Before copying data:
1. Identify the current database owner and confirm it is Dawn-only.
2. Record the exact schema, extensions, indexes, constraints, and row counts without exposing credentials.
3. Create the independent Northflank PostgreSQL addon only after the free resource estimate is verified.
4. Export/import only the Dawn Manager OAuth schema using secure database-to-database tooling.
5. Compare table row counts and canonical data digests; verify PKCE, single-use authorization code consumption, refresh-token rotation, and cleanup behavior.
6. Keep the original database and its backups unchanged for rollback.

Do not point the new Manager at a guessed Railway database or repurpose either existing Supabase OAuth project.

## Readiness and routing contract

The Manager's `/readyz` must return HTTP 200 and:
- `status: "ready"`
- `manager: "Dawn Dotta Discord Manager"`
- `discordVerified: true`
- `oauthDatabaseVerified: true`

Readiness fails closed when the OAuth database is enabled but cannot answer `SELECT 1), or when the Discord bot/application/guild identity check fails.

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
