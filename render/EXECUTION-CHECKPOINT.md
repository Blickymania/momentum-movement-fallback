# Dawn Dotta Render Free Migration — Execution Checkpoint

Last updated: 2026-11-14 (UTC)

## Project and component
- Project: Dawn Dotta / Momentum Movement
- Component: independent HTTP/MCP Discord Manager only
- Hosting target: Render Free Web Service
- Deployment intent: validation/cold-fallback preparation only; not a production primary

## Current Render resources
- Workspace: My Workspace (tea-dbcqe7ss728c73fthlug)
- Service: dawn-dotta-discord-manager
- Service ID: srv-dbs3q4d6e07s738obp4g
- Dashboard: https://dashboard.render.com/web/srv-dbs3q4d6e07s738obp4g
- Public URL: https://dawn-dotta-discord-manager.onrender.com
- Region/plan: Virginia / Free
- Source: Blickymania/momentum-movement-fallback, branch infra/dawn-dotta-cloudflare-worker
- Runtime/build: Docker, root build context, render/Dockerfile, Bun 1.4.4, port 10000
- Auto deploy: OFF
- Health check: /healthz (process liveness only; temporary until dependencies are configured)
- Latest verified deployment: dep-dbs3vgl6e07s738oqtsg, status live, commit f201fffb52388d690967cb551165b4be7f223d2b
- Blueprint: exs-dbs3tfafngtc73bl7li0; autoSync=false; status paused by design because automatic sync is disabled. Last sync observed 2026-11-14T10:58:18Z.

## Completed objectives and changes
1. Created the Render Free validation service; no paid plan chosen.
2. Confirmed the original container built and launched successfully.
3. Confirmed public smoke tests before the Blueprint health-path sync:
   - GET /healthz -> HTTP 200, body reports status ok.
   - GET /readyz -> HTTP 503, reason: configuration (expected while required runtime settings are absent).
4. Added root render.yaml:
   - Existing service managed using adopt mode (no duplicate service).
   - Docker runtime, Free, Virginia, root context, render/Dockerfile.
   - autoDeployTrigger: off.
   - healthCheckPath: /healthz.
   - WRITES_ENABLED: "false".
5. Approved the reviewed Blueprint sync; Render read-back confirms service health check path /healthz, plan free, autoDeploy off, and latest deploy live.
6. Set non-secret Render variables: APPLICATION_ID, AUTHORIZED_GUILD_ID, DISCORD_OAUTH_CLIENT_ID (same Discord application ID), DISCORD_OAUTH_REDIRECT_URI, OAUTH_ISSUER_URL, and OAUTH_RESOURCE_URL. The environment update triggered deployment dep-dbs3vgl6e07s738oqtsg, now verified live. No secret values were added.
7. Updated render/DEPLOYMENT.md to explain the interim liveness check and DB network constraint.
8. No Render cron jobs, monitoring pings, or scheduled automation created.

## Changes / commits
- a18f8a3a216eae65d565eabe9d0f89b9b4f1e0e8 — add render.yaml and configure Render Free validation service.
- 180869e65bcae4fda61068f2468ecd8e8ba29a8e — document Render interim health check and database prerequisites.
- Render created deployment dep-dbs3tik9v7es73bkalu0 and confirmed status live.

## Database findings and blocker
- Existing Railway OAuth PostgreSQL service ID 3e71f6b5-a248-40b6-b185-a748a5f5b436 is live in SFO with a persistent volume. It has only a private-network endpoint (oauth-postgresql), no public service domain, and no TCP proxy. Render cannot reach Railway private network from this Free service. Do not expose or modify that database to work around the network boundary.
- Railway OAuth DB credentials and manager secrets are redacted by the connected Railway OAuth tool; values are unavailable for secure transfer here.
- Neon project autumn-moon-71501044 currently has only branch staging (br-long-rice-bfm97hf6), database momentum_oauth_staging, region aws-us-west-2. A fresh read-only count returned zero rows in each of:
  - mcp_oauth_clients
  - mcp_oauth_login_requests
  - mcp_oauth_authorization_codes
  - mcp_oauth_access_tokens
  - mcp_oauth_refresh_tokens
