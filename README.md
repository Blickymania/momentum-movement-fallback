# Momentum Movement — Dawn Dotta backend recovery

This repository branch now includes an inventory and source-only backup of the Dawn Dotta Railway project.

- [Recovery inventory](RECOVERY-INVENTORY.md)
- Original LIVE & Events Listener snapshot: `index.tsx`
- Recovered individual function sources: `recovered-functions/`

The recovered source files are safety copies only. They are not yet a tested, deployable failover environment.

---

# Original LIVE & Events listener recovery snapshot

This repository is a **source-recovery snapshot**, not yet a production deployment or tested failover runtime.

## Source provenance

- Community: Momentum Movement (Dawn Dotta)
- Railway project: a1d6b0e4-3169-4c5d-add3-84a70f7dc525
- Railway service: 75ec092b-7f53-465d-b46a-9f01a2b155a2
- Recovered from: deployed Railway Function source (not a staged edit)
- Runtime reported by Railway: Bun 1.4.4
- Railway deployment observed: d7601fae-1cae-4da1-a7d7-688e8fb8340e (SUCCESS)
- Source file: index.tsx
- Source length: 42405 characters / 425 lines

The source was copied without changing application logic. A credential-pattern scan found no embedded Discord bot token, GitHub token, AWS access key, PEM private key, static Bearer token, or credential assignment. Secret values were not read or exported.

## Runtime configuration

The source reads these environment variables:

- DISCORD_BOT_TOKEN
- LISTENER_RUNTIME_ACTIVE
- LIVE_V2_CUTOVER
- PORT

DISCORD_BOT_TOKEN must be supplied through the destination provider's secret manager. Never commit it to this repository.

The deployed code contains the Momentum guild/application identifiers and provides a /preflight endpoint. It only connects to Discord when LISTENER_RUNTIME_ACTIVE=true; otherwise it logs standby mode. This repository snapshot does not change that flag or the existing Railway service.

## Portability notes

- Source imports discord.js@14.27.0.
- It uses Bun-specific APIs, including Bun.serve, Bun.env, and Bun.sleep.
- Do not deploy it unchanged into Node.js or a non-Bun runtime.
- No Dockerfile, Railway deployment manifest, external database binding, or provider lease integration is declared yet.
- Before failover use, add provider-independent lease acquisition/fencing, durable event acceptance, health/READY checks, and a test-bot integration test.
- Do not attach this repository to the production Railway service until a reviewed migration PR and rollback plan exist.

## Recovery boundary

Only the deployed function source was recovered. Railway environment-variable values, Discord credentials, runtime state, and other community projects were not copied.