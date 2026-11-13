# Momentum Movement execution checkpoint

**Checkpoint date:** 2026-11-13  
**Project:** Dawn Dotta / Momentum Movement only  
**Repository:** Blickymania/momentum-movement-fallback  
**Working branch:** infra/cloudflare-free-migration  
**Railway project:** a1d6b0e4-3169-4c5d-add3-84a70f7dc525  
**Railway production environment:** c72ea3d9-2c1c-4651-a265-79723e317fa5  
**Discord guild/application:** 1565048205970767992 / 1565304619838742598

## Current phase

- **Phase 1 — Inventory and source recovery:** COMPLETE for all recoverable Railway Function sources.
- **Phase 2 — Portable HTTP/MCP and OAuth code:** IMPLEMENTED and locally tested; Cloudflare deployment remains blocked by account access.
- **Phase 3 — Gateway supervisor, data migration, media coverage and scheduler plan:** IN PROGRESS / NOT DEPLOYED.
- **Production cutover:** NOT STARTED.

## Completed work

### Source recovery and project inventory

- Verified the authorized Railway project and production environment.
- Recovered 29 Railway Function source snapshots into recovered/railway/functions/, plus the manager, original LIVE & Events Listener, decoded Bot 005 and existing Postgres backup command.
- An exhaustive scan of all 29 recovered function snapshots found six with Gateway login/connection behavior. The original index.tsx LIVE & Events Listener is the seventh. No further Gateway client was found in the remaining recovered functions.
- Bot 005's decoded guild/application constants match Momentum Movement. No secret values were copied or committed.
- Inspected 34 Railway services, 5 persistent volumes, 2 PostgreSQL services and 1 original-media object bucket.
- Latest read-only health inspection: the manager is live; 33 other services were not reported failed; the retired News Forum cleanup remains the one service with a crashed deployment and pre-existing staged patch.
- The manager's prior read-only Discord audit passed; no Discord content or configuration has been changed by this migration.

### Portable manager and OAuth code

- src/worker.mjs: isolated Workers entry for HTTP/MCP, health/readiness and OAuth routing.
- src/manager-core.mjs: extracted manager behavior with fixed Momentum Movement guild/application scope.
- src/oauth-routes.mjs: dynamic client registration, exact redirect allowlisting, OAuth state, S256 PKCE, Discord owner/admin membership verification, one-time code exchange, refresh rotation, revocation and bearer authentication.
- src/oauth-d1-store.mjs: D1 persistence adapter with hashed tokens, conditional one-time row claims, nonce-bound inserts, transactional authorization-code exchange/refresh rotation and revocation.
- migrations/0001_oauth_schema.sql: versioned SQLite/D1 OAuth schema.
- wrangler.toml.example: no-secret deployment example with placeholder D1 ID, OAuth disabled by default and no Cron Trigger.
- D1 transaction semantics have been verified against local SQLite test harnesses, not against a provisioned Cloudflare D1 instance.

### Gateway and inbox code

- src/gateway-protocol.mjs: side-effect-free Gateway v10 frame parsing, Identify/Resume/Heartbeat, Hello decisions, close-code handling, bounded reconnect backoff and session/sequence idempotency keys.
- src/durable-gateway-inbox.mjs: bounded transactional inbox with atomic sequence persistence, duplicate/replay rejection, event/byte ceilings, idempotent acknowledgements and monotonic FIFO queue order.
- Inbox pagination test covers 1,200 records over multiple storage pages; it returns the oldest queued events in order.
- No outbound Gateway client, lease/fencing supervisor or Cloudflare Durable Object runtime has been deployed or started.

### Gateway identity and intent audit

Seven live Railway services expose Discord Gateway client code:

1. LIVE & Events Listener (index.tsx): Guilds, GuildMessages, optional MessageContent; LISTENER_RUNTIME_ACTIVE and LIVE_V2_CUTOVER switches.
2. Bot 005: Guilds, DirectMessages, optional GuildPresences after a runtime application-flag check; direct-message partials.
3. Social Owner Console: Guilds; multiple interaction handlers and owner/profile dashboard.
4. Fan Club Level-Up: Guilds; interaction-driven Fan Club workflow.
5. LIVE NOW V2 Shadow Engine: Guilds, GuildMessages, optional MessageContent; LIVE_V2_ACTIVE and panel/paste flags.
6. Discord Engagement Engine: Guilds, GuildMessages, MessageContent; MessageCreate XP and interaction handlers.
7. Gift Assist: Guilds; interaction-driven gift/payment UI.

