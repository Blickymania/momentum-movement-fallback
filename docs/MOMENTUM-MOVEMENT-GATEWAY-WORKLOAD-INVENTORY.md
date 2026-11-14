# Momentum Movement — Live Gateway Workload Inventory

Audit date: 2026-11-14 UTC
Environment: Dawn Dotta / Momentum Movement Railway production

Guild/application baseline for the main Bot 005 workload:
- Guild: 1565048205970767992
- Application: 1565304619838742598

## Why this inventory exists

A read-only audit of the production Railway environment initially found six services opening a Discord Gateway connection. A follow-up read-only check of the separate Dawn Dotta LIVE & Events Listener found an active Gateway startup in its latest observed successful deployment, bringing the confirmed deployment count to seven. The seventh service's exact functional overlap with LIVE NOW V2 remains under review.

These services have separate responsibilities and are not interchangeable Bot 005 replicas. They must not share a global lease. Each workload needs its own ownership scope, failover policy, and stop proof if it is later brought under independent failover.

The current Cloudflare lease scope is momentum-movement:bot-005-gateway and applies only to Bot 005. It does not fence or authorize any of the other five services.

## Confirmed live Gateway-connected services

| Service | Railway service ID | Gateway implementation | Observed role | Latest deployment (UTC) |
|---|---|---|---|---|
| Blickymania Bot 005 | 328ad9bb-7db8-4f9a-9a72-f91b73ef9fc9 | discord.js Client.login() | Main command and interaction handler, including coaching forwarding | 2026-11-11 21:57:32 — SUCCESS |
| Dawn Dotta Social Owner Console | 01588dd4-a338-4e73-a98c-e377e676efd7 | discord.js Client.login() | Separate owner-console interaction handlers | 2026-11-09 12:45:43 — SUCCESS |
| LIVE NOW V2 — Shadow Engine | 7b194622-a8db-4a43-9bfd-4d17a7ba360e | discord.js Client.login() | Separate LIVE NOW, voice, message and interaction events | 2026-11-10 23:43:37 — SUCCESS |
| Momentum Movement Discord Engagement Engine | 15d5ceb0-0a23-4481-a186-ad00d3fb7075 | discord.js Client.login() | Separate engagement/message and interaction processing | 2026-11-12 05:37:42 — SUCCESS |
| Dawn Dotta TikTok Fan Club Level-Up Management | db604954-5b7c-4f66-adbc-37a4c3387e97 | discord.js Client.login() | Separate Fan Club level-up interaction workload | 2026-11-09 12:49:57 — SUCCESS |
| 1-on-1 Coaching Interaction Relay | aa366b1c-60fc-468e-b694-dceaf7d90580 | Raw WebSocket to gateway.discord.gg | Receives READY and INTERACTION_CREATE and forwards coaching interactions | 2026-11-10 05:21:43 — SUCCESS |
| Dawn Dotta LIVE & Events Listener | 75ec092b-7f53-465d-b46a-9f01a2b155a2 | discord.js `Client.login()` when `LISTENER_RUNTIME_ACTIVE=true`; startup log confirms Gateway READY | Separate LIVE NOW / Upcoming Events panel publisher and interaction listener; functional overlap with LIVE NOW V2 is unresolved | 2026-11-10 22:39:58 — SUCCESS |

All seven services were reported `live` during read-only service metadata checks, and their latest observed deployment records reported `SUCCESS`. For the seventh service, startup logs at `2026-11-10T22:40:06Z` recorded preflight `active=true` and `botMatches=true`; at `22:40:07Z` the process recorded `creator-widget-gateway-ready`. The metadata check on 2026-11-14 found no staged changes. No Railway service was stopped, restarted, suspended, edited or redeployed.

## Token and identity certainty

- The seven service environments expose a variable named DISCORD_BOT_TOKEN. This proves that each process is configured to receive a Discord bot token, not that the seven redacted values are identical.
- The Railway connector redacts all variable values. No token value was read, copied, compared or logged.
- Bot 005, Social Owner Console, Discord Engagement Engine and Coaching Interaction Relay source explicitly contain the same Momentum Movement guild/application identifiers.
- LIVE NOW V2 uses environment-supplied bot/guild/channel identity values. Fan Club Level-Up uses AUTHORIZED_GUILD_ID. Their configured values and whether tokens are identical could not be confirmed because environment values are redacted.
- The inventory confirms seven Gateway-connected deployments within this Railway project. The seventh listener's startup preflight reported `botMatches=true` against the expected application ID; this does not prove every one of the seven redacted token values is identical.

## Coaching workflow dependency: two ingress paths

The coaching feature currently has two Gateway ingress paths:
1. Bot 005 directly forwards selected coach: component and modal interactions to the coaching workflow's /interaction endpoint after acknowledging or deferring the Discord interaction.
2. The separate 1-on-1 Coaching Interaction Relay receives raw INTERACTION_CREATE events and also forwards coaching interactions to the same workflow endpoint.

