# Momentum Movement execution checkpoint

**Checkpoint date:** 2026-11-13  
**Project:** Dawn Dotta / Momentum Movement only  
**Repository:** Blickymania/momentum-movement-fallback  
**Working branch:** infra/cloudflare-free-migration  
**Railway project:** a1d6b0e4-3169-4c5d-add3-84a70f7dc525  
**Railway production environment:** c72ea3d9-2c1c-4651-a265-79723e317fa5  
**Discord guild/application:** 1565048205970767992 / 1565304619838742598

## Current phase

- **Phase 1 — Infrastructure inventory and source recovery:** COMPLETE for all recoverable Railway Function sources.
- **Phase 2 — Portable HTTP/MCP, OAuth and D1 adapter:** IMPLEMENTED and locally tested; Cloudflare deployment is externally blocked by account access.
- **Phase 3 — Gateway protocol, shared coordinator, durable queues and DO adapter:** IMPLEMENTED in isolated code and locally tested; production Gateway activation remains disabled.
- **Phase 4 — Feature-handler parity, data migration, Cloudflare runtime soak and rollback:** NOT COMPLETE.
- **Production cutover:** NOT STARTED.

## Completed work

### Source recovery and infrastructure inventory

- Verified the authorized Railway project and production environment.
- Recovered 29 Railway Function source snapshots into `recovered/railway/functions/`, plus the manager, original LIVE & Events Listener, decoded Bot 005 and existing Postgres backup command.
- Scanned all 29 recovered function snapshots. Six include Gateway login/connection behavior; the original `index.tsx` LIVE & Events Listener is the seventh. No further Gateway client was found in the recovered function set.
- Inspected 34 Railway services, 5 persistent volumes, 2 PostgreSQL services and 1 original-media object bucket.
- Bot 005's decoded guild/application constants match Momentum Movement. No secret values were copied or committed.
- The manager's prior read-only Discord audit passed. No Discord content or configuration has been changed by this migration.
- The original media vault latest run (Nov 13, 2026 23:50:05 UTC) validated 3/3 configured forums and 13/13 direct sources; visited 26/26 source objects; SHA-256 readback-verified 29 image attachments totaling 1,770,831 bytes; zero held items, retries, Discord writes or deletes. All 29 sampled items were marked low resolution (maximum dimension <=400px). This is one verified run, not full-bucket coverage.
- Main Postgres daily backup completed Nov 13, 2026 with a 31,806-byte object, remote-size validation and nonempty `pg_restore --list`; no full isolated restore has been performed.
- Seven-day Railway service disk metrics reported 0.15433728 GB for Postgres and 0.068870144 GB for OAuth PostgreSQL. These are service-level metrics, not SQL database-only sizes or row counts.

### Portable manager, OAuth and D1 code

- `src/worker.mjs`: Workers entry point for HTTP/MCP, health/readiness, OAuth routing and protected internal Gateway controls.
- `src/manager-core.mjs`: extracted manager behavior with fixed Momentum Movement guild/application checks and read/write safeguards.
- `src/oauth-routes.mjs`: dynamic registration, exact redirect allowlisting, state validation, S256 PKCE, Discord owner/admin authorization, single-use authorization-code exchange, refresh rotation, revocation, resource and scope-bound token authentication.
- `src/oauth-d1-store.mjs`: D1 persistence adapter with hashed tokens, conditional one-time claims, nonce-bound inserts, transactional authorization-code exchange and refresh-token rotation.
- `migrations/0001_oauth_schema.sql`: versioned SQLite/D1 OAuth schema.
- D1 operations were exercised using local SQLite with D1-compatible prepared-statement and batch wrappers. No real Cloudflare D1 instance exists yet.

### Gateway protocol, durable inbox and shared coordinator

