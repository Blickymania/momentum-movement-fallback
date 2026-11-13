# Momentum Movement Discord Gateway client audit

**Scope:** verified Dawn Dotta / Momentum Movement Railway project only.  
**Date:** 2026-11-13  
**Status:** Source-level audit; token equality and live application intent grants remain unverified. No production connections or tokens were changed.

## Six Gateway client implementations found

| Existing component | Source snapshot | Declared Discord intents | Gateway event handlers / relevant work |
|---|---|---|---|
| Bot 005 | `recovered/railway/decoded/dawn-dotta-bot-005.ts` | Guilds, DirectMessages, optional GuildPresences (conditional app-flag check) | Multiple InteractionCreate handlers, raw/ready lifecycle, shard disconnect/resume/error |
| Social Owner Console | `recovered/railway/functions/dawn-dotta-social-owner-console.ts` | Guilds | InteractionCreate; separate HTTP owner console |
| Fan Club Level-Up Management | `recovered/railway/functions/dawn-dotta-tiktok-fan-club-level-up-management.ts` | Guilds | InteractionCreate for Fan Club workflow |
| LIVE NOW V2 Shadow Engine | `recovered/railway/functions/live-now-v2-shadow-engine.ts` | Guilds, GuildMessages; MessageContent added conditionally | InteractionCreate, MessageCreate and gateway lifecycle |
| Discord Engagement Engine | `recovered/railway/functions/momentum-movement-discord-engagement-engine.ts` | Guilds, GuildMessages, MessageContent | MessageCreate for XP/engagement processing, InteractionCreate and gateway lifecycle |
| Gift Assist | `recovered/railway/functions/momentum-movement-gift-assist.ts` | Guilds | InteractionCreate; HTTP service and payment-provider integrations |

The source snapshots use an environment variable named `DISCORD_BOT_TOKEN` in multiple services. This is only a variable-name match; it is **not proof** that the configured secret values are the same. Secret values were not read or compared. Bot 005's decoded source explicitly checks its guild/application constants against the Momentum Movement guild and bot application IDs.

## Candidate intent union — not yet approved for production

If the six clients are proven to use the same bot application and one Gateway session can safely replace them, the source-declared intent union is:

- Guilds
- GuildMessages
- MessageContent (privileged; requires approved/enabled application intent)
- DirectMessages
- GuildPresences (optional in Bot 005 and only enabled after a runtime application-flag check)

Do not enable privileged intents simply because the union contains them. Verify their Developer Portal approval and the bot application's effective intent flags first. Preserve Bot 005's `Partials.Channel` behavior for direct messages.

## Why the clients cannot yet be consolidated

1. Token equality is unknown. Same env-variable name does not establish same token.
2. Application ID and actual `/users/@me` identity have not been verified across all six services.
3. Source contains different responsibilities and interactions. One Gateway session would need a central event router that preserves each handler's ordering, error isolation, acknowledgement deadlines, and duplicate-event semantics.
4. LIVE NOW V2 and Engagement require message events; other services use interactions only. A shared listener must receive all needed intents without widening privileged access more than necessary.
5. Bot 005 has a conditional presence-intent check and direct-message partials that must remain intact.
6. Existing six Gateway clients may be deployed simultaneously. A replacement cannot be activated until the new dispatcher is proven and old connections can be switched off without creating duplicate handlers or missed interactions.

## Safe consolidation proof required

Before implementing a single Gateway supervisor:

- Verify bot user ID and application ID for each service from authenticated identity responses without logging or exposing the secret token.
- Determine whether the actual bot token values are the same using a secure, non-disclosing comparison (e.g. hash comparison performed inside the authorized runtime; never print or persist the token).
- Verify application privileged-intent settings for Message Content and Presence.
- Create an event matrix for all InteractionCreate and MessageCreate handlers. Confirm handler responsibilities, acknowledgement timing, and external side effects.
- Add durable inbox/outbox event IDs and sequence-aware duplicate handling.
- Test with a dedicated non-production Discord application/bot, not the production token or guild, before any cutover.
- During eventual cutover, ensure only one Gateway connection owns each bot token/session and one dispatcher fans out events internally.

## Deployment gate

No Gateway client was started, stopped, or modified during this audit. The source-level helper tests do not prove a Cloudflare Gateway connection works. A 24-hour runtime test must cover HELLO/Identify, heartbeat/ACK, READY session storage, reconnect/resume, close codes, Worker/DO restart or eviction, queue persistence, and quota exhaustion. Because Cloudflare outbound WebSockets do not use hibernation, sustained DO duration and free-tier headroom must be measured rather than assumed.