The coaching workflow maintains an in-memory seenInteractions deduplication map with a time window. Request records, private profile vault and related status are persisted through Discord channel/message REST operations. The recovered workflow source contains no database-client use or DATABASE_URL reference, although the Railway environment exposes a DATABASE_URL variable name. Do not remove that variable until the actual dependency graph and runtime behavior have been verified.

When the coaching service is migrated to public HTTPS, both Bot 005 and the Interaction Relay must be migrated or intentionally retired together. Replacing only Bot 005's URL leaves the relay dependent on the Railway-internal hostname.

## REST-only services are not automatically Gateway owners

The same Railway project has additional workers that receive or use DISCORD_BOT_TOKEN for Discord REST operations. A token variable alone does not imply a Gateway connection. The source review distinguished the seven services above by explicit discord.js login or raw WebSocket Gateway code; other token-bearing functions inspected so far showed REST-only request paths or were disabled.

Do not create a lease owner or standby for a REST-only worker unless its source actually opens a Gateway. Conversely, do not treat a Shadow, Sync, Monitor, Console or Worker service as Gateway-free based only on its name.

## Failover scope and rollout decision

### In this Bot 005 failover rollout
- Lease scope: momentum-movement:bot-005-gateway.
- Primary/standby service mapping, per-deployment fence token and Render hard-stop mapping must refer only to the two Bot 005 deployments.
- The current primary is still Railway-hosted. The Render fencer cannot stop a Railway service. Initial Railway-to-Render migration still requires a separately verified operator shutdown of the legacy Bot 005 Gateway followed by one-time operator bootstrap.
- The other five Gateway-connected services remain untouched and continue on their current service-specific lifecycles.
- Bot 005 and the coaching relay still need a coordinated coaching endpoint migration because both forward to the same workflow.

### Out of scope until separately designed
- Social Owner Console
- LIVE NOW V2 Shadow Engine
- Discord Engagement Engine
- Fan Club Level-Up Management
- Coaching Interaction Relay

Each out-of-scope service needs a separate review of event subscriptions, command/custom-ID responsibility, duplicate event handling, deployment-specific lease scope, its own primary/standby mapping and hard-stop proof, idempotency, data persistence and rollback.

Do not point multiple unrelated service pairs at the Bot 005 scope. The lease is a single-owner lock for one workload, not a global mutex for every Gateway connection in the project.

## Sources and limitations

- Railway service configuration and deployment metadata were retrieved read-only from the connected production project on 2026-11-14 UTC.
- Configured start-command payloads were decoded locally; source snapshots are stored under recovered/railway/.
- No secret variable values were returned or emitted.
- No Railway, Render, Cloudflare, Discord, DNS, deployment or billing changes were made.
- This audit describes code paths, deployment metadata and startup logs; it does not independently probe whether each Gateway socket remains established at this exact instant or prove that all seven token values are identical.

## Seventh confirmed Gateway-connected deployment — functional overlap unresolved (2026-11-14)

The Hostless migration branch contains the recovered LIVE NOW / Upcoming Events Function source associated with Railway service ID `75ec092b-7f53-465d-b46a-9f01a2b155a2`. Its `index.tsx` creates a Discord.js client and executes Gateway login only when `LISTENER_RUNTIME_ACTIVE=true`. Its `/preflight` route uses read-only Discord REST calls and reports `writesOnPreflight=false` for the preflight request.

Read-only Railway deployment metadata identifies successful deployment `d7601fae-1cae-4da1-a7d7-688e8fb8340e`, created at `2026-11-10T22:39:58.256Z`. Startup logs at `2026-11-10T22:40:06.278Z` recorded `TEAM_MOMENTUM_LISTENER_PREFLIGHT`, `ready=true`, `botMatches=true`, `active=true`, and `writes=false`. At `2026-11-10T22:40:07.174Z`, the process recorded both `creator-widget-panel-verified` and `creator-widget-gateway-ready`. On 2026-11-14, the service metadata still reported `state=live`, `latestDeployment.status=SUCCESS`, and `staged=null`. The current Gateway socket was not directly probed; these observations establish active startup on the last successful deployment, not a real-time socket health guarantee.

The service is a separately deployed Gateway client and is counted as the seventh confirmed Gateway-connected deployment. Its LIVE NOW / Upcoming Events responsibilities may overlap with the LIVE NOW V2 Shadow Engine; the exact division of ownership, channels, events and interactions remains unresolved. Do not merge the services or share one lease. Map their handlers and state ownership separately before implementation.

For migration planning, use **seven confirmed Gateway-connected deployments**. The Hostless branch's new listener remains a disconnected standby candidate: no `DISCORD_BOT_TOKEN` and no `LISTENER_RUNTIME_ACTIVE=true`.
