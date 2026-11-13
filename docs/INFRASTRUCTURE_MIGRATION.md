# Momentum Movement infrastructure migration

**Scope:** Dawn Dotta / Momentum Movement only.  
**Branch:** `infra/cloudflare-free-migration`  
**Execution mode:** preserve production, recover source, port and test in isolation, cut over only after verified rollback.

## Hard requirements

- No debit or credit card; no paid trial, expiring promotional credit, automatic paid overage, paid plan, or paid product.
- Free usage must have published daily or monthly resets. At quota exhaustion, work must pause or queue until reset—not upgrade, bill, or silently skip.
- Cloud-hosted, not dependent on the owner's computer.
- Preserve every approved Discord feature, channel, listener, workflow, database, media original and existing bot identity.
- No production cutover until the replacement is running, functionally tested, and has a rehearsed rollback.
- Only inspect and operate resources belonging to the verified Dawn Dotta / Momentum Movement project.
- Do not add a second scheduler, duplicate listener, duplicate repair loop, or overlapping recovery service.

## Verified source and production state

The authorized Railway project is **Dawn Dotta / Momentum Movement**, production environment, ID `c72ea3d9-2c1c-4651-a265-79723e317fa5`.

- 34 services, 5 persistent volumes, 2 PostgreSQL services and 1 original-media bucket.
- 29 Railway Function source snapshots recovered into `recovered/railway/functions/`.
- The manager's deployed source, LIVE & Events Listener source, Bot 005 decoded source, and Postgres daily-backup command are separately preserved.
- The recovered LIVE & Events Listener and multiple other gateway services use Bun / discord.js. They are not Workers-compatible as-is.
- Six separate source snapshots contain Discord Gateway client/login logic: Bot 005, Social Owner Console, Fan Club Level-Up Management, LIVE NOW V2 Shadow Engine, Discord Engagement Engine, and Gift Assist. Their intents, token identities, and event responsibilities must be reconciled before consolidation. Do not assume that one connection can replace all six without a feature-by-feature mapping.
- The primary Discord Manager is Bun 1.4.4, exposes HTTP/MCP endpoints, checks bot and guild identity, and uses PostgreSQL-backed OAuth. Its OAuth implementation currently depends on Bun's SQL client and PostgreSQL-specific transactions, indexes, `now()`, `to_regclass`, `FOR UPDATE`, and positional `$n` parameters.
- The current manager's direct Railway environment-variable listing did not contain Cloudflare account credentials. The project environment inventory exposed shared variable *names* `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; their values and account ownership/validity have not been inspected.
- The browser session is signed out of Cloudflare; the Cloudflare dashboard shows the sign-in page. No Cloudflare account or plan was verified and no Cloudflare resource was created.
- The Render integration has no workspace selected. It cannot be used to provision or inspect a Render resource until the owner selects the intended workspace; do not choose one automatically.
- A production health scan found one service issue: the retired News Forum 24h Retention Cleanup deployment is crashed while a three-change Railway patch is already staged to remove its old 5-minute cron and disable the retired target. That patch was left untouched.
- The other 33 services were not returned as failed by the latest 168-hour environment health scan.
- The existing Postgres Daily Backup service completed successfully on Nov 13, 2026. Its 31,806-byte dump had a remote-size check and a non-empty `pg_restore --list` check. This does **not** prove a full restore, does not establish that both PostgreSQL databases are backed up, and does not establish that the media bucket is fully backed up.

## Free-first architecture candidate

### Cloudflare Workers Free + SQLite-backed Durable Objects + D1

Use a dedicated Cloudflare Free account for Momentum Movement, if the owner can sign in without adding a payment method.

- **Workers Free:** HTTP/MCP manager, OAuth endpoints, Discord interaction/webhook endpoints, API façade, and one centralized scheduler for the existing timed workflows.
- **SQLite-backed Durable Objects:** lease fencing, coordination, durable inbox/outbox, and one Gateway supervisor per reconciled bot identity.
- **D1:** relational state only after schemas, data sizes, access patterns and migration costs are mapped. Do not replace either existing PostgreSQL database blindly.
- **KV:** non-authoritative small configuration/cache only.
- **Object/media storage:** do not provision Cloudflare R2 unless no-card activation and overage behavior are proven. Backblaze B2 is a candidate for a separate no-card archive path; its free 10 GB storage ceiling must be enforced locally, with no paid overage.

