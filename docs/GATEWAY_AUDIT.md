# Momentum Movement Discord Gateway client audit

**Scope:** verified Dawn Dotta / Momentum Movement Railway project only.  
**Date:** 2026-11-13  
**Status:** Source-level audit of seven deployed Gateway clients. Token equality, runtime flags and live application intent grants remain unverified. No production connections or tokens were changed.

## Seven Gateway client implementations found

| Existing component | Source snapshot | Declared Discord intents | Event handlers / responsibility | Runtime and scope guards observed in source |
|---|---|---|---|---|
| Dawn Dotta LIVE & Events Listener | `index.tsx` (deployed Railway service source) | Guilds, GuildMessages; MessageContent is conditional and automatically retried without it after 4014/disallowed-intents | Raw `INTERACTION_CREATE` and `MESSAGE_CREATE`; starts LIVE/Event widget, publishes LIVE cards, receives upcoming events, retains ended LIVE history, event maintenance/archive | Connects only when `LISTENER_RUNTIME_ACTIVE=true`; `LIVE_V2_CUTOVER=true` disables its direct message workflow. Read-only preflight checks bot ID, expected guild and four channel names before declaring readiness. |
| Bot 005 | `recovered/railway/decoded/dawn-dotta-bot-005.ts` | Guilds, DirectMessages, optional GuildPresences after application-flag check; `Partials.Channel` | Multiple InteractionCreate handlers, raw lifecycle, ready/shard disconnect/resume/error | Explicitly validates `AUTHORIZED_GUILD_ID` and `APPLICATION_ID` against the Momentum Movement guild/app IDs before connecting. |
| Social Owner Console | `recovered/railway/functions/dawn-dotta-social-owner-console.ts` | Guilds | Multiple InteractionCreate handlers; owner dashboard, profile and social calendar synchronization | Uses `AUTHORIZED_GUILD_ID` and `DISCORD_BOT_TOKEN`; continuous HTTP service. |
| Fan Club Level-Up Management | `recovered/railway/functions/dawn-dotta-tiktok-fan-club-level-up-management.ts` | Guilds | InteractionCreate; Fan Club level-up media/workflow | Uses `AUTHORIZED_GUILD_ID`, channel/role configuration, and `DISCORD_BOT_TOKEN`. |
| LIVE NOW V2 Shadow Engine | `recovered/railway/functions/live-now-v2-shadow-engine.ts` | Guilds, GuildMessages; MessageContent added conditionally | InteractionCreate and MessageCreate, panel and live-link observation | Runtime flag `LIVE_V2_ACTIVE`; additional flags control panel publication/paste behavior; service is explicitly named Shadow Engine. Its active state was not read. |
| Discord Engagement Engine | `recovered/railway/functions/momentum-movement-discord-engagement-engine.ts` | Guilds, GuildMessages, MessageContent | MessageCreate for XP/engagement awards and sync; InteractionCreate | Uses `AUTHORIZED_GUILD_ID`, `APPLICATION_ID`, token and `XP_VOLUME_READY`; token/volume readiness values were not read. |
| Gift Assist | `recovered/railway/functions/momentum-movement-gift-assist.ts` | Guilds | InteractionCreate; gift-assist UI and payment/checkout webhook coordination | Uses the same-named `DISCORD_BOT_TOKEN` variable plus separate payment-provider credentials and feature flags. Payment credentials were not read. |

**Identity status:** the seven source files refer to the variable name `DISCORD_BOT_TOKEN`, but this does not prove that their environment values are identical. The LIVE & Events Listener, Bot 005, Discord Engagement and Gift Assist sources also contain the expected Momentum Movement guild/application identifiers or verify them at runtime. The other service sources use `AUTHORIZED_GUILD_ID` and/or a dynamic bot identity, but their deployed credential identities have not been queried. No token values or token hashes have been read, compared, logged or saved.

The decoded Bot 005 source explicitly checks its constants against guild `1565048205970767992` and application `1565304619838742598`. The original LIVE & Events Listener's read-only `/preflight` endpoint verifies bot ID `1565304619838742598`, guild scope `1565048205970767992`, and exactly one each of `live-now`, `upcoming-events`, `archived-flyers` and `general-chat`. Its `/preflight` does not perform Discord writes.

## Candidate intent union — not approved for production

