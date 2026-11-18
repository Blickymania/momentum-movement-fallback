# Momentum Movement execution checkpoint

**Checkpoint date:** 2026-11-13  
**Project:** Dawn Dotta / Momentum Movement only  
**Repository:** Blickymania/momentum-movement-fallback  
**Branch:** infra/cloudflare-free-migration  
**Railway project:** a1d6b0e4-3169-4c5d-add3-84a70f7dc525  
**Railway production environment:** c72ea3d9-2c1c-4651-a265-79723e317fa5  
**Discord guild/application:** 1565048205970767992 / 1565304619838742598

## Current phase

- **Phase 1 — Infrastructure inventory/source recovery:** COMPLETE for all recoverable Railway Function sources.
- **Phase 2 — Portable manager HTTP/MCP, OAuth and D1 adapter:** IMPLEMENTED and tested against isolated local wrappers; Cloudflare deployment blocked by account access.
- **Phase 3 — Gateway protocol, coordinator, durable inbox, registry, token vault and delivery framework:** IMPLEMENTED and locally tested in isolation.
- **Phase 4 — Original feature-handler adapters, live interaction acknowledgement, data migration, Cloudflare runtime soak, parity and rollback:** NOT COMPLETE.
- **Production cutover:** NOT STARTED. All Gateway/OAuth flags remain disabled by default. No Gateway production socket was opened.

## Completed work

### Source recovery and infrastructure inventory

- Verified the authorized Railway project and production environment.
- Recovered 29 Railway Function snapshots into `recovered/railway/functions/`, plus the manager, original LIVE & Events Listener, decoded Bot 005 and existing backup command.
- Scanned the recovered function set: six snapshots contained Gateway login/connection behavior, with the original `index.tsx` LIVE & Events Listener as the seventh. No additional Gateway client was found.
- Inspected 34 Railway services, 5 persistent volumes, 2 PostgreSQL services and 1 original-media object bucket.
- Bot 005's decoded guild/application constants match Momentum Movement. No production secret value was copied, printed or committed.
- The previous read-only manager Discord audit passed. No Discord content or configuration was changed in this migration.
- Latest Original Media Vault Backup run (Nov 13, 2026 23:50:05 UTC) validated 3/3 forums and 13/13 direct sources, visited 26/26 source objects and SHA-256 readback-verified 29 image attachments totaling 1,770,831 bytes. It reported zero held items, pending retries, Discord writes or deletes. All 29 sampled copies were marked low resolution (longest dimension <=400px). This is one batch, not full bucket coverage or proof of original resolution.
- Main Postgres backup on Nov 13, 2026 was 31,806 bytes, remote-size validated and had non-empty `pg_restore --list`. It is not a full isolated restore and does not prove OAuth PostgreSQL coverage.
- Seven-day Railway service disk metrics reported 0.15433728 GB for Postgres and 0.068870144 GB for OAuth PostgreSQL. These are service metrics, not SQL database-only size or row counts.

### Manager, OAuth and D1 candidate

- `src/worker.mjs`: Workers entry for HTTP/MCP, health/readiness, OAuth routes and protected internal Gateway control routes.
- `src/manager-core.mjs`: extracted manager operations with fixed guild/application scope, route validation, permissions and owner-preserving write safeguards.
- `src/oauth-routes.mjs`: dynamic client registration, exact redirect allowlists, S256 PKCE, Discord owner/admin authorization, single-use authorization codes, refresh rotation, revocation and scope/resource-bound bearer auth.
- `src/oauth-d1-store.mjs`: D1-compatible persistence with hashed tokens, conditional one-time claims and atomic exchange/rotation batches.
- `migrations/0001_oauth_schema.sql`: versioned SQLite/D1 schema.
- OAuth/D1 was exercised using local SQLite and D1-compatible wrappers. No Cloudflare D1 database has been provisioned.

### Gateway protocol and shared coordinator