- Do NOT assume this blank Neon staging database contains production/active OAuth client registrations or tokens. Do not point Render to it until the intended data source and migration/re-registration plan are confirmed.
- The checked-in Cloudflare failover Worker only probes origins and has no database binding or URL; it does not identify the OAuth DB. No separate Dawn Dotta Cloudflare database Worker was found in the connected GitHub repositories. The intended DB endpoint therefore remains unidentified. render/DEPLOYMENT.md records this constraint.

## Runtime configuration still required
Populate values through Render Dashboard Environment only; never paste secrets into chat or source control. Required keys include:
- APPLICATION_ID
- AUTHORIZED_GUILD_ID
- DISCORD_BOT_TOKEN
- MANAGER_SERVICE_KEY (use the same secret value as the current Railway RAILWAY_SERVICE_KEY during migration to preserve existing static-bearer clients; rotate only after all consumers are updated)
- MCP_OAUTH_ENABLED
- OAUTH_DATABASE_URL (only after intended, reachable, data-bearing DB is confirmed)
- DISCORD_OAUTH_CLIENT_ID
- DISCORD_OAUTH_CLIENT_SECRET
- DISCORD_OAUTH_REDIRECT_URI = https://dawn-dotta-discord-manager.onrender.com/oauth/callback, after registering the same exact redirect in Discord Developer Portal
- OAUTH_ISSUER_URL and OAUTH_RESOURCE_URL (canonical Render origin and /mcp resource)
- WRITES_ENABLED=false is defined in render.yaml; retain this until controlled write tests are authorized and completed.
- Render PORT is supplied by platform; Dockerfile currently defaults to port 10000.

## Tests and verification
- Container build/deploy: passed; latest deployment status live.
- /healthz: HTTP 200 observed before latest Blueprint redeploy; subsequent Render deployment finished live with /healthz configured as the HTTP health check.
- /readyz: HTTP 503 with reason configuration observed before bot credentials were configured; expected to remain unavailable until the Discord bot token and identity values are fully active.
- Post-Blueprint public HTTP recheck was attempted but Browser Use returned an internal error and web opener could not access the service URL. Do not claim a post-sync public HTTP retest.
- Discord bot identity: not yet tested on Render.
- OAuth callback/token flows: not yet tested on Render.
- External PostgreSQL connectivity: not yet tested on Render.
- GitHub Actions run #557 previously ended startup_failure with jobs: []; no CI test jobs executed.

## Scheduled processes
- No new Render cron jobs or scheduled processes created.
- Existing Railway project scheduled services were discovered and left untouched; they are independent of this migration. No Railway scheduling changes made.

## Production safety
- Existing Railway production manager remains in place and unchanged.
- Cloudflare router configuration remains unchanged; Render is not yet added as a fallback origin.
- No Gateway lease/fencing code or production routing was changed.
- No writes enabled. No production cutover or Gateway takeover performed.
- Render Free sleeps after idle time and is only a validation/cold-fallback target, not an always-on production failover.

## Remaining objectives
1. Resolve the OAuth database source with the user: preserve/migrate existing Railway OAuth PostgreSQL data, or explicitly start fresh on empty Neon staging and accept client/token re-registration.
2. Configure the confirmed, externally reachable database connection securely in Render.
3. Add Discord bot credentials, application ID, authorized guild ID, OAuth client ID/secret, provider-neutral manager key, and correct Render redirect URI via the dashboard.
4. Register the exact Render redirect URI in Discord Developer Portal.
5. Verify /readyz returns HTTP 200 with Discord and DB verified; then change the Render health check from /healthz to /readyz.
6. Test OAuth discovery, dynamic client registration, authorize/callback, token, refresh and revoke using a non-production/test client before any migration/cutover.
7. Test authenticated manager status and read-only guild audit; keep WRITES_ENABLED=false.
8. Run a Free-tier sleep/wake test; document cold-start impact and limitations.
9. Only after all checks pass, separately review failover router integration. Do not change production routing without an explicit cutover decision.

