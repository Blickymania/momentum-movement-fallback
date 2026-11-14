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

The existing draft PR and `hostless/dawn-dotta-bun-runtime` branch contain a Docker web app for the recovered LIVE NOW / Upcoming Events listener only:
- `index.tsx` is that listener's entry point.
- `Dockerfile` currently copies only `package.json` and `index.tsx`.
- `package.json` has Bun listener dependencies and a preflight test command.
- `hostless.yaml` currently configures a Docker app and TCP health checks; it does not define a worker process.
- The image does not package all six recovered Gateway workloads and their candidate modules.
- The listener's active path is not protected by the completed Bot 005 ownership-fencing path.

This image is not a whole-server replacement and must not be presented or deployed as one.

## Confirmed workload inventory

Read-only recovery identified six distinct Gateway-connected responsibilities in the existing Momentum Movement deployment:

1. **Blickymania Bot 005** — main command and interaction handler.
2. **Dawn Dotta Social Owner Console** — owner-facing social dashboard and interaction handlers.
3. **LIVE NOW V2 Shadow Engine** — live-state, voice, messages and interaction handling.
4. **Discord Engagement Engine** — engagement and XP processing.
5. **TikTok Fan Club Level-Up Management** — Fan Club level-up intake and media management.
6. **1-on-1 Coaching Interaction Relay** — raw Gateway interaction forwarding to the coaching workflow.

These are separate responsibilities. Their token values were redacted during recovery; do not assume that all six use identical credentials. The inventory also distinguishes Gateway-connected services from REST-only functions.

## Candidate free-tier topology — not yet approved for deployment

The only Hostless free-tier topology worth prototyping is:

- **One HTTP app**: read-only health, deployment status and operational control endpoints. It must not open a Discord Gateway connection.
- **One embedded background worker**: a single supervisor entry point that can host the six workload runtimes as separately identified and separately fenced logical services, subject to proof that the resource ceiling is adequate.

This is a candidate packaging approach, not a statement that the six workloads already run safely in one process. The supervisor and service adapters have not been implemented. A single worker process must not combine the six responsibilities under one global lease or collapse their handler ownership. Each workload requires its own explicit identity, configuration, start/stop lifecycle, readiness signal, failure isolation and ownership scope.

Do not add a `workers:` entry to `hostless.yaml` until the referenced worker command exists in the image and its isolated startup/shutdown tests pass. Hostless reconciles the worker list on a successful app deployment; an empty `workers: []` removes the app's embedded workers. Preserve this distinction when updating the file.

Do not provision six standalone workers under the free plan. The documented allowance is one worker, and each additional workload may require paid resources. Do not assume six child processes fit within 0.4 vCPU / 768 MB. In particular, media processing dependencies such as Sharp and FFmpeg need a measured resource budget.

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

- Source recovery: complete for the six listed workload snapshots.
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
| LIVE NOW / Upcoming Events Function source (additional unresolved candidate) | Bun, discord.js, `DISCORD_BOT_TOKEN`, `LISTENER_RUNTIME_ACTIVE`, and `PORT`. The source starts its Gateway client only when `LISTENER_RUNTIME_ACTIVE=true`; its `/preflight` path is read-only. | Recovered in the Hostless branch under Railway service ID `75ec092b-7f53-465d-b46a-9f01a2b155a2`. Production environment values were redacted, so current activation state is unknown. It is Gateway-capable and has no ownership fencing. Reconcile this service against the six-workload inventory before declaring the final count. |

### Important inventory correction

The six rows in the production service inventory are six confirmed Gateway-connected workloads from the read-only service audit. The separate LIVE NOW / Upcoming Events Function source above is an additional recovered source with a conditional Gateway login. Its production state and relationship to the LIVE NOW V2 Shadow Engine have not been proven. The current migration scope is therefore **six confirmed workloads plus one unresolved Gateway-capable source**, not a closed six-item total.