Current official published free allowances (verify again at provisioning):
- Workers Free: 100,000 requests/day, 10 ms CPU/request, 128 MB isolate memory, 50 subrequests/request, and at most 5 Cron Triggers per account.
- SQLite Durable Objects on Workers Free: 100,000 requests/day and 13,000 GB-seconds/day. Free quota is hard-limited and resets at 00:00 UTC; exceeded DO operation types fail instead of automatically becoming paid usage.
- Durable Object free request billing includes WebSocket messages; incoming WebSocket messages use a 20:1 ratio for request billing. Outgoing WebSocket messages and incoming WebSocket protocol pings are not charged as requests.
- D1 Free: 5 million rows read/day, 100,000 rows written/day, 5 GB total storage. Daily row-limit exhaustion causes queries to fail until midnight UTC; stored data remains intact.
- No paid plan, paid add-on, paid overage, or billing method will be enabled.

### Discord Gateway feasibility gate

Cloudflare Durable Objects can create outbound WebSocket client connections. However, only server-side Durable Object WebSockets support hibernation. Outbound WebSockets do not hibernate. An active outbound connection prevents eviction for at most 15 minutes; after that normal eviction rules apply, even though the connection itself may remain open.

Discord Gateway heartbeats and ACKs arrive as WebSocket messages and may keep the object active, but this behavior is not accepted as production-safe until the actual implementation is tested across:
1. At least 24 hours of Gateway heartbeat/ACK cycles.
2. Runtime restart/update and connection interruption.
3. Discord reconnect and session resume using persisted session ID, sequence and resume URL.
4. Invalid-session responses and non-resumable close codes.
5. Duplicate dispatch handling and durable event acknowledgement.
6. Rate limits, quota exhaustion, log redaction and recovery after object eviction.

Use the standard outbound WebSocket client API in a Durable Object, not the inbound hibernation API. Store Gateway session data and the durable event inbox/outbox in persistent storage. A reconnect must use bounded backoff, idempotent event keys and one active lease/fencing token. Do not use a separate periodic keepalive or repair cron.

### Scheduler policy

- Do not create any new scheduled maintenance/recovery process during discovery or porting.
- Preserve the existing scheduled *business workflows* by inventorying their cadence and effect. During eventual cutover, replace the many provider-level schedules with no more than one centralized project scheduler/Cron Trigger, dispatching jobs from a durable due-time registry.
- This single scheduler must not overlap with old Railway cron workers. The cutover must switch old schedules off only after replacement shadow tests and rollback preparation.
- Prefer event-triggered recovery and bounded in-process retries. No recurring repair, monitoring, or keepalive schedule may be added separately.
- Existing schedules are enumerated in `docs/RAILWAY_INVENTORY.md`; the retired News Forum schedule has a pre-existing staged removal patch and has not been accepted or changed.

## Database, files and backups

- Keep the two existing PostgreSQL data domains logically separate during migration until their schemas, size, extensions, foreign keys, stored routines, triggers, and backup coverage are understood.
- Convert the five OAuth tables and token/index logic to a tested D1/SQLite adapter only after PKCE concurrency and single-use token-code semantics are preserved.
- A database migration requires a schema comparison, row counts, deterministic export/import, checksums or per-table canonical digests, and a test restore. The existing 31.8 KB backup log is not a full restore test.
- Measure primary database, OAuth database and object-store size/object count without exposing secrets. Verify media checksums and byte-for-byte original retention before any switch.
- Keep original Railway databases, volumes, bucket objects and snapshots until after the replacement has passed the agreed soak period. No deletes, pauses or bucket lifecycle rules during preparation.

## Cutover sequence

1. Keep the verified 34-service inventory and recover each deployed source. Do not copy credentials or secret values into Git.
2. Map each Gateway client, bot ID, guild ID, intents, subscription and side effects; identify duplicate listeners and command ownership.
3. Audit both databases and all backup/restore coverage; inventory media objects and checksums; capture environment variable names and dependency references.
4. Obtain owner access to a Cloudflare Free account without entering a payment method. Verify that Workers Free, SQLite Durable Objects and D1 can be activated with no card.
5. Build and test the manager HTTP/MCP port, OAuth storage adapter, Gateway Durable Object and central dispatcher on this migration branch.
6. Run local protocol/unit tests and platform-specific test-bot tests; prove 24-hour Gateway stability and all existing scheduled workflow semantics.
7. Migrate data to isolated test resources; verify schema/row counts/checksums and conduct a restore test.
8. Shadow-run read-only and compare results; prevent duplicate writes from the old and new listeners.
9. Cut over one function family at a time, with single-active leases, readiness checks, usage ceilings and a rehearsed rollback to Railway.
10. Retain Railway production resources and backups until the full feature set passes the soak period. Do not remove infrastructure based on a successful deploy alone.

## Explicit non-actions

- No Railway service, variable, volume, bucket, database or deployment was changed.
- No Discord channel, role, message, command or bot setting was changed.
- No secret values were printed, copied, or committed.
- No Cloudflare account or Cloudflare resources were provisioned.
- No Render workspace or Render resource was selected or modified.
- No second scheduler or recurring automation was created.
- No other Discord community was accessed.