If the seven clients are proven to use the same bot application/token and one Gateway session can safely replace them, their source-declared union is:

- Guilds
- GuildMessages
- MessageContent (privileged; requires Developer Portal approval/enablement)
- DirectMessages
- GuildPresences (optional in Bot 005 and only enabled after its runtime application-flag check)

Do not enable privileged intents merely because the union contains them. Verify approval and the application's effective flags first. Preserve Bot 005's direct-message partial behavior. Preserve the LIVE & Events Listener's graceful fallback when MessageContent is denied; its source reports that pasted links are unavailable in that fallback, while interactive forms remain available.

## Functional ownership and possible overlap

- The LIVE & Events Listener is the primary LIVE and Upcoming Events workflow source. It uses message content to detect TikTok LIVE links and handles interaction events for its own controls. Its live workflow is disabled when `LIVE_V2_CUTOVER=true`.
- LIVE NOW V2 is a separate shadow service with message and interaction handlers. Its runtime flag `LIVE_V2_ACTIVE` and the production value of `LIVE_V2_CUTOVER` were not inspected. Do not assume the two implementations are mutually exclusive or which one currently owns the live channel.
- Discord Engagement Engine needs message content to award XP; replacing it with an interaction-only Gateway would silently break message-driven engagement.
- Social Owner Console, Fan Club Level-Up and Gift Assist currently declare only the Guilds intent and are interaction-heavy. They still need their HTTP endpoints, state stores, startup behavior and side effects preserved.
- Bot 005 has multiple interaction handlers plus DM/optional presence behavior. Its functions cannot be replaced by the other clients' handlers without a complete interaction/command routing map.
- The LIVE & Events Listener has maintenance/timer behavior inside its widget; the business workflow timers must be moved to the future central business scheduler, not duplicated with additional cron/keepalive jobs.

## Why the clients cannot yet be consolidated

1. Token equality is unknown. Same env-variable name does not establish same secret value or same Discord application.
2. The seven runtime flags and current deployed activity have not been reconciled. In particular, do not assume LIVE NOW V2 shadow/cutover flags are aligned.
3. Event handlers have different responsibilities and side effects. One dispatcher must preserve per-handler ordering, error isolation, interaction acknowledgement deadlines and no-duplicate message publishing.
4. MessageContent is required by some workflows and absent from others. Privileged intent approval must be checked before the union is enabled.
5. Bot 005 optionally uses DirectMessages and GuildPresences; its direct-message partial behavior and conditional intent gate must remain intact.
6. All current clients may be deployed simultaneously. A replacement cannot be activated until the new dispatcher is proven and old connections can be switched off without creating duplicate handlers or missed interactions.

## Safe consolidation proof required

Before implementing a single Gateway supervisor:

- Verify each client bot identity with authenticated `/users/@me` responses without logging or exposing secret token values.
- Compare token identity securely inside an authorized runtime only (e.g. fixed-time hash comparison in memory); never print, persist, commit or transmit the tokens or hashes. The current migration has not performed this step.
- Read the seven non-secret runtime flag values and map their currently effective behavior. Do not modify them during audit.
- Verify MessageContent and Presence intent approval/enabled state in the Discord application.
- Create an event/command ownership matrix for every InteractionCreate, MessageCreate and DM handler. Confirm side effects, response deadlines, idempotency and storage dependencies.
- Preserve the LIVE & Events Listener and LIVE NOW V2 cutover semantics; do not turn on both writers during shadow testing.
- Add durable inbox/outbox records and sequence-aware replay protection, then test the central router against the existing feature matrix.
- Test with a dedicated non-production Discord application/bot, not the production token or guild, before any cutover.
- During eventual cutover, ensure one Gateway connection owns each verified bot token/session and one dispatcher fans out events internally.

## Deployment gate

No Gateway client was started, stopped, or modified during this audit. The protocol helpers and durable inbox have local tests, but no socket supervisor has been deployed. A 24-hour runtime test must cover HELLO/Identify, heartbeat/ACK, READY session persistence, reconnect/resume, invalid sessions, close codes, Worker/DO restart or eviction, durable queue ordering/acknowledgement, and quota exhaustion. Cloudflare outbound WebSockets do not use hibernation; sustained DO duration and free-tier headroom must be measured rather than assumed.
