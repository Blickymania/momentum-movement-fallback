# Dawn Dotta / Momentum Movement — recovery inventory

Inventory date: 2026-11-13
Scope: Dawn Dotta's Railway project only.

## Recovery status

- 31 deployed Bun function sources were read from the current deployed Railway source and committed to this branch.
- One additional file preserves the staged version of the retired News Forum cleanup function. Its deployed version is also preserved.
- The original `index.tsx` at the repository root remains unchanged. It is the earlier LIVE & Events Listener recovery snapshot and matches the deployed Railway function byte-for-byte at the time checked.
- Source snapshots are not a working failover deployment. No replacement host has been deployed or connected.
- `main` and the production Railway environment were not changed by this recovery backup.
- Secret values, bot credentials, database passwords, OAuth client secrets, API keys and object-storage credentials were not read or committed.

## Recovered files

The 31 deployed sources plus the extra staged cleanup snapshot are:

- `recovered-functions/1-on-1-coaching-interaction-relay.ts`
- `recovered-functions/1-on-1-coaching-reminder-worker.ts`
- `recovered-functions/1-on-1-coaching-workflow.ts`
- `recovered-functions/blickymania-bot-005.ts`
- `recovered-functions/coaching-activity-frontend.ts`
- `recovered-functions/coaching-platform-api.ts`
- `recovered-functions/dawn-dotta-community-stats-sync.ts`
- `recovered-functions/dawn-dotta-content-dashboard-parity.ts`
- `recovered-functions/dawn-dotta-discord-manager.ts`
- `recovered-functions/dawn-dotta-event-media-publisher.ts`
- `recovered-functions/dawn-dotta-gallery-discovery-engine.ts`
- `recovered-functions/dawn-dotta-gallery-safety-preflight.ts`
- `recovered-functions/dawn-dotta-live-events-listener.ts`
- `recovered-functions/dawn-dotta-news-forum-24h-retention-cleanup.staged.ts`
- `recovered-functions/dawn-dotta-news-forum-24h-retention-cleanup.ts`
- `recovered-functions/dawn-dotta-official-social-directory-sync.ts`
- `recovered-functions/dawn-dotta-original-media-vault-backup.ts`
- `recovered-functions/dawn-dotta-social-owner-console.ts`
- `recovered-functions/dawn-dotta-superseded-post-cleaner.ts`
- `recovered-functions/dawn-dotta-tiktok-fan-club-level-up-management.ts`
- `recovered-functions/dawn-dotta-tiktok-live-status-monitor.ts`
- `recovered-functions/live-now-v2-shadow-engine.ts`
- `recovered-functions/member-lifecycle-management.ts`
- `recovered-functions/momentum-movement-core-shadow.ts`
- `recovered-functions/momentum-movement-discord-engagement-engine.ts`
- `recovered-functions/momentum-movement-gift-assist.ts`
- `recovered-functions/momentum-movement-logo-gateway.ts`
- `recovered-functions/momentum-movement-role-monitor.ts`
- `recovered-functions/oauth-database-diagnostic-function-temp.ts`
- `recovered-functions/social-link-health-audit.ts`
- `recovered-functions/tiktok-campaign-intelligence-publisher.ts`
- `recovered-functions/uniform-36-command-extension.ts`

## Current production resources observed

- 34 Railway services total.
- 31 Bun function services.
- Two PostgreSQL database services:
  - `OAuth PostgreSQL` with a 1 GB persistent volume.
  - `Postgres` with a 5 GB persistent volume.
- One `Postgres Daily Backup` job, last deployment reported successful; configured for daily execution and connected to S3-compatible storage.
- Additional persistent volumes:
  - `Member Lifecycle History` (1 GB)
  - `dawn-tiktok-campaign-ledger` (100 MB)
  - `momentum-discord-engagement-ledger` (100 MB)
- One S3-compatible object bucket: `dawn-dotta-photo-originals`.
- Database contents, volumes, bucket objects and provider secrets have NOT been exported or migrated.

## Known issue

`Dawn Dotta News Forum 24h Retention Cleanup` fails with Discord API 404 `Unknown Channel`. The configured forum is retired. Railway currently has a staged patch that removes its five-minute schedule and changes its source to a disabled notice. That patch was inspected but not committed during this recovery.

## Migration cautions

- The Discord Manager and listener currently run on Bun 1.4.4.
- The LIVE & Events Listener uses `discord.js@14.27.0` and holds a persistent Discord Gateway connection. It is not a Cloudflare Worker drop-in.
- The LIVE NOW shadow service uses `discord.js`, `tiktok-live-connector` and `sharp`.
- The media, gallery and fan-club services use additional native or filesystem dependencies. Validate them individually on any new runtime.
- The existing Discord Manager source includes Railway-specific health/status wording and a `RAILWAY_SERVICE_KEY` variable name. Its OAuth and manager behavior needs a provider-neutral deployment review before moving.
- A safe migration must separately export and verify both Postgres databases, all five volumes' required data, the media bucket, and provider environment variables. Do not paste secrets into GitHub.
- Keep the current production project intact until the replacement is deployed, tested and can be rolled back.

## Next steps

1. Export database dumps and persistent files/bucket objects to an independent backup.
2. Choose and verify a no-card persistent Bun host with capacity appropriate for the manager and Gateway listeners.
3. Design a small number of consolidated workloads; do not assume 31 Railway functions map one-for-one to a free host.
4. Add single-instance lease/fencing for Gateway listeners and idempotent event handling.
5. Migrate the OAuth/manager endpoint and test Discord authentication, commands, event delivery, scheduled jobs and media flows.
6. Only then switch production traffic and retain Railway as an optional rollback/deployment target.
