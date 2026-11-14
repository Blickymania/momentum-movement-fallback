# Momentum Movement — persistent execution checkpoint

**Scope lock:** Dawn Dotta / Momentum Movement only. Do not inspect or modify Empress Reigns, Blickymania, BestYouEvaHad, or Red Kocaine.

**Checkpoint timestamp:** 2026-11-13 (session continuation)
**Authorized Railway project:** `Dawn Dotta / Momentum Movement`
**Railway project ID:** `a1d6b0e4-3169-4c5d-add3-84a70f7dc525`
**Production environment ID:** `c72ea3d9-2c1c-4651-a265-79723e317fa5`
**Authorized Discord guild:** `1565048205970767992`
**Recovery repository:** `Blickymania/momentum-movement-fallback`
**Recovery branch:** `recovery/dawn-dotta-backend-2026-11-13`
**Active checklist:** [GitHub issue #1](https://github.com/Blickymania/momentum-movement-fallback/issues/1)

## Last verified production state

- Dawn Dotta Discord Manager is connected; bot identity and guild identity match.
- Read-only Discord audit passed with zero warnings.
- Production LIVE & Events Listener is online with one running replica; latest deployment SUCCESS; no recent failures.
- Railway environment inventory contains 34 services, 5 persistent volumes, 2 PostgreSQL services, and the `dawn-dotta-photo-originals` bucket.
- The production listener and manager have not been modified by this failover work.
- Railway returned: **“Your trial has expired. Please select a plan to continue using Railway.”** Redeploy of the read-only Role Monitor was therefore blocked. Do not attempt to bypass billing or provision paid usage.

## Completed work

### Listener failover foundation
- Added Cloudflare SQLite Durable Object lease coordinator reference implementation.
- Added monotonic fencing tokens, lease acquire/renew/check/release, and stale-owner rejection.
- Added listener LeaseClient with heartbeat, local safety deadline, fail-closed API gating, abort signal on lease loss, and graceful release.
- Added isolated lease-gated listener build at `failover/listener/index.tsx`; it remains disconnected while standby and does not change the root production snapshot.
- Added `.env.example` with placeholders only; no credentials committed.
- Added tests: 7 lease-state, 6 lease-client, 1 static listener-wiring, and 4 worker security/readiness checks (18 defined total).
- Previous checkpoint recorded 13 state/client tests as passing; this session did not independently rerun them. Do not claim all 18 passed.
- Added event-driven GitHub Actions workflow `.github/workflows/dawn-dotta-failover-tests.yml`.
- Added manual-only Cloudflare deployment workflow `.github/workflows/deploy-dawn-dotta-lease.yml`; it runs all tests before deployment and requires repository Actions secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `LEASE_CONTROL_TOKEN`. It deploys code and the lease secret together through a temporary protected secrets file and Wrangler `--secrets-file`.
- Added `secrets.required: [LEASE_CONTROL_TOKEN]` to Wrangler config so a deployment without the lease secret fails closed.
- Added provider-specific listener deployment instructions in `failover/listener/DEPLOYMENT.md`; both hosts must remain `LISTENER_RUNTIME_ACTIVE=false` until the old Railway listener is stopped.
- Public verification returned 404 for repository/workflow/commit, consistent with private/inaccessible repository; this does not establish whether the workflow ran. CI status remains unverified.

### Production diagnostics
- Discord manager audit and identity verification passed.
- The original media vault backup worker ran against 3 configured forums (3 valid, 0 skipped), reported 26 source items and 0 deletions, and logged reuse/readback verification. A full restore drill is still outstanding.
- The Postgres Daily Backup job logged successful backup objects on 2026-11-11, 2026-11-12, and 2026-11-13. The latest log reported 31,806 bytes, SHA-256, remote object-size check, and successful `pg_restore --list`. Its configured PG connection variables cover one database only; do not claim the separate OAuth PostgreSQL database is backed up.
- The Role Monitor's current configured source is read-only and normalizes the actual `🛡️ Moderators` role name. Actual server categories do not include a Level 50 Lounge category; the Level 50 access role exists and the level-50 voice counter is under Community Stats. Runtime logs still show older expectations (singular Moderator and Level 50 Lounge category), so runtime/config drift is suspected. No Discord role or category was changed.
- The project has 15 existing cron-scheduled services with distinct feature purposes. No new cron or recurring repair task was created.

## Provider terms verified from first-party sources

- **Botkeep primary candidate:** new-signup Free tier provides one workload slot, 512 MB RAM, 50% shared CPU (0.5 vCore), 1 GB storage, Bun, continuous runtime, no manual renewal, and explicitly no credit card. The provider describes the offer as beta and says it has no uptime SLA.
- **Silly Development standby candidate:** Free tier provides Bun, 256 MB RAM, 25% CPU, 512 MB disk, no card, no trial, and no expiry/renewal. Its acceptable-use policy prohibits using the service as file storage, a media server, or CDN; only use it for the standby listener. The exact free-server count per account must be verified in the account panel; never create extra accounts to stack capacity.
- **Cloudflare coordinator:** Workers Free is the default plan; SQLite-backed Durable Objects are supported on Free. Published limits include 100,000 DO requests/day, 13,000 GB-s/day, 100,000 SQL rows written/day, and 5 GB SQL storage. Free-plan operations fail when a limit is exceeded; do not enable paid Workers or paid overages. The account signup/payment-method prompt was not independently verified; if a card or paid subscription is demanded to enable the required Free feature, stop.
- First-party references: [Botkeep](https://botkeep.cloud/), [Botkeep FAQ](https://botkeep.cloud/faq), [Silly Development terms](https://sillydev.co.uk/terms), [Silly Development acceptable-use policy](https://sillydev.co.uk/acceptable-use), [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Active failures and blockers

### Retired News Forum cleanup worker
- Service: `Dawn Dotta News Forum 24h Retention Cleanup`
- Service ID: `23249d7e-6ced-438d-aae2-a82947aa23bd`
- Its target forum `1567969466686513222` returns Discord 404 / Unknown Channel (code 10003). Runtime logs confirm this root cause.
- A 3-change Railway patch is staged and verified non-destructive: remove the obsolete 5-minute cron schedule, retain restart policy `NEVER`, and replace the old cleanup script with a harmless no-op. It does not delete Discord content.
- The patch has not been deployed. Railway deployment is currently blocked by expired trial. The Railway `accept_deploy` action also requires explicit deployment authorization for the staged environment patch; do not bypass that safeguard.

### Independent failover
- Cloudflare coordinator is not deployed.
- Botkeep primary and Silly Development standby are candidates only; no host has been provisioned or verified.
- No live two-instance or Gateway failover test has been performed.
- Do not activate a new listener while the existing unleased Railway listener is connected. Cutover requires stopping the old listener first; rollback requires stopping both new hosts before restarting Railway.
- Current Railway trial expiration means Railway cannot be treated as an available deployment target without a billing-plan change. Prefer the no-card independent path; never add a card or incur paid usage without user direction.

### Data protection
- Only one PostgreSQL database has a verified daily backup chain. OAuth PostgreSQL backup coverage remains unverified.
- Persistent volume backup coverage and a restore drill for the media bucket remain unverified.
- Do not migrate, delete, or overwrite production data until independent backups and restore tests are complete.

## Exact next execution steps

1. Add the three required GitHub Actions secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `LEASE_CONTROL_TOKEN`) and manually run `.github/workflows/deploy-dawn-dotta-lease.yml`; verify the returned Worker URL and `/health` endpoint. For the first deploy, Cloudflare requires Workers Admin scoped only to the Workers product; rotate the API token to Workers Editor scoped to this Worker afterward. The connected Railway app redacts existing variable values, so do not copy or expose them in chat.
2. Revalidate current no-card Botkeep and Silly Development terms/availability; provision only if free eligibility and persistent runtime are confirmed.
3. Run the GitHub failover tests in an authenticated repository context; record the actual workflow run and test counts. Do not mark CI passed based on file creation.
4. Inspect backup-service configuration and determine whether the existing single scheduled Postgres backup can safely cover both PostgreSQL services without adding a second scheduler.
5. Complete persistent-volume and media-bucket inventory/restore validation.
6. Resolve the retired News Forum cleanup service only after the Railway deployment restriction is resolved or an authorized alternate deployment path exists.
7. Resolve Role Monitor runtime/config drift without changing Discord roles or categories; redeploy only when a permitted deployment path is available.
8. Continue focused integration tests, repair, revalidation, and checkpointing. Keep the existing production listener unchanged until failover and rollback are proven.

## Scheduler control

Reuse existing purpose-specific schedulers. Do not add a second centralized maintenance/recovery scheduler, duplicate cron jobs, or periodic reminders. Prefer immediate/event-driven recovery.
