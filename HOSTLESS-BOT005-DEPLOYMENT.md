# Hostless deployment preparation — Dawn Dotta / Momentum Movement

This branch stages the repaired Bot 005 application for Hostless. It is **not deployed**.

## Why this is an App, not a standalone Worker

The recovered Bot 005 process runs a persistent Discord Gateway client and also exposes an HTTP health endpoint. It binds to `0.0.0.0`, reads Hostless' `PORT`, and exposes `/healthz`. Hostless Apps are the correct resource type for this combined HTTP + Gateway service.

## Repository selection

- Repository: `Blickymania/momentum-movement-fallback`
- Branch: `deploy/hostless-bot005-app`
- Runtime: Bun
- Build system: Detect automatically
- Start command: `bun run recovered-functions/blickymania-bot-005.ts`
- Health check: HTTP `/healthz`
- Replicas: exactly 1
- Resource ceiling: 0.2 vCPU / 384 MB RAM per instance
- Persistent volume: none required by this service's recovered source

The committed `hostless.yaml` declares the start command, one replica, bounded resources and health endpoint. The free-capacity figures shown in the account when inspected were 0.4 vCPU, 768 MB RAM and 0.5 GB storage remaining; the configured ceiling stays within those observed limits. Recheck the live capacity at creation time.

## Safe activation gate

`BOT_GATEWAY_ACTIVE` defaults to standby unless explicitly set to the string `true`.

- Initial deployment: set `BOT_GATEWAY_ACTIVE=false`. The HTTP health endpoint should return 200 in standby; the process does not log into Discord or process interactions.
- Activation: set `BOT_GATEWAY_ACTIVE=true` only after the old Bot 005 Gateway process is confirmed stopped. This prevents two processes using the same bot token from racing to acknowledge interactions.
- With the flag true, `/healthz` returns success only after the Discord Gateway and guild identity are verified.

## Environment variables

Required for standby:
- `AUTHORIZED_GUILD_ID=1565048205970767992`
- `APPLICATION_ID=1565304619838742598`
- `BOT_GATEWAY_ACTIVE=false`

Required before activation:
- `DISCORD_BOT_TOKEN` — add only as a Hostless secret. Never commit or paste it into chat.

Feature variables to preserve full Bot 005 functionality:
- `PROFILE_DATA_ENCRYPTION_KEY` — 64 hexadecimal characters. Reuse the existing production key; do not generate a replacement if encrypted profile records already exist.
- `PROFILE_DATA_VAULT_CHANNEL_ID`
- `PROFILE_BIRTHDAY_CHANNEL_ID`
- `PROFILE_ANNIVERSARY_CHANNEL_ID`
- `SILENT_BUILD_MODE=true`
- `SOCIAL_TIKTOK_URL`

The four profile variables and social URL are read by optional profile/social features. Their values were not copied from Railway. Do not claim full feature parity until they are recovered from the authorized secret store and tested.

Hostless supplies `PORT`; do not override it.

## Cutover safety

Do not set `BOT_GATEWAY_ACTIVE=true` while the existing Railway Bot 005 process may still be connected. The Railway billing block prevents us from verifying or safely stopping that process here. First confirm it is stopped; then activate the Hostless instance and test all four roles buttons.

## Current verified code repair

The roles dashboard config is restored for the pinned message `1566161931377709137` in channel `1565643484965109781`. The shared handler acknowledges with `deferUpdate()` before editing the message. The buttons remain informational navigation tabs and do not modify roles.

No Discord role, bot role, permission, hierarchy, or member assignment is changed by this branch.
