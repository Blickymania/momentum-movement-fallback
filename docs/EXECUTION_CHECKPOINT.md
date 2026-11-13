# Momentum Movement execution checkpoint

**Checkpoint date:** 2026-11-13  
**Project:** Dawn Dotta / Momentum Movement only  
**Repository:** `Blickymania/momentum-movement-fallback`  
**Working branch:** `infra/cloudflare-free-migration`  
**Railway project:** `a1d6b0e4-3169-4c5d-add3-84a70f7dc525`  
**Railway production environment:** `c72ea3d9-2c1c-4651-a265-79723e317fa5`  
**Discord guild/application:** `1565048205970767992` / `1565304619838742598`

## Current phase

- **Phase 1 — Inventory and source recovery:** COMPLETE for all recoverable Railway Function source.
- **Phase 2 — Portable HTTP/MCP and OAuth code:** IMPLEMENTED and locally tested; platform deployment remains blocked by Cloudflare account access.
- **Phase 3 — Gateway supervisor, data migration, media and scheduler:** IN PROGRESS / NOT DEPLOYED.
- **Production cutover:** NOT STARTED.

## Completed work in this checkpoint

### Source recovery and infrastructure inventory

- Verified the authorized Railway project and production environment.
- Recovered 29 Railway Function source snapshots into `recovered/railway/functions/`, plus the recovered manager, LIVE & Events listener, decoded Bot 005, and existing Postgres backup command.
- Verified Bot 005's decoded guild/application constants match Momentum Movement. No secret values were copied or committed.
- Inspected 34 Railway services, 5 persistent volumes, 2 PostgreSQL services and 1 original-media bucket.
- Inspected manager's direct variable names without exposing values. The direct manager variables did not include Cloudflare credentials.
- Confirmed the main Postgres Daily Backup completed on Nov 13 2026: 31,806 bytes, remote object-size validation, and non-empty `pg_restore --list`. This is not a full restore test and does not establish coverage of the OAuth database or media originals.
- The manager's read-only Discord status/audit previously passed. No Discord content or configuration has been changed by this migration.

### Worker and manager implementation

- `src/worker.mjs`: isolated Workers entry for HTTP/MCP, health/readiness and OAuth routing.
- `src/manager-core.mjs`: extracted manager behavior with fixed Momentum guild/application scope and safe REST access.
- `src/oauth-routes.mjs`: dynamic client registration, exact redirect allowlisting, OAuth state, S256 PKCE, Discord owner/admin membership verification, one-time code exchange, refresh rotation, revocation and bearer authentication.
- `src/oauth-d1-store.mjs`: D1 adapter with hashed tokens, conditional one-time row claims, nonce-bound inserts, transactional authorization-code exchange/refresh rotation and revocation.
- `migrations/0001_oauth_schema.sql`: versioned SQLite/D1 OAuth schema.
- `wrangler.toml.example`: no-secret deployment example with placeholder D1 ID, OAuth disabled by default and no Cron Trigger.
- `package.json`: Node 22+ test and syntax-check scripts. Local test execution used direct Node commands because `npm` is not installed in the isolated test runner.

### Gateway protocol and inbox implementation

- `src/gateway-protocol.mjs`: side-effect-free Discord Gateway v10 frame parsing, Identify/Resume/Heartbeat payloads, Hello decisions, close-code handling, bounded equal-jitter reconnect backoff and session/sequence-based idempotency keys.
- `src/durable-gateway-inbox.mjs`: bounded transactional inbox with atomic sequence persistence, duplicate/replay rejection, event/byte ceilings, idempotent acknowledgements and monotonic FIFO queue order.
- Inbox reads paginate through the bounded durable queue before sorting, so a lexicographically ordered storage page cannot reorder events across pages.
- This is not yet a complete Gateway socket supervisor. No Cloudflare Durable Object Gateway connection has been created or deployed.

### Verification

**Latest combined regression:** 62 tests passed, 0 failed, 0 skipped.  
**Syntax verification:** all 6 source modules and all 5 test files passed Node `--check`.