- `src/gateway-protocol.mjs`: Gateway v10 parsing, Identify/Resume/Heartbeat, ACK, invalid-session/close-code decisions, bounded reconnect and session+sequence event keys.
- `src/durable-gateway-inbox.mjs`: namespaced per-client queues, atomic sequence/event writes, replay protection, byte/event limits, idempotent acknowledgements, monotonic FIFO, paginated bounded reads, sequence-only advancement for intentionally ignored events and session clearing without queue deletion.
- `src/gateway-coordinator-core.mjs`: one shared alarm, per-identity session/inbox state, heartbeat ACK accounting, server-requested heartbeats, restart/resume, bounded recovery, stale-generation fencing, terminal configuration errors, explicit fatal reset, duplicate application/token refusal and in-memory non-disclosing token fingerprint comparison.
- `src/gateway-coordinator-do.mjs`: SQLite Durable Object adapter with bearer-protected controls, matching handler manifest, verified bot/application/guild identity, persistent stop/start and alarm-driven recovery.
- `wrangler.toml.example`: one SQLite Durable Object binding/migration and one D1 binding. OAuth and Gateway flags false. No Cron Trigger.
- Core/DO tests use fake sockets, fake Durable Object storage and mocked Discord REST. No production credential or live Discord Gateway was used.

### Feature routing, durable delivery and interaction token protection

- `src/gateway-handler-registry.mjs`: source-backed feature ownership for seven original clients; exact `uniprof:` and `mompass:` collision resolution; guild/application checks; one selected LIVE publisher at a time.
- `docs/GATEWAY_DISPATCH_MATRIX.md`: 36 Bot 005 slash commands, seven feature owners, exact component selectors, channel/message exceptions, fan-out behavior and known limitations.
- `src/durable-gateway-dispatcher.mjs`: per-event/per-handler leases, stable idempotency keys, bounded retry/backoff, durable receipts, quarantine and FIFO acknowledgement only after all selected handlers commit.
- `src/interaction-token-vault.mjs`: AES-256-GCM for short-lived Discord interaction webhook tokens with unique nonce and AAD bound to interaction, application and guild IDs. Plaintext token is removed before durable payload storage.
- DO startup requires `GATEWAY_INTERACTION_ENCRYPTION_KEY` (64 hex chars/32 random bytes), handler manifest and client definitions. The coordinator fails closed rather than storing an unprotected interaction token.
- The Durable Object now wires the dispatcher to its single existing alarm for one adapter: Engagement Engine `MESSAGE_CREATE`. Its token is resolved only through the configured definition's `tokenRef`; unsupported feature handlers fail closed. A focused Durable Object test verifies that the durable XP receipt is completed before inbox acknowledgement. **The other six original feature adapters, immediate interaction ACK/defer/modal behavior, and live Discord deadline verification are still incomplete.** Keep the Gateway disabled until all interaction paths and feature parity are implemented and tested.

## Verification

**Latest full repository regression:** **159 tests passed, 0 failed, 0 skipped** across all 11 test files.  
**Syntax verification:** all 11 source modules and all 11 test files passed Node `--check`.

Coverage includes manager-core permissions/identity, OAuth/D1 transactions and concurrency, OAuth routes, Worker/MCP auth/readiness, Gateway protocol, 1,200-event multi-page inbox FIFO, handler-registry ownership/collisions, durable dispatcher leases/retries/crash idempotency, interaction token encryption/tamper rejection, multi-session coordinator lifecycle and Durable Object identity/restart recovery.

The hosted test runner lacked npm, so package scripts were not executed through npm. The exact same underlying test set was run with direct Node `--test`; syntax validation used Node `--check`. All tests are isolated simulations. They do not prove a live Cloudflare deployment, real D1/DO service behavior, live OAuth, live interaction acknowledgements, 24-hour WebSocket persistence, Free quota fit or production parity.

## Active blockers and external dependencies

- Cloudflare browser session was verified signed out at `https://dash.cloudflare.com/login`. No Cloudflare account, no-card Free plan or API authorization is currently verified. Owner sign-in and confirmation of Free availability without adding a payment method are required before provisioning.
- Render has no workspace selected; none was chosen.
- Railway SQL query/restore tooling was unavailable. Schemas, row counts, exact dump coverage and full isolated restores for both databases remain unverified.
- Media bucket total object count/bytes, full historical manifest and complete restore are unknown. The verified 29-image batch is not a complete archive.
- Actual bot/token equality, app identities across all seven services, runtime flag values and privileged intent approvals remain unknown.
- The existing News Forum cleanup service has a crashed latest deployment and a pre-existing three-change staged patch to remove its obsolete five-minute cron/disable its retired target. That patch was not accepted, discarded or modified.

