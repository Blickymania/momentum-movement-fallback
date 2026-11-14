# Dawn Dotta / Momentum Movement — Hostless Free-Tier Deployment Plan

Updated: 2026-11-14

## Purpose and release boundary

This document replaces the earlier assumption that the free Hostless plan could provide six independent worker deployments. It records the provider's current worker model and the constraints observed in the user's Hostless app-creation wizard.

This is a source-only migration plan. It does not authorize or perform a Hostless app/worker creation, deployment, secret import, Discord Gateway login, Railway operation, or Discord role change.

## Verified Hostless product model

Current Hostless documentation:
- Apps: https://docs.hostless.cloud/app/overview
- Background workers: https://docs.hostless.cloud/app/workers
- `hostless.yaml`: https://docs.hostless.cloud/app/hostlessfile
- Deployments and rollbacks: https://docs.hostless.cloud/app/deployments

Hostless distinguishes:
- An **app**, which runs a long-lived HTTP service and must bind to `0.0.0.0:$PORT` and pass its configured health check.
- A **background worker**, which runs a long-lived process and does not serve web requests.
- A **standalone worker**, with its own source/build/runtime configuration.
- An **embedded worker**, which shares the parent app's deployed image and environment but has a separate process command, resource configuration and lifecycle.

Hostless documents the free plan as one always-on app, one worker, one cron job, unlimited sites, and one included database. Its shared free compute allowance is 0.5 vCPU and 1 GiB RAM across the account. These product allowances and compute ceilings are separate constraints: having an included app and worker does not provide an additional 0.5 vCPU / 1 GiB for each.

The user's Hostless wizard currently displays:
- App estimate: $0.00/month.
- Selected app runtime: Small, 0.1 vCPU / 256 MB.
- Remaining shared compute shown by the wizard: approximately 0.4 vCPU / 768 MB.
- Free storage remaining: 0.5 GB.

These are wizard estimates from the current session, not confirmation that an app has been created or deployed. Re-check the live billing estimate and available capacity immediately before any creation.

## Current code gap

The existing draft PR and `hostless/dawn-dotta-bun-runtime` branch contain a Docker web app for the recovered LIVE NOW / Upcoming Events listener only. That Railway source is now confirmed to have started an active Gateway session in its last observed successful deployment; the Hostless copy remains disconnected:
- `index.tsx` is that listener's entry point.
- `Dockerfile` currently copies only `package.json` and `index.tsx`.
- `package.json` has Bun listener dependencies and a preflight test command.
- `hostless.yaml` currently configures a Docker app and TCP health checks; it does not define a worker process.
- The image does not package all seven confirmed Gateway-connected deployments and their candidate modules.
- The listener's active path is not protected by the completed Bot 005 ownership-fencing path.

This image is not a whole-server replacement and must not be presented or deployed as one.

## Confirmed workload inventory

The initial read-only recovery identified six Gateway-connected responsibilities. A follow-up read-only check of the separate LIVE NOW / Upcoming Events Function service found a successful production deployment with `LISTENER_RUNTIME_ACTIVE=true`, `botMatches=true`, and a `creator-widget-gateway-ready` event. The migration inventory therefore contains seven confirmed Gateway-connected deployments; whether the seventh service duplicates some LIVE NOW V2 behavior remains unresolved:

1. **Blickymania Bot 005** — main command and interaction handler.
2. **Dawn Dotta Social Owner Console** — owner-facing social dashboard and interaction handlers.
3. **LIVE NOW V2 Shadow Engine** — live-state, voice, messages and interaction handling.
4. **Discord Engagement Engine** — engagement and XP processing.
5. **TikTok Fan Club Level-Up Management** — Fan Club level-up intake and media management.
6. **1-on-1 Coaching Interaction Relay** — raw Gateway interaction forwarding to the coaching workflow.
7. **Dawn Dotta LIVE & Events Listener** — separate `discord.js` Gateway client that publishes/maintains LIVE NOW and Upcoming Events panels. Its last observed production startup confirmed `active=true`, `botMatches=true`, and `creator-widget-gateway-ready`; its exact functional overlap with LIVE NOW V2 is still being reconciled.

