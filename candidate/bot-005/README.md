# Bot 005 — standalone worker candidate

This package contains the executable wrapper for the recovered Bot 005 candidate and the rules-acceptance integration. It is source-only and has not connected to Discord.

## Build layout

- Runtime: `oven/bun:1.4.4`
- Entry point: `index.ts`
- Start command: `bun run start`
- Dockerfile: `candidate/bot-005/Dockerfile`
- Docker build context: repository root (`/`)
- Runtime dependency: exact `discord.js@14.27.0`

The preserved `blickymania-bot-005.ts` file is the candidate source snapshot. The executable `index.ts` adds the required Discord.js imports and contains the candidate body. A static package test checks that the wrapper remains aligned with that source body and that all transitive local modules are copied.

## Lockfile / build gate

No Bun lockfile has been generated. Do not fabricate it or remove frozen-lock enforcement.

Using Bun 1.4.4 in a build environment with registry access:

```sh
cd candidate/bot-005
bun install --lockfile-only
bun install --frozen-lockfile
bun --check index.ts
node --test package-static.test.mjs ../../implementation/rules-acceptance.test.mjs
```

Commit `bun.lock` only after the frozen install and tests succeed. Bun is unavailable in this execution environment and external package-registry access is blocked, so Docker build verification is still pending.

## Hostless configuration

Use a **Standalone Worker** in the Dawn Dotta Hostless project, selecting this repository and branch `codex/dawn-rules-acceptance`. Use Docker build context `/`, Dockerfile path `candidate/bot-005/Dockerfile`, and start command `bun run start`. The standalone worker has its own environment configuration; do not use an embedded worker that inherits the LIVE & Events app environment.

Required configuration names:

- `AUTHORIZED_GUILD_ID=1565048205970767992`
- `APPLICATION_ID=1565304619838742598`
- `DISCORD_BOT_TOKEN` — secret
- `BOT005_DEPLOYMENT_ID` — unique deployment identity
- `GATEWAY_LEASE_URL` — HTTPS lease coordinator endpoint
- `LEASE_SERVICE_TOKEN` — secret
- `FENCE_REQUEST_TOKEN` — secret
- `COACHING_WORKFLOW_URL` — HTTPS workflow endpoint
- `COACHING_WORKFLOW_SOURCE=bot005`
- `COACHING_WORKFLOW_AUTH_SECRET` — unique secret, 32–512 characters, different from the Bot token
- `PROFILE_DATA_VAULT_CHANNEL_ID=1570614206926033077`
- `PROFILE_DATA_ENCRYPTION_KEY` — 64 hexadecimal characters, secret
- `PROFILE_BIRTHDAY_CHANNEL_ID` and `PROFILE_ANNIVERSARY_CHANNEL_ID` — when their respective features are enabled
- `SOCIAL_TIKTOK_URL` — when the TikTok command is enabled
- `PORT` — health endpoint port

Set secret values only in the Hostless worker's secret/environment settings. Never commit secrets, pass them as build arguments, or print them in deployment logs.

## Cutover rules

Production Bot 005 remains the Railway primary. No worker may start while that process may still own a Gateway session. The only valid activation path is an independently verified hard stop/fence of the exact Railway Bot 005 service, followed by a verified unique Bot 005 lease and health check. Do not share the LIVE NOW V2 lease, LIVE & Events environment, or any other workload's Gateway scope.

No production resource, token, lease, role, permission, hierarchy, or assignment was changed for this candidate.
