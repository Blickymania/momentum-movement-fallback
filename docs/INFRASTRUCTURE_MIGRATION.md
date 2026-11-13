# Momentum Movement infrastructure migration

**Scope:** Dawn Dotta / Momentum Movement only.  
**Status:** Planning branch; no production resources changed.  
**Branch:** `infra/cloudflare-free-migration`

## Hard requirements

- No debit card or credit card required to start, activate, or continue the free deployment.
- No paid trial, expiring promotional credits, or automatic paid overage.
- Free quotas must replenish on a published daily or monthly schedule.
- Cloud-hosted operation; never depend on the owner's computer.
- Preserve the existing Discord manager, OAuth, Gateway listeners, scheduled workflows, databases, media originals, and Discord-side state.
- No production cutover until the replacement is deployed, tested, and has a rollback plan.
- Do not inspect, modify, test, deploy, or recover any other Discord community.

## Verified current environment

The authorized Railway project is **Dawn Dotta / Momentum Movement** in the production environment. Its inventory contains:

- 34 services.
- 5 persistent volumes.
- 2 PostgreSQL services (the primary Postgres service and OAuth PostgreSQL).
- 1 media bucket: `dawn-dotta-photo-originals`.
- Multiple scheduled services, including five-minute, half-hour, hourly, two-hour, and daily tasks.
- The project-level shared variable names include `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; their values were not read and their account ownership/validity have not been verified.
- One service, **Dawn Dotta News Forum 24h Retention Cleanup**, currently reports a crashed latest deployment and has three staged changes. It was not modified.

The **Dawn Dotta Discord Manager** is a Bun 1.4.4 HTTP/MCP service. Its source uses Discord REST APIs and PostgreSQL-backed OAuth tables. The **Dawn Dotta LIVE & Events Listener** is a separate Bun 1.4.4 / discord.js Gateway service. Its source-recovery repository is not a complete production deployment.

## Free-first target architecture

### Cloudflare Free account

Use a dedicated Cloudflare Free account for Momentum Movement, if the account creation flow is available. Cloudflare's documented Free-account creation flow creates the account immediately; adding a payment method is listed as a later step to enable additional products. Do not add a payment method.

- **Workers Free:** HTTP manager/API endpoints, webhooks, and a consolidated scheduler.
- **SQLite-backed Durable Objects on Workers Free:** coordination, leases/fencing, durable Gateway session metadata, and event acceptance.
- **D1 only where needed:** normalized shared records after schema and workload review.
- **Workers KV only for small, non-authoritative configuration/cache data.**
- **No Cloudflare R2 in the initial plan:** R2 onboarding includes a subscription checkout flow, so it is excluded until a no-card path is independently verified.
- **No paid Workers plan, paid add-ons, or metered overage.**

Published free limits to design around (re-check before deployment):
- Workers Free: 100,000 requests/day; 10 ms CPU time per invocation; 5 Cron Triggers/account.
- Durable Objects Free: SQLite backend only; 100,000 requests/day; 13,000 GB-seconds/day; daily quotas reset at 00:00 UTC.
- D1 Free: 5 million rows read/day, 100,000 rows written/day, 5 GB total storage; daily quotas reset at 00:00 UTC.

### Gateway and manager separation

- Port the Discord Manager's HTTP/MCP + OAuth surface to Workers. Its current OAuth code uses PostgreSQL-specific SQL and Bun's SQL client; it needs an explicit database compatibility migration rather than a blind runtime swap.
- Port the Discord Gateway listener into a Durable Object using the supported outbound WebSocket client API. Persist Gateway session ID, sequence number, resume URL, shard state, lease/fencing token, and durable event queue state. Implement heartbeat, reconnect/resume, rate-limit handling, and duplicate-safe event processing.
- Do not assume discord.js or Bun APIs run unchanged in Workers. The Gateway client must be ported and tested against a dedicated test application/bot before production.
- Use one consolidated scheduler with no more than the Free account's five Cron Triggers; dispatch individual jobs from a durable job registry.
- Use idempotency keys and durable queues so quota exhaustion, retries, or restarts do not lose work or duplicate Discord actions.

### Database and media

- Keep the two existing PostgreSQL data domains logically separate during migration. A single free Postgres project with separate schemas is a candidate only after measuring actual database size and checking no-card signup; the current manager uses PostgreSQL-specific features.
- Cloudflare D1 / Durable Object SQLite are candidates for newly ported state, not an automatic replacement for existing PostgreSQL data.
- Media originals must remain lossless and independently verified. Supabase Storage Free is a possible fallback candidate (1 GB storage, 50 MB maximum file size, 5 GB egress; Free projects may pause after seven days of low activity). Do not depend on it until no-card account setup and the actual media footprint are verified.
- Do not delete, expire, or overwrite existing media or databases during migration.

## Cutover sequence

1. Freeze the inventory and capture source snapshots, database exports, media object manifests, and configuration names without exporting secrets into Git.
2. Measure database sizes, media bucket size/object count, request volume, Gateway heartbeat interval, and scheduled job load.
3. Create the Cloudflare Free account without adding a payment method; verify Workers and SQLite Durable Objects are available without billing setup.
4. Build the replacement manager, OAuth storage adapter, Gateway Durable Object, job scheduler, and observability endpoints on the migration branch.
5. Port and test each service family; verify OAuth PKCE, owner/admin authorization, bot identity, guild isolation, rate limits, restart recovery, and all scheduled workflows.
6. Shadow-run read-only where possible; compare outputs against the current Dawn Dotta services without sending duplicate writes.
7. Perform a controlled cutover with one active Gateway owner, verified lease fencing, health checks, and a tested rollback to the existing Railway deployment.
8. Keep Railway resources and backups intact until the new system passes the agreed soak period. Do not delete or pause production resources as part of preparation.

## Explicit non-actions

- No Railway service, variable, volume, bucket, database, or deployment was changed.
- No Discord channels, roles, messages, commands, or bot settings were changed.
- No secrets or credential values were read, copied, or committed.
- No other Discord community was accessed.
