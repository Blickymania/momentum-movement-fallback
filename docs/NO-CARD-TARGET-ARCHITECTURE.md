# No-card target architecture

## Primary runtime: Botkeep Free (Bun)

Use Botkeep's Free cloud workload for the long-lived Bun application. It is the only option checked in this migration that currently states all three requirements together: no credit card, continuous operation without a scheduled idle-sleep timer, and Bun runtime support.

**Current new-signup limits:** one workload, 512 MB RAM, 50% CPU (0.5 vCore), 1 GB storage. CPU is shared. Botkeep currently documents beta hosting with no uptime SLA. It can restart for maintenance, crashes, resource exhaustion or infrastructure/security events. The free offer is capacity-dependent and subject to terms/fair-use.

Provider pages:
- https://botkeep.cloud/
- https://botkeep.cloud/faq
- https://botkeep.cloud/docs/hosting

The account must be created and the free workload allocation shown in the panel must be verified before uploading a live bot token. If the signup flow asks for a payment card, stop; do not enter one or choose a paid plan.

## Supporting data and API layer: Cloudflare Free

Use Cloudflare Free only for functions that fit its limits:

- Workers HTTP routes and an authenticated API bridge.
- One Cron Trigger acting as a dispatcher for all time-based jobs.
- D1 for compact relational ledgers only after schema and query conversion.
- R2 for images/original media only after full copy, object count and checksum validation.

Current Workers Free limits include 100,000 requests/day, 10 ms CPU/request, 128 MB memory, up to 50 subrequests per invocation, and five Cron Triggers/account. These are quotas, not daily “credits” that can be purchased or multiplied. D1 free daily row limits are enforced; queries fail until the daily reset if row read/write caps are reached.

Provider references:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/

Do not rely on Workers to host the long-lived Discord Gateway client; that client belongs in the Bun runtime.

## Consolidation boundary

The existing 34 Railway services cannot be copied as 34 workloads into Botkeep Free. The target must consolidate:

1. One Bun process, one shared Discord.js Gateway connection where permissions/intents and event handling allow it.
2. Feature modules for Bot 005 commands, LIVE/events, engagement, Gift Assist, member lifecycle, fan-club level-up, and moderation/admin surfaces.
3. One Bun HTTP router for Discord Manager, coaching, owner console, logo, and health endpoints.
4. A durable scheduled-job dispatcher for community stats, role monitor, reminder jobs, media publisher, retention cleanup, directory sync, gallery safety/discovery, post cleaner, and social-link audits.
5. Cloudflare D1 for verified portable structured state; R2 for verified media objects. Keep small durable local cache only, never the sole copy of business/member data.

A shared Gateway client should be used only after all gateway handlers have been checked for intent scope, event duplication, interaction acknowledgement deadlines, and rate limits. If merging would change behaviour, split feature work into phases rather than ship partial handlers.

## PostgreSQL decision

There is no spare Botkeep Free workload for a separate database: databases consume the same workload slot and resource pool. Do not deploy PostgreSQL on the only Botkeep slot while expecting the bot to run there. D1 is not PostgreSQL, so convert schema, transactions, locks, JSON handling, prepared statements, migrations, and OAuth token persistence intentionally. Do not cut over coaching/OAuth data until all tables and rows reconcile.

## No-card guardrails

- Do not enable a paid Cloudflare Workers plan.
- Do not enter a payment card on Botkeep or any alternative host.
- No paid add-ons, paid domain, paid database or credit-based AI service may be required for the core Discord bot.
- Prefer deterministic local rules and Discord native APIs over paid image/LLM services. Treat Bright Data, Serper, Gemini, Groq and similar integrations as optional until verified free quota is available without a card.
- Keep a manifest of each quota, reset cadence, hard failure behaviour, and owner.
- Never solve rate limits by creating extra accounts or rotating identities.