The same variable name DISCORD_BOT_TOKEN exists across services, but actual secret values were not inspected or compared. AUTHORIZED_GUILD_ID, APPLICATION_ID, and/or the original listener preflight verify some service scopes. Non-secret runtime flag names were inspected, but their values are redacted; current LIVE NOW shadow/cutover state is unknown. No consolidation is authorized until application identity, token identity, privileged intents, handler ownership and current runtime flags are verified.

### Database and media evidence

- Seven-day Railway service metrics (673 samples) report service-level disk usage of 0.15433728 GB for Postgres (about 158 MiB) and 0.068870144 GB for OAuth PostgreSQL (about 70.5 MiB). These are not SQL database-only sizes or row counts.
- Primary Postgres Daily Backup completed Nov 13 2026: 31,806 bytes, remote object-size check and non-empty pg_restore --list. This is not a full restore test and does not prove coverage of both Postgres services.
- Latest Original Media Vault Backup run completed Nov 13 2026 at 23:50:05 UTC. Source validation: 3/3 forums and 13/13 direct sources. It visited 26/26 source objects and checked 29 attachments (all images), total 1,770,831 bytes. All 29 had SHA-256 remote readback verification; saved=0, reused=29, held=0, pendingRetries=0, discordWrites=0, deleteCount=0.
- The media run also marked all 29 as low-resolution existing copies (maximum dimension no greater than 400 px). This is only a verified batch, not a full bucket inventory or proof all historical originals are high resolution.
- The original-media source has opt-in streaming/multipart support for attachments above 30 MiB. It requires UMM_LARGE_MEDIA_ENABLED=true; the observed environment variable-name list did not include this variable, so large-media streaming is treated as disabled. Oversized items are held/queued, not deleted. Do not enable until storage headroom and a full restore drill have passed.
- Media backup state/cursor and bounded retry records are stored in the object bucket. No bucket object count, total byte size or full restore has been established.

### Verification

**Latest combined regression:** 62 tests passed, 0 failed, 0 skipped.  
**Syntax verification:** all 6 source modules and all 5 test files passed Node --check.

Suites cover Gateway protocol, durable queue ordering/limits, OAuth D1-compatible SQLite persistence and concurrency, OAuth HTTP routes, and Worker/MCP boundary authentication/readiness.

These tests are isolated Node/SQLite verification. They do not prove Cloudflare D1 behavior, an actual Workers deployment, outbound WebSocket lifecycle, live Discord OAuth, or a 24-hour Gateway connection.

## Active blockers

- Cloudflare dashboard browser was verified signed out at https://dash.cloudflare.com/login. No Cloudflare account or Free plan is confirmed, and no account API authorization is available. Owner sign-in must be completed without adding a payment method before resource provisioning.
- Render has no workspace selected; none was chosen.
- Railway exposed no direct SQL query/restore path. SQL schema, database-only sizes, exact backup coverage and a full restore drill remain unverified.
- The media bucket's total object count/bytes and full manifest/restore are unknown. The large-media source path is currently treated as disabled.
- Gateway token equality, actual bot identities, approved privileged intents and runtime flag values remain unknown.

## Existing production failure / staged state — untouched

- Dawn Dotta News Forum 24h Retention Cleanup has a crashed latest deployment.
- A three-change Railway patch is already staged to remove the obsolete 5-minute cron and disable the retired target. This prior patch has not been accepted, discarded or modified as part of the migration.

## Scheduler and safety controls

- Existing business schedules are recorded in docs/RAILWAY_INVENTORY.md.
- No new Worker Cron Trigger, DO alarm, repair scheduler, keepalive, health-ping loop, reminder or recurring automation has been created.
- No separate scheduler was introduced to mask a failure. Event-driven recovery and bounded retries remain preferred.
- At eventual cutover, timed business workflows should be dispatched by one centralized scheduler and must not overlap with old Railway scheduled writers.
- No production Railway service/configuration/variable/volume/bucket/database/deployment changed.
- No Discord channel, role, message, command, bot setting or Gateway process changed.
- No other Discord community was accessed.

## Exact next execution step

Use the full seven-client map in docs/GATEWAY_AUDIT.md to design a single, testable Gateway supervisor and centralized lifecycle/dispatch plan without deploying or activating it. Keep the seven identities separate until a secure, non-disclosing credential/application-identity check proves which clients can share a session. Continue read-only database backup and media restore evidence collection where direct integrations allow. Wait for owner Cloudflare sign-in before creating any Cloudflare resources; do not add a payment method, scheduler or production deployment beforehand.