These are separate service deployments, although the additional LIVE & Events Listener may overlap functionally with LIVE NOW V2. Their token values were redacted during recovery; do not assume that all seven use identical credentials. The inventory also distinguishes Gateway-connected services from REST-only functions.

## Candidate free-tier topology — not yet approved for deployment

The only Hostless free-tier topology worth prototyping is:

- **One HTTP app**: read-only health, deployment status and operational control endpoints. It must not open a Discord Gateway connection.
- **One embedded background worker**: a single supervisor entry point that can host the seven workload runtimes as separately identified and separately fenced logical services, subject to proof that the resource ceiling is adequate.

This is a candidate packaging approach, not a statement that the seven deployments can safely run as child processes in one process. The supervisor and service adapters have not been implemented. A single worker process must not combine the seven Gateway owners under one global lease or collapse their handler ownership. Each workload requires its own explicit identity, configuration, start/stop lifecycle, readiness signal, failure isolation and ownership scope.

Do not add a `workers:` entry to `hostless.yaml` until the referenced worker command exists in the image and its isolated startup/shutdown tests pass. Hostless reconciles the worker list on a successful app deployment; an empty `workers: []` removes the app's embedded workers. Preserve this distinction when updating the file.

Do not provision seven standalone workers under the free plan. The documented allowance is one worker, and each additional workload may require paid resources. Do not assume seven child processes fit within 0.4 vCPU / 768 MB. In particular, media processing dependencies such as Sharp and FFmpeg need a measured resource budget.

## Required engineering work before a worker command is added

1. **Build reproducible packaging**: include every required source directory, lock dependencies, pin runtime and library versions, and verify native dependencies (including media codecs) in the Docker image. Do not strip recovered source headers or rewrite recovered behavior without tests.
2. **Add a workload supervisor**: manage each workload as a distinct child runtime with its own explicit configuration, health state, exit handling, bounded restart policy and graceful shutdown. A failed child must not silently make the whole supervisor report healthy.
3. **Implement separate ownership**: every Gateway workload needs its own lease scope, unique per-start owner identity, monotonically increasing fencing epoch, heartbeat and fail-closed loss behavior. No workload may borrow Bot 005's lease.
4. **Prove physical stop before takeover**: a database lease alone does not close an already-open Gateway socket. A replacement may not log in until the previous owner is demonstrably stopped. Hostless-side health checks alone are not proof that an external Railway process has stopped.
5. **Coordinate coaching migration**: Bot 005 and the Coaching Interaction Relay both forward to the coaching workflow. The receiver, authenticated ingress and durable processing/recovery behavior must be migrated and tested as a coordinated change. The existing durable claim is at-most-once and leaves a documented crash window before dispatch; a durable processing/recovery design remains required.
6. **Preserve behavior**: compare every existing command, custom ID, interaction response, media path, channel identifier and feature-specific environment variable against the recovered source. Do not change bot roles, Discord permissions, or role assignments.
7. **Test without production credentials**: run static checks, unit/integration tests with mocked Discord and coordination interfaces, and a separate test-bot exercise. Do not use the production bot token for test connections.
8. **Measure resources**: perform a bounded soak test of the complete worker workload under an explicitly approved resource allocation. Record peak and steady-state memory/CPU, restarts, Gateway reconnects, queue backlog and media processing load. If it cannot run reliably inside the shared free allowance, do not deploy it as a free solution.

## Cutover and operational safety