- `src/gateway-protocol.mjs`: Gateway v10 frame parsing, Identify/Resume/Heartbeat creation, HELLO decisions, heartbeat ACK, reconnect/invalid-session and close-code decisions, bounded jittered reconnect backoff and session+sequence event keys.
- `src/durable-gateway-inbox.mjs`: namespaced per-client durable queues; atomic dispatch sequence and event writes; replay protection; event/byte capacity ceilings; idempotent acknowledgements; persistent FIFO queue order; bounded paginated reads; explicit session clearing without deleting pending events.
- `src/gateway-coordinator-core.mjs`: side-effect-isolated multi-identity coordinator with one shared alarm; separate session and inbox state per client; HELLO/Identify/Resume; scheduled and server-requested heartbeats; multiple pending ACK accounting; heartbeat timeout recovery; reconnect/resume; invalid-session handling; close-code classification; stale-generation fencing; terminal configuration failures; in-memory SHA-256 token-fingerprint deduplication; duplicate application/token-reference rejection; and explicit fatal-state reset.
- The coordinator rejects multiple configured clients sharing one application ID because application sharding is not implemented. It also rejects duplicate token fingerprints in memory before opening a second socket. Secret tokens and fingerprints are not logged or persisted.
- `src/gateway-coordinator-do.mjs`: SQLite-backed Durable Object adapter with bearer-protected internal controls, per-client bot/application/guild REST identity checks, persistent stop/start state and alarm-based recovery after object re-instantiation.
- `src/worker.mjs` exports `GatewayCoordinatorDurableObject`; internal routes use one stable DO identity, `momentum-movement`.
- `wrangler.toml.example` declares one SQLite Durable Object class/migration and one D1 database binding. OAuth and Gateway activation flags are both false; no Cron Trigger is configured. Wrangler deployment itself has not been validated with Wrangler CLI or a Cloudflare account.
- The core persists raw Gateway dispatch events in isolated inboxes. The seven original clients' downstream feature handlers have not yet been fully ported/fanned out with end-to-end idempotent acknowledgements. The shared coordinator is not production-ready solely because its protocol tests pass.

## Verification

**Latest complete repository regression:** **110 tests passed, 0 failed, 0 skipped** across all 8 test files.  
**Syntax verification:** all 8 source modules and all 8 test files passed Node `--check`.

Suites cover:

- Manager core identity, scope, permission and write-safety behavior.
- OAuth D1-compatible SQLite schema, atomic claims, concurrency, PKCE, refresh rotation and revocation.
- OAuth HTTP routes, Discord admin callback and fail-closed storage outage behavior.
- Worker/MCP authentication, health/readiness, scope enforcement and internal Gateway controls.
- Gateway protocol, heartbeat/ACK behavior and close-code decisions.
- Durable inbox isolation, FIFO ordering across storage pages, 1,200-event pagination, event/byte limits and replay protection.
- Multi-client coordinator lifecycle, token/application isolation, identity checks, heartbeat, server-requested heartbeats, restart/resume, stale socket fencing, queue overflow and stop.
- Durable Object controls, default-disabled activation, bot/guild identity verification, restart recovery and durable stop state.

The hosted isolated Node runner used direct `node --test` and `node --check` commands. Its environment does not contain npm, so the package scripts are defined but the npm wrappers themselves were not executed. These tests are code-level simulations: local SQLite, fake Durable Object storage, fake sockets and mocked Discord REST. They do not prove Cloudflare D1 behavior, real Durable Object behavior, a live Discord Gateway connection, 24-hour lifecycle, quota headroom or a production cutover.

## Cloudflare account and Free-tier feasibility gates

