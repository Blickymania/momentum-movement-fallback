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

## Backup verification detail

On 2026-11-13, the existing `Postgres Daily Backup` job's logs reported a successful dump upload:
- timestamp: `20261113T090920Z`
- dump size: `31806` bytes
- SHA-256 was calculated and recorded
- remote object size was checked against the local dump size
- `pg_restore --list` returned a non-empty archive listing before upload

The job uses one `PGHOST` / `PGDATABASE` target. Its target value was not inspected, so this proves one configured PostgreSQL target was backed up, not that both PostgreSQL services were backed up. The separate OAuth PostgreSQL backup remains unverified. The daily job itself remains in Railway and was not modified.

## Known issue

`Dawn Dotta News Forum 24h Retention Cleanup` fails with Discord API 404 `Unknown Channel`. The configured forum is retired. Railway currently has a staged patch that removes its five-minute schedule and changes its source to a disabled notice. That patch was inspected but not committed during this recovery.

## Runtime classification for migration

A source review identified five distinct long-running Discord Gateway clients. These need a persistent process host; they are not suitable for a direct one-to-one move to short-lived serverless functions:

- `Dawn Dotta LIVE & Events Listener` — Bun + `discord.js`, with a local readiness endpoint.
- `LIVE NOW V2 - Shadow Engine` — Bun + `discord.js`, `tiktok-live-connector` and `sharp`.
- `Momentum Movement Discord Engagement Engine` — Bun + `discord.js`, writes its ledger to the mounted `/data` volume.
- `Momentum Movement Gift Assist` — Bun + `discord.js`, plus payment webhook/API handling.
- `Dawn Dotta TikTok Fan Club Level-Up Management` — Bun + `discord.js`, with `sharp`, `ffmpeg-static` and filesystem processing.

The `Dawn Dotta Discord Manager` is different: it is a Bun HTTP/MCP service using `Bun.serve` and Bun's SQL client for OAuth tables, with Discord REST calls. It is not itself a Discord Gateway client. Moving it to Cloudflare Workers would require an intentional port of the Bun server and SQL adapter; it is not a copy-and-paste deployment.

Other functions are predominantly REST calls, scheduled jobs, media/object-storage operations or HTTP endpoints. They can be consolidated into a smaller set of scheduled dispatchers and APIs after their state and idempotency requirements are mapped. Do not create 31 replacement instances just because 31 source files exist.

## Hosting options assessed against the actual code

- **Neon Free** is a strong no-card database/object-storage candidate: free permanently, 100 CU-hours per project monthly, 1 GB Postgres storage per project and 5 GB object storage per project. Idle database compute scales to zero after five minutes; it wakes on query. When monthly compute or transfer limits are reached, compute is suspended until the next period. Confirm both source database sizes and use before migration. The existing Railway object bucket must be measured before assuming it fits in 5 GB.
- **Cloudflare Workers Free** is suitable for lightweight request-driven APIs and a single cron dispatcher, not for copying the five existing `discord.js` Gateway processes unchanged. The Free plan lists 100,000 requests/day, 10 ms CPU/invocation, 128 MB memory and at most five Cron Triggers per account. Keep long-lived bot clients on a persistent process runtime.
- **Botkeep** advertises Bun, 24/7/no manual renewal and no card, but Free currently allows one workload slot with 512 MB RAM shared-account capacity and its beta has no uptime SLA. It is a candidate for a controlled compatibility/load test, not an assumed production guarantee.
- **Enzonic Node.js hosting** advertises one always-on free Node server per account, 512 MB RAM, 50% CPU and 10 GB storage without a card. It supports Node 18/20/22, not the existing Bun runtime, so the gateway code would need a Node-port and regression tests.
- **Silly Development** supports Bun and Discord Gateway connections but its free server is 256 MB RAM / 512 MB disk; its terms provide no availability guarantee and permit suspension of free service. This is not a sole production dependency.
- **HOKAS** supports Bun and advertises three 256 MB slots, but its free uptime allowance is extended by watching ads; it is not fully hands-off always-on hosting.
- **GitLab Free** can mirror source, but its shared CI runner minutes require a payment card; do not rely on shared runners under the no-card constraint.

The practical target is a hybrid: Neon for eligible persistent data, Cloudflare for light HTTP/webhook/cron work after porting, and one or more persistent runtimes for the actual Gateway clients. The current free no-card runtimes are small and/or have no SLA; there is no verified free no-card host that can safely be assumed to replace Railway's 34-service production footprint intact.

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