- Production Railway is blocked by an overdue payment and must not be updated, restarted, suspended, redeployed, or used as a build/deployment dependency.
- The recovered Railway source is historical source material only. No runtime secret values were recovered.
- A cutover requires an independently verifiable shutdown/fence for each existing Gateway workload before the replacement corresponding workload can log in. Do not start replacement sessions alongside old sessions as a shortcut.
- If the legacy Gateway owners cannot be stopped or otherwise physically fenced through an authorized, verifiable path, the migration must remain in standby. Do not claim a successful cutover.
- No production Discord write, role change, token rotation, DNS change, database creation, paid resource, or secret provisioning is authorized by this document.

## Current release status

- Source recovery: complete for the six baseline workload snapshots plus the additional LIVE NOW / Upcoming Events listener source.
- Workload-by-workload migration and fencing: incomplete.
- Whole-stack Docker packaging and supervisor: not implemented.
- Full repository CI: repeatedly fails before a job/runner is created; no claim of full CI success.
- Hostless app: not created.
- Hostless worker: not created.
- Discord Gateway activation on Hostless: prohibited until all required gates above pass.
- Production: unchanged by this plan.


## Source-level runtime and persistence matrix

This matrix records configuration names and code dependencies only. Secret values were not retrieved.

| Workload/source | Runtime dependencies and configuration | Persistence / migration implications |
|---|---|---|
| Bot 005 | Bun candidate uses discord.js 14.27.0. Environment names include `DISCORD_BOT_TOKEN`, `AUTHORIZED_GUILD_ID`, `APPLICATION_ID`, `PORT`, `SILENT_BUILD_MODE`, `SOCIAL_TIKTOK_URL`, `PROFILE_DATA_VAULT_CHANNEL_ID`, `PROFILE_BIRTHDAY_CHANNEL_ID`, `PROFILE_ANNIVERSARY_CHANNEL_ID`, and `PROFILE_DATA_ENCRYPTION_KEY`. | User profile records are AES-GCM encrypted and stored as messages in a configured Discord vault channel; the encryption key must remain a secret. Bot 005 also calls the coaching workflow. |
| Social Owner Console | discord.js 14.27.0; `DISCORD_BOT_TOKEN`, `AUTHORIZED_GUILD_ID`, `PORT`, plus optional social-link URL/handle pairs: TikTok, Instagram, Facebook, Threads, X, YouTube, LinkedIn, Linktree, Lemon8, Audiomack, Apple Music, Amazon Music, and Discord invite. | Uses Discord for its dashboard and proposal state; social URLs/handles must be supplied as environment configuration, not source literals. |
| LIVE NOW V2 Shadow Engine | discord.js 14.27.0, `tiktok-live-connector` 2.5.0, `sharp` 0.34.5. Environment names include `DISCORD_BOT_TOKEN`, `LIVE_V2_ACTIVE`, `LIVE_V2_BOT_ID`, `LIVE_V2_CHANNEL_ID`, `LIVE_V2_COMMUNITY`, `LIVE_V2_GENERAL_ID`, `LIVE_V2_GUILD_ID`, `LIVE_V2_PANEL_PUBLISH`, `LIVE_V2_PASTE_ENABLED`, and `PORT`. | Media conversion and TikTok live connectivity add native/runtime dependencies. Keep activation and publishing disabled until its own lease, handler parity and test-bot tests pass. |
| Discord Engagement Engine | discord.js 14.27.0, `node:crypto`, `node:fs/promises`. Environment names include `DISCORD_BOT_TOKEN`, `AUTHORIZED_GUILD_ID`, `APPLICATION_ID`, and `XP_VOLUME_READY`. | **Hard persistent-storage dependency:** it requires `XP_VOLUME_READY=true` and reads/writes `/data/discord-engagement-v1.json` using atomic temp-file rename. It will refuse startup without a confirmed persistent volume. A Hostless worker without durable storage is not a valid migration. Volume cost and free eligibility are not verified. |
| Fan Club Level-Up Management | discord.js 14.27.0, `sharp` 0.34.5, `fflate` 0.8.2, `ffmpeg-static` 5.3.0, plus Node/Bun filesystem and temp-directory APIs. Environment names include `AUTHORIZED_GUILD_ID`, `DISCORD_BOT_TOKEN`, `FANCLUB_BOT_UPLOAD_LIMIT_BYTES`, `FANCLUB_LEVELUPS_CHANNEL_ID`, `FANCLUB_MANAGEMENT_CHANNEL_ID`, `FANCLUB_OWNER_NAME`, `FANCLUB_STAFF_ROLE_IDS`, and `MEMBER_LIFECYCLE_STAFF_CHANNEL_ID`. | Uses native media tooling and temporary files which are cleaned up. This is likely the most media/CPU-intensive worker; memory, disk and codec behavior must be measured in the target image. |
| Coaching Interaction Relay | Raw Discord Gateway WebSocket; environment names include `APPLICATION_ID`, `AUTHORIZED_GUILD_ID`, `DISCORD_BOT_TOKEN`, and `PORT`. | Recovered source hardcodes `http://coaching-workflow.railway.internal:3000`. Replace with an authenticated public HTTPS receiver and migrate the receiver plus Bot 005 caller together. It has its own Gateway ownership scope, separate from Bot 005. |
| Coaching Workflow receiver (HTTP, not a Gateway owner) | Bun HTTP service; environment names include `APPLICATION_ID`, `AUTHORIZED_GUILD_ID`, `DISCORD_BOT_TOKEN`, `PORT`, and `WRITES_ENABLED`. | Exposes `/healthz`, `/readyz`, and `POST /interaction`. Recovered implementation uses an in-memory `seenInteractions` map and no `DATABASE_URL` reference was found. Candidate HMAC authentication and durable interaction claims exist, but the at-most-once claim still has a crash-before-dispatch recovery gap. Include this HTTP receiver in the one app or migrate it to a durable equivalent. |
| Dawn Dotta LIVE & Events Listener (seventh confirmed Gateway deployment) | Bun, discord.js, `DISCORD_BOT_TOKEN`, `LISTENER_RUNTIME_ACTIVE`, and `PORT`. The source starts its Gateway client only when `LISTENER_RUNTIME_ACTIVE=true`; its `/preflight` path is read-only. | Railway service ID `75ec092b-7f53-465d-b46a-9f01a2b155a2`; successful deployment `d7601fae-1cae-4da1-a7d7-688e8fb8340e`. Read-only logs at `2026-11-10T22:40:06Z` recorded preflight `active=true`, `botMatches=true`, and `writes=false` for that preflight request; logs at `22:40:07Z` recorded `creator-widget-gateway-ready`. A follow-up metadata check found the service `live`, latest deployment `SUCCESS`, and no staged changes. Current process liveness was not directly probed. Exact overlap with LIVE NOW V2 remains unresolved; this service has no ownership fencing. |

