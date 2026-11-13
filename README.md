# Momentum Movement — No-card cloud migration

**Status:** migration preparation committed; not deployed.  
**Target guild:** Dawn Dotta / Momentum Movement (`1565048205970767992`).  
**Production source:** Railway project `a1d6b0e4-3169-4c5d-add3-84a70f7dc525`, production environment `c72ea3d9-2c1c-4651-a265-79723e317fa5`.

## Goal

Move Dawn's backend to cloud services that require **no payment card**, while preserving the live Discord guild, bot application/identity, commands, workflows, scheduled jobs, user data, media, and privacy boundaries.

## Target design

- **Botkeep Free:** one Bun workload for a consolidated always-on runtime. Current new-signup offer: one workload, 512 MB RAM, 0.5 vCPU, 1 GB storage, no renewal timer. It is beta hosting with no uptime SLA.
- **Cloudflare Workers Free:** HTTP endpoints and one scheduled dispatcher; daily request/CPU/subrequest caps apply.
- **Cloudflare D1:** candidate replacement for small ledgers and structured application state. This is not PostgreSQL-compatible; schemas and SQL must be deliberately ported.
- **Cloudflare R2:** candidate object store for original creator/gallery media and backups; verify account/bucket setup and test uploads before cutover.
- **GitHub:** source control and rollback history. This private repository is Dawn-only; do not blend the five separate Discord deployments.

## Critical constraints

1. No card, paid trial, paid plan, or "add card to verify" step.
2. No Railway service, volume, bucket, database, Discord channel, message, role, bot application, or token is deleted during preparation.
3. Do not stop the live Railway runtime until the replacement passes the full acceptance checklist.
4. A single free Botkeep workload cannot host 34 separate Railway services unchanged. The code must be consolidated into one Bun process, with one shared Discord Gateway client where technically safe, one HTTP router, and one scheduler.
5. The free Botkeep allocation is small. Measure memory and CPU under realistic traffic; do not promise that every feature will fit.
6. Cloudflare Workers do not replace a persistent Discord Gateway connection. Gateway events remain in the Botkeep Bun runtime.
7. PostgreSQL data and Railway persistent volumes need real exports/backups. D1 is a migration target, not a drop-in PostgreSQL replacement.
8. Cloudflare Free limits are hard stops, not replenishing credits to bypass. Do not split work across accounts to evade quotas.

## Documents

- `docs/SERVICE-INVENTORY.md` — verified production service inventory and persistence map.
- `docs/NO-CARD-TARGET-ARCHITECTURE.md` — hosting choice and hard limitations.
- `docs/MIGRATION-RUNBOOK.md` — gated migration and cutover sequence.

**Current verified state:** Discord manager connected; guild identity verified; read-only audit passed with 108 channels, 12 roles, 13 forums, 36 commands, and no reported warnings. One Railway scheduled service (News Forum Retention Cleanup) had a crashed latest deployment at last inspection.

**Nothing has been migrated or cut over yet.**