## Exact next execution step
External/user-only blocker: choose the OAuth database source before entering credentials. Option 1 is preserve the existing Railway OAuth PostgreSQL data by arranging a supported, secure migration to a database reachable from Render; do not expose the private Railway hostname. Option 2 is deliberately start with the empty Neon staging database and accept that existing OAuth client registrations, tokens, and grants will not be present and clients may need re-registration. The checked-in Cloudflare router has no database binding; a separate Worker configuration was not available in the connected GitHub repositories. Once the database decision is made, add its connection string, Discord bot token, Discord OAuth client secret, and the current Railway shared manager key as MANAGER_SERVICE_KEY directly in Render Dashboard Environment (never in chat or GitHub). Register the exact Render callback in Discord Developer Portal, then validate /readyz and OAuth. Do not add Render to router config or change production traffic while this remains unresolved.


## Option A selected — preserve Railway OAuth PostgreSQL

User selected Option A on 2026-11-14: preserve the existing Railway OAuth PostgreSQL database and migrate it to an externally reachable PostgreSQL destination. Do not reset or replace the source database.

### Source database verified
- Railway project: a1d6b0e4-3169-4c5d-add3-84a70f7dc525
- Environment: production (c72ea3d9-2c1c-4651-a265-79723e317fa5)
- Service: OAuth PostgreSQL (3e71f6b5-a248-40b6-b185-a748a5f5b436)
- Image: postgres:18-alpine
- Region: SFO
- Persistent volume: OAuth PostgreSQL Data, 1024 MB, mounted at /var/lib/postgresql/data
- Latest database deployment: c231847f-46aa-4808-a026-106062f2f860, SUCCESS
- Private DNS endpoint: oauth-postgresql
- Source variables include DATABASE_URL, PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSWORD, but Railway's connected OAuth integration redacts their values.
- No Railway TCP proxy currently exists. The service is not publicly exposed.
- Railway connector-tunnel listing returned an internal tool error; do not assume a tunnel is available.
- Database schema/data row counts and current backup state have not yet been verified directly against the Railway source.

### Destination prepared
- Neon project: autumn-moon-71501044
- Source template branch: staging (br-long-rice-bfm97hf6), database momentum_oauth_staging
- Neon staging database reports PostgreSQL 18.7, matching the Railway PostgreSQL 18 major version.
- Created a separate, non-default, no-compute branch for the migration target:
  - Name: railway-oauth-migration
  - Branch ID: br-summer-union-bfqjjfbw
  - Parent: staging branch br-long-rice-bfm97hf6
  - State: ready
  - No compute endpoint provisioned; no compute usage yet.
- This branch inherits the staging schema, which includes the five OAuth tables, gateway lease tables/functions, and schema-version table. It does not yet contain Railway source data.
- Do not run destructive restore/clean operations on the staging parent or production database. Restore only into this isolated migration branch after source backup and target schema plan are verified.

### Migration method and current blocker
- Neon documents pg_dump/pg_restore as the supported PostgreSQL migration approach; use an unpooled target connection and inspect/test before cutover. The official Neon guide currently documents PostgreSQL 14–17 in its general import text, while the actual Neon staging server reports PostgreSQL 18.7. Confirm the destination branch's actual server version before restore.
- A same-project Railway migration job could reach the private source, but Railway is currently blocked by the past-due billing state and must not be used to create paid resources.
- The other available route is a temporary Railway TCP proxy. This would expose the database on a public TCP endpoint during migration and may incur network egress. It is NOT enabled. Do not enable it without explicit user authorization to the temporary exposure and any associated egress charges.
- No database credentials were revealed or copied into chat, GitHub, or Render.
- No source writes, schema changes, service restarts, public exposure, or production routing changes were made.

### Exact next step
Resolve a secure, cloud-only path to read the private Railway PostgreSQL source without enabling an unapproved public TCP endpoint or incurring Railway charges. If no private migration runner is available under the current account, explain the one-time temporary TCP proxy requirement and obtain explicit approval before creating it. Then take a source backup, restore into Neon branch br-summer-union-bfqjjfbw, verify schema and row counts, and only then configure Render to use the new Neon branch.