### Important inventory correction

The six baseline rows in the production service inventory were confirmed by the initial read-only service audit. The additional LIVE NOW / Upcoming Events Function source has now been confirmed by its successful deployment metadata and startup logs: it activated its Gateway client and reported the expected bot identity. The current migration scope therefore includes **seven confirmed Gateway-connected deployments**. Its exact functional overlap with the LIVE NOW V2 Shadow Engine remains unresolved and must be mapped before implementation.


## LIVE NOW dashboard incident and safe-repair checkpoint — 2026-11-14

### Production observations (read-only)

- LIVE NOW V2 service: `7b194622-a8db-4a43-9bfd-4d17a7ba360e`; latest deployment `9d72eb28-e6d2-4bef-9cd6-43eb569d160f` is `SUCCESS`, created 2026-11-10 23:43:37 UTC. Startup logs reported the expected bot application ID `1565304619838742598`, `mode=active`, and a verified dashboard ID `1566082077768814717`.
- The V2 service's later passive audit on 2026-11-14 22:43:44 UTC reported `healthy=false`, `count=0`, `legacy=0`, `panel=null`.
- Discord readback on 2026-11-14: `#live-now` (channel `1565643739353972846`) returned no messages and no pins. A direct read of former panel `1566082077768814717` returned Discord 404 `Unknown Message`.
- `#upcoming-events` remains intact: message `1569626020917805078` still contains its Submit Event, How It Works, and Archived Flyers controls.
- The separate Dawn Dotta LIVE & Events Listener (service `75ec092b-7f53-465d-b46a-9f01a2b155a2`) remains separately deployed. Its source has `LIVE_V2_CUTOVER` logic that skips legacy LIVE NOW panel reconciliation when cutover is enabled; its last observed successful startup confirmed Gateway readiness. The exact division of runtime responsibilities is still not fully mapped.