- The Cloudflare dashboard was verified signed out at `https://dash.cloudflare.com/login`. No Cloudflare account, Free plan, API authorization or resources are verified. The owner must sign in and confirm Free products work without entering a payment method.
- Free Durable Objects use SQLite-backed storage; KV-backed Durable Objects are not available on the Free plan. D1 Free limits include 5 million row reads/day, 100,000 row writes/day and 5 GB total storage.
- Durable Objects Free includes 13,000 GB-s/day, 100,000 requests/day and 5 GB SQLite storage. Duration is charged for the 128 MB allocation even if actual memory use is lower.
- Outbound WebSockets do not use Durable Object WebSocket Hibernation. An active outbound socket can prevent eviction for up to 15 minutes; heartbeats, alarms and other work keep the object active.
- A continuously active 128 MB coordinator for 24 hours is approximately 11,059 GB-s/day (128 MB x 86,400 seconds), about 85% of the 13,000 GB-s/day Free duration budget before other requests/processing. This is an illustrative capacity estimate, not measured usage or a guarantee. The proposed single central coordinator is therefore a high-risk Free-tier fit and requires an actual 24-hour soak with quota telemetry before any production use.
- If the no-card account does not support the required runtime within Free limits, do not switch on billing or paid overages. Stop/retain the Railway rollback or choose a different verified free architecture.
- Never enable a paid plan, payment method, add-on or metered overage. At quota exhaustion, fail closed, preserve durable queues and wait for reset.

## Seven-client identity and feature parity blockers

The source-level Gateway clients are LIVE & Events Listener, Bot 005, Social Owner Console, Fan Club Level-Up, LIVE NOW V2 Shadow Engine, Discord Engagement Engine and Gift Assist.

- All expose a variable named `DISCORD_BOT_TOKEN`; this does not prove that token values or bot identities are the same. Values have not been compared.
- The non-secret flag names `LISTENER_RUNTIME_ACTIVE`, `LIVE_V2_CUTOVER` and `LIVE_V2_ACTIVE` were observed, but runtime values remain redacted. Current LIVE NOW shadow/cutover ownership is unknown.
- Intent union includes Guilds, GuildMessages, MessageContent (privileged), DirectMessages and optional GuildPresences. Effective privileged-intent approvals must be confirmed before enabling any such intent.
- A handler/side-effect parity matrix and idempotent downstream dispatch/ack layer are still required for interactions, message XP, LIVE link publishing, event workflows, Fan Club, owner/profile console, Gift Assist/payment callbacks, Bot 005 commands and maintenance behavior.
- No production token has been used in tests or placed in the migration repo.

## Data, media and restore blockers

- Railway direct SQL read/restore tooling was not available. Both database schemas, database-only sizes, row counts, extension dependencies and exact backup coverage remain unverified.
- The main Postgres backup log is not a full restore. The OAuth PostgreSQL database must be separately backed up and restored.
- Original media bucket total object count/bytes and a full checksummed manifest are unknown. Latest vault run covers 29 sampled images only.
- Large media streaming is treated as disabled because `UMM_LARGE_MEDIA_ENABLED` was not found in the observed variable-name inventory. Do not enable until storage headroom and restore tests pass.
- Do not delete, expire, relocate or lifecycle-expire original media during migration.

## Existing production state and scheduler controls

- `Dawn Dotta News Forum 24h Retention Cleanup` has a crashed latest deployment and an already staged three-change patch to remove its obsolete five-minute cron and disable its retired target. That staged patch has not been accepted, discarded or modified during this work.
- Existing business schedules are recorded in `docs/RAILWAY_INVENTORY.md`. They must be consolidated under one project dispatcher only after schedule and parity mapping.
- No new Cron Trigger, DO alarm beyond the single Gateway coordinator alarm, recurring repair, keepalive, health-ping loop or scheduled automation has been created.
- Production Railway services/configuration/variables/volumes/buckets/databases/deployments remain unchanged.
- Discord channels, roles, messages, commands, bot settings and Gateway processes remain unchanged.
- No other Discord community was accessed.

## Exact next execution step

Implement and test the downstream event/interaction handler registry and durable delivery/ack boundary against the seven-client parity matrix, without using production credentials or opening production sockets. Then verify backup coverage and isolated restore for both PostgreSQL databases and build a complete original-media manifest. Cloudflare provisioning remains blocked until the owner signs in to a verified no-card Free account; after that, deploy only isolated test resources and conduct a 24-hour quota/lifecycle soak before making any production plan.