## Cloudflare Free lifecycle constraint

- DO Free has 13,000 GB-s/day, 100,000 requests/day and 5 GB SQLite storage; its allocation is billed at 128 MB even if actual memory use is lower. D1 Free has 5 million row reads/day, 100,000 row writes/day and 5 GB storage.
- Outbound WebSockets do not use Durable Object WebSocket Hibernation. A continuously active 128 MB DO for 24 hours is approximately 11,059 GB-s/day, around 85% of the 13,000 GB-s allowance before any other work. This is an estimate, not measured consumption or proof of viable headroom.
- A 24-hour quota/lifecycle soak is mandatory. If Free quota cannot safely support the real workload, do not add a payment method or turn on paid overage; retain Railway rollback and choose another verified no-card architecture.

## Scheduler, scope and safety controls

- Existing Railway business schedules remain unchanged and are recorded in `docs/RAILWAY_INVENTORY.md`.
- No new Cron Trigger, alarm-based maintenance process, repair scheduler, keepalive, recurring automation or health-ping loop was created. Gateway heartbeat/reconnect deadlines use only the single coordinator alarm.
- No production Railway service/configuration/variable/volume/bucket/database/deployment changed.
- No Discord channels, roles, messages, commands, bot settings or Gateway processes changed.
- No other Discord community accessed.
- The existing Railway deployment state remains the production rollback.

## Exact next execution step

Port the remaining six feature handlers behind the registry, beginning with immediate interaction ACK/defer/modal behavior and transient token decryption. Test retries, FIFO ordering, duplicate side effects, and restart recovery. Keep the Gateway disabled: the one tested Engagement adapter does not provide parity or acknowledge application interactions. Do not provision Cloudflare until the owner verifies a no-card Free account. In parallel, continue read-only backup/restore evidence collection for both PostgreSQL databases and the full original-media bucket.


## Recovery checkpoint — 2026-11-18 (candidate branch only)

- **Project/component:** Dawn Dotta / Momentum Movement; isolated Cloudflare migration candidate, branch `infra/cloudflare-free-migration`.
- **Completed:** owner-only Bot 005 `/forum-admin thread` read-only adapter. It verifies the selected same-guild public forum thread and parent forum, returns title/archive/lock/applied-tag metadata, and does not read thread messages or mutate Discord state. Capability flag remains default-off.
- **Tests/verified result:** GitHub Actions run `44283770344` for head `a48f3be18772b24edc2dd5943422c0acd8b941a0` completed successfully on 2026-11-18; syntax checks and 289 tests passed. Coverage is mocked; this does not verify Cloudflare deployment or live Discord behavior.
- **Changes implemented:** thread handler, Gateway registry/ACK routing, coordinator wiring, default-off flag, focused mocked and capability tests, README documentation.
- **Remaining objectives:** remaining Bot 005 command handlers and interactions; OAuth archive/checksum and independent restore; Cloudflare Free/no-card account and runtime validation; runtime quotas/soak; command and Gateway parity; rollback proof; production cutover. Current production remains Railway; cutover remains 0%.
- **Blockers:** local execution environment reports “No usable execution environment is available,” preventing local inspection, tests, and syncing this checkpoint to the Library file. No attempt was made to provision Cloudflare, access credentials, modify production, or contact Discord.
- **Scheduled processes:** no new automation or scheduler created; candidate config has no Cron Trigger.
- **Dependencies/user actions:** eventual Cloudflare owner sign-in to confirm Free/no-card eligibility; secure access to OAuth archive/checksum and an isolated restore destination. Neither is needed for the next source-only candidate cycle.
- **Last verified state:** branch head `a48f3be18772b24edc2dd5943422c0acd8b941a0`; CI run `44283770344` successful; all candidate capability flags remain false.
- **Exact next execution step:** inspect source and existing test patterns for the next recovered owner-only `/forum-admin rename` subcommand; implement it behind a separate default-off flag with strict same-guild/thread checks and precondition/postcondition verification; run hosted CI and inspect actual results. Keep Discord and production untouched.