### Why a direct message post was not used as a repair

The V2 process keeps `panelId` in memory after initial publication. Its page/navigation handlers prefer that stored ID when editing the dashboard, rather than always using the clicked interaction's message ID. The stored ID still points to the deleted message. Posting a replacement directly through Discord would therefore risk presenting working-looking controls that target the deleted ID. No replacement message was posted and the channel remains unchanged.

### Source-only repair component

- Added `implementation/live-now-panel-recovery.mjs`, a bounded reconciliation helper intended for integration with the existing V2 passive audit.
- Added `implementation/live-now-panel-recovery.test.mjs`, `implementation/live-now-panel-repair-adapter.mjs`, and `implementation/live-now-panel-repair-adapter.test.mjs`. Focused local Node.js 22.16.0 test run: **19/19 passed** (11 reconciliation tests + 8 adapter tests).
- Behavior: leave one correctly tracked V2 dashboard untouched; ask the existing guarded publisher to publish a missing dashboard only when no legacy panel exists; ask the existing publisher to adopt/update a sole V2 dashboard when the in-memory ID is stale; hold if duplicate V2 dashboards or any legacy panel are found; and require a second read scan to verify exactly one V2 panel and no legacy panel.
- Added `candidate/live-now-v2-shadow-engine.ts` as a separate candidate derived from the recovered snapshot; it imports the repair adapter and wires it into the existing `passiveAudit`. The existing 30-minute audit interval is reused without adding a timer.
- The candidate has an explicit early guard: `LIVE_V2_ACTIVE=true` throws before `Bun.serve` or any Gateway connection. Its bot application ID fallback is pinned to the verified app ID. No production token is embedded.
- The original `recovered/railway/live-now-v2-shadow-engine.ts` snapshot and live Railway service remain unchanged. The candidate is source-only, not deployed or executed. Bun is not installed in this execution environment, and the current migration `package.json` does not yet declare the V2 `tiktok-live-connector` and `sharp` dependencies; candidate package/build integration remains outstanding.
- The helper and adapter do not themselves make Discord requests, delete messages, access secrets, or create timers. The active production V2 `passiveAudit` remains read-only until a separately fenced candidate can be safely promoted.
- The repository's `npm test` script already includes `implementation/*.test.mjs`. The focused helper tests were run locally; the complete repository test suite and hosted CI have not been verified.

### Runtime and scheduler boundary

- The only existing periodic panel audit is the V2 service's 30-minute `passiveAudit` interval. This work created no cron job, scheduler, reminder, automation, or new interval. Existing V2 expiry/duration timers were not changed.
- No Railway service was updated, restarted, stopped, suspended, or redeployed. No Discord message, channel, category, role, bot role, permission, or assignment was changed in this repair cycle.
- No Hostless app/worker was created, no Gateway token was supplied, and no new Gateway session was opened.
- The helper is a source-only building block. It does not resolve the live panel until it is integrated into a separately fenced V2 runtime and that runtime can safely become the sole owner after independently verified hard-stop of the old process.

### Next execution step

Integrate the helper into a distinct LIVE NOW V2 candidate's existing passive audit, preserving the current one-per-30-minute audit cadence and the publisher's duplicate/legacy protection. Add the V2 workload's own independent ownership scope and verify exact process-stop proof before any new Gateway login. Keep production untouched until these conditions are met.
