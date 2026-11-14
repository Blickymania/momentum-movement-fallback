# Momentum Movement — backup coverage inventory

**Scope:** Dawn Dotta / Momentum Movement only.
**Last inspected:** 2026-11-13 session continuation.
**Purpose:** Identify verified recovery points without changing production data or creating another scheduler.

## PostgreSQL services

| Service | Service ID | Current evidence | Status |
|---|---|---|---|
| Postgres | `d5518d22-50d0-455e-b2f0-6cc67caaa9fe` | A daily backup job has one configured PG connection set and logs successful dump objects with size, SHA-256, object-size verification, and `pg_restore --list` validation | One of the two DB targets is covered, but the exact connection-to-service mapping still needs confirmation |
| OAuth PostgreSQL | `3e71f6b5-a248-40b6-b185-a748a5f5b436` | Separate database service and persistent volume; no second PG target is present in the backup worker's variable names | Backup coverage not verified |

The existing `Postgres Daily Backup` service has one set of `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` variables and a single daily cron. Its latest verified log reported 31,806 bytes, SHA-256, remote object-size check, and successful `pg_restore --list`. Successful archive listing is not a full restore test.

Do not create a second daily backup scheduler. The intended repair is to extend the existing backup job to include both database targets in one run after the target variable references are verified.

## Persistent-volume inventory

| Volume | Attached service | Mount path | Backup status |
|---|---|---|---|
| `dawn-tiktok-campaign-ledger` | TikTok Campaign Intelligence & Publisher | `/data` | No independent backup/restore evidence inspected |
| `momentum-discord-engagement-ledger` | Momentum Movement Discord Engagement Engine | `/data` | No independent backup/restore evidence inspected |
| `Member Lifecycle History` | Member Lifecycle Management | `/data` | No independent backup/restore evidence inspected |
| `postgres-volume` | Postgres | `/var/lib/postgresql/data` | Depends on the verified PG dump target; mapping and restore test outstanding |
| `OAuth PostgreSQL Data` | OAuth PostgreSQL | `/var/lib/postgresql/data` | Backup coverage not verified |

The Railway connector exposes volume create/update/delete operations but no volume snapshot/restore operation in the available toolset. Do not detach, move, resize, or delete any production volume as a backup experiment.

## Original media bucket

- Bucket: `dawn-dotta-photo-originals`
- Existing media-vault worker logs: 3 configured forums, 3 valid, 0 skipped, 26 source items, 0 deletions.
- Logs show existing-object reuse/readback verification, but this does not prove the bucket contains every original source object or that a complete restore works.
- Required next validation: enumerate object keys/counts/total bytes, compare against source inventory, record checksums, then restore a representative sample to a separate test prefix without overwriting originals.
- Never use Botkeep or Silly Development as media/file storage; Silly Development's acceptable-use policy explicitly prohibits file-storage/media-server/CDN use.

## Safe next actions

1. Determine which PostgreSQL service the existing backup worker references, without exposing password values.
2. Add a second OAuth PostgreSQL target to that same worker only after the reference variable names and permissions are verified.
3. Run both dumps in one existing scheduled job; require `pg_restore --list`, SHA-256, remote size verification, and explicit per-target success/failure logs.
4. Plan application-level export endpoints for the three non-Postgres `/data` volumes, then have one central recovery process collect those exports; do not add per-service cron jobs.
5. Inventory the media bucket and perform a non-destructive restore drill.
6. Do not mark backup coverage complete until every database/volume/object set has a tested restore path.

## Current blocker

Railway reports its trial has expired and redeploys are unavailable. The existing daily backup worker and production volumes remain untouched. No new scheduler, volume, or backup service has been created.