Test suites cover:

- Gateway protocol decisions and recovery.
- Durable inbox session state, ordering, deduplication, bounded capacity, acknowledgements and 1,200-event multi-page ordering.
- D1-compatible SQLite OAuth schema, single-use login/code semantics, concurrent code redemption, PKCE/client/resource binding, access-token auth, refresh rotation and revocation.
- OAuth HTTP registration, Discord admin callback, PKCE code exchange, token rotation, authorization failure, storage-unavailable behavior and health.
- Worker fixed identity, D1 binding checks, readiness, bearer auth, MCP discovery/tool calls, read/write scope and OAuth feature flag.

These are isolated Node/SQLite tests. They do not prove Cloudflare D1 service behavior, an actual Workers deployment, outbound WebSocket lifecycle, live Discord OAuth, or a 24-hour Gateway connection.

## Outstanding objectives

1. **Cloudflare account access:** the connected browser was verified signed out at `https://dash.cloudflare.com/login`. The owner must sign in and confirm Workers Free, SQLite Durable Objects and D1 are available without entering a payment method. No Cloudflare account, plan or API authorization is currently verified.
2. **Finish Gateway identity mapping:** include the original LIVE & Events Listener in the source audit, enumerate all Gateway clients, bot/application identities, intent requirements, handler side effects and duplicate consumers. Secret values have not been inspected or compared; identical variable names do not prove identical bot tokens.
3. **Gateway supervisor:** design one Durable Object supervisor per verified bot identity with lease/fencing, outbound WebSocket lifecycle, heartbeat/ACK timeout, identify/resume, invalid-session handling, durable inbox dispatch, bounded backoff and dead-letter/error handling. Test with a separate non-production Discord application before any production token.
4. **Gateway runtime acceptance:** after Cloudflare Free access, prove heartbeat/ACK, restart/eviction, reconnect/resume, durable queue delivery, no duplicate writes and quota-exhaustion recovery. The 24-hour soak is still outstanding. Cloudflare outbound WebSockets do not use hibernation; runtime lifecycle must be measured, not assumed.
5. **Database and media audit:** safely determine schema, size, row counts and backup coverage for both PostgreSQL databases; validate a full isolated restore; inventory all original media objects, total bytes and checksums. Existing primary backup log alone is insufficient.
6. **Scheduler consolidation:** preserve all current business schedules while mapping them to one centralized dispatcher only at cutover. No new scheduler or Cron Trigger is permitted during preparation.
7. **Feature parity, shadow run and rollback:** compare every migrated feature family against Railway, test permissions and side effects, prevent overlapping old/new consumers, rehearse rollback, and only then cut over in controlled stages.

## Active infrastructure blockers and untouched state

- Cloudflare dashboard is signed out; no Cloudflare account/Free plan or resources can be verified.
- Render has no workspace selected; no Render workspace/resource was chosen.
- Railway tools exposed no direct SQL query/restore path during this audit; database size/schema and full restore remain unverified.
- One Railway service, `Dawn Dotta News Forum 24h Retention Cleanup`, has a crashed latest deployment while a three-change patch is already staged to disable its retired target and remove its old 5-minute cron. That prior patch has not been accepted, discarded or modified.
- No production Railway service/configuration/variable/volume/bucket/database/deployment was changed.
- No Discord channel, role, message, command, bot setting or Gateway process was changed.
- No new scheduler, cron, recurring automation, keepalive or repair loop was created.
- No other Discord community was accessed.

## Exact next execution step

Audit the original `index.tsx` LIVE & Events listener and reconcile it with the six Gateway clients already documented in `docs/GATEWAY_AUDIT.md`. Update the gateway inventory with a full source-by-source mapping of app ID checks, intents, message/interaction handlers and environment requirements. In parallel, continue read-only inspection of the two PostgreSQL service configurations and media bucket metadata; do not read or print secrets. Do not create a Cloudflare resource or touch production until the owner signs in to a verified no-card Free account and the migration gates are satisfied.
