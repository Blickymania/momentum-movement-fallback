# Momentum Movement Gateway feature dispatch matrix

**Scope:** Dawn Dotta / Momentum Movement only  
**Source inventory:** 7 existing Gateway clients  
**Status:** selector ownership and durable delivery are implemented. The Engagement Engine `MESSAGE_CREATE` adapter is wired to the Durable Object alarm and tested with mocked storage/Discord REST. The other six feature handlers and immediate interaction ACK/modal paths are incomplete. Gateway activation remains disabled.

## Why this map exists

All seven recovered services used `DISCORD_BOT_TOKEN` as an environment-variable name, but this does not prove their secret values or Discord application identities are the same. The target architecture is one Gateway session per verified application/token identity, with a central dispatcher routing each event to the one feature handler that owns it. Do not create one Gateway connection per feature or fan every interaction to every handler.

Before any deployment, verify the token/application identity securely inside the owner-authorized runtime. The coordinator computes token fingerprints in memory only and refuses duplicate token fingerprints and duplicate application IDs. No token or fingerprint is logged or persisted.

## Source-backed feature owners

| Handler ID | Original source | Event families | Selectors and responsibilities |
|---|---|---|---|
| `bot005` | `recovered/railway/decoded/dawn-dotta-bot-005.ts` | `INTERACTION_CREATE` | 36 slash-command names; Bot 005-specific component/modal selectors including `coach:`, `membercard:`, `memberdir:`, `profilev7:`, `mp26:`, `memberdata:`, `dcp:`, `mm005:`; fallback owner for non-hub `uniprof:` and `mompass:` actions |
| `social-owner-console` | `recovered/railway/functions/dawn-dotta-social-owner-console.ts` | `INTERACTION_CREATE` | `social3:`, `db10:`, and `mompass:` actions only when they come from the exact birthday/anniversary management messages |
| `fan-club-level-up` | `recovered/railway/functions/dawn-dotta-tiktok-fan-club-level-up-management.ts` | `INTERACTION_CREATE` | `fclub:`, `ums:`, and `uniprof:member` only from the exact universal-profile hub message |
| `discord-engagement-engine` | `recovered/railway/functions/momentum-movement-discord-engagement-engine.ts` | `MESSAGE_CREATE`, `INTERACTION_CREATE` | XP/message capture is `MESSAGE_CREATE`; its dashboard interactions use `ddxp:` |
| `gift-assist` | `recovered/railway/functions/momentum-movement-gift-assist.ts` | `INTERACTION_CREATE` | `gift:` component/modal family, including member-facing DM interactions |
| `live-events-listener` | `index.tsx` | `MESSAGE_CREATE`, `INTERACTION_CREATE` | LIVE/Event widget uses `cw:`; message link detection is limited to the configured LIVE channel |
| `live-now-v2` | `recovered/railway/functions/live-now-v2-shadow-engine.ts` | `MESSAGE_CREATE`, `INTERACTION_CREATE` | Shadow-engine components use `ln2:`; message link detection is limited to its configured LIVE channel |

## Bot 005 slash commands

The recovered source defines exactly these 36 command names:

`addtocase`, `announce`, `audit`, `automod`, `ban`, `bot-status`, `botconfig`, `botstatus`, `channelorder`, `channelposition`, `chatfirst`, `closecase`, `eventcreate`, `events`, `help`, `kick`, `lock`, `member`, `ping`, `poll`, `purge`, `report`, `role`, `rules`, `server`, `slowmode`, `statsset`, `statsstatus`, `support`, `tiktok`, `timeout`, `unban`, `warn`, `dashboard`, `bot-test`, `forum-admin`.

The current source's `SAFE` set matches the 36-name `CORE_COMMANDS` set, while individual permission checks remain inside Bot 005's command implementation. The registry maps these names to one owner; it does not grant permission or perform the command.

## Exact selector collisions resolved

### Fan Club universal profile vs Bot 005

Both source files contain `uniprof:` handling. The registry routes exact `uniprof:member` only to Fan Club when the component is on channel `1565643954811052057`, message `1566063315191595019`. Other `uniprof:` selectors route to Bot 005. This prevents the same interaction from being acknowledged by two former clients.

### Social birthday/anniversary books vs Bot 005 passport

Both source files contain `mompass:` handling. The registry routes `mompass:` to Social Owner Console only when the interaction originates from one of the exact management messages:

| Book | Channel ID | Message ID |
|---|---|---|
| Birthday | `1565643958665740288` | `1566062901419180154` |
| Anniversary | `1565643992178237474` | `1566062910386479189` |

Other `mompass:` component actions go to Bot 005. The Social Owner Console implementation also performs its own channel/message/owner checks; registry routing is not a replacement for those checks.

## Event fan-out

- `MESSAGE_CREATE` for the authorized guild routes to the Engagement Engine if that handler is explicitly enabled.
- The same message may additionally route to one LIVE publisher, but only when its channel equals the configured LIVE channel.
- The manifest allows exactly one LIVE publisher: `none`, `live-events-listener` or `live-now-v2`. It cannot activate both writers.
- `INTERACTION_CREATE` routes to one feature owner only. DM interactions are accepted only for the selectors whose source supports DMs (notably coaching and Gift Assist); ordinary guild features remain guild-scoped.
- Unknown selectors are unhandled/quarantined, not broadcast to all handlers.
- Known unconsumed Gateway dispatch types (for example, unused presence/typing updates) advance the durable resume sequence but are not added to the feature queue.
- An unknown or disabled interaction remains queued until its route is explicitly reconciled. It is never silently discarded.

## Durable delivery and acknowledgement contract

`src/durable-gateway-dispatcher.mjs` implements a per-event/per-handler delivery ledger:

1. Claim one handler delivery with an expiring lease and persistent attempt count.
2. Call the handler with a stable `idempotencyKey = eventKey + handlerId`.
3. The handler must commit its business side effect and a durable receipt before returning `{ committed: true, receiptId }`.
4. The ledger marks that handler complete only while its lease remains valid.
5. The original inbox event is acknowledged only after every selected handler has a completed receipt.
6. Failures use bounded exponential backoff. After the configured attempt limit, the handler becomes dead-lettered and the event stays in the inbox for operator review; later events are not allowed to leapfrog it.
7. A crash after an external side effect but before the ledger receipt is written causes a retry with the same idempotency key. The handler adapter must consult its own durable idempotency receipt before repeating the external action.

This gives at-least-once delivery with a handler-side idempotency contract; it does not claim exactly-once execution. The tests include a simulated crash between a side effect and ledger completion.

## Interaction-token security and time-critical acknowledgement

Discord interaction payloads contain a short-lived webhook bearer token. It must never be stored in plaintext.

- `src/interaction-token-vault.mjs` encrypts the token using AES-256-GCM, a unique 96-bit nonce and authenticated associated data bound to the interaction ID, application ID and guild ID.
- The 32-byte key is supplied only through the secret `GATEWAY_INTERACTION_ENCRYPTION_KEY` (64 hexadecimal characters). It is not committed.
- The core fails closed and closes the Gateway if it cannot protect the interaction token. The DO refuses startup if the encryption key is absent or invalid.
- The vault tests verify round-trip decrypt, unique nonces, context binding, tamper rejection and no plaintext token in the stored payload.
- The DO currently drains only the explicitly enabled Engagement Engine message adapter. The recovered source inventory shows interaction handlers use different defer-reply, defer-update, and modal-response paths; a generic defer would break some flows. Route-specific initial ACK plans and transient token use remain unimplemented. Keep Gateway activation disabled.

## Implemented files and current limitation

- `src/gateway-handler-registry.mjs`: validated manifest, strict selectors, guild/application scoping, exact collision rules and single-LIVE-publisher mode.
- `src/durable-gateway-dispatcher.mjs`: durable per-handler leases, retry policy, idempotency contract, receipt tracking, FIFO acknowledgement and quarantine.
- `src/interaction-token-vault.mjs`: AES-256-GCM interaction-token protection.
- `src/gateway-coordinator-core.mjs`: registry-aware ingress filtering, encrypted interaction payload persistence and post-frame dispatch wakeups.
- `src/gateway-coordinator-do.mjs`: matching-identity checks, shared-alarm dispatcher drain and the first Engagement Engine handler. Unsupported handler IDs fail closed.
- `src/bot005-interaction-ack-plan.mjs`: pure Bot 005 response planner for registered commands, ordinary buttons, known modal selectors and the multi-step coaching modal. Modal builders remain explicit dependencies; the planner is not wired to Gateway ingress.

## Recovered interaction ACK inventory

Read-only counts from recovered source snapshots show different acknowledgement patterns. Counts are source occurrences, not unique user flows. Bot 005 is a recovered snapshot and is not verified identical to the current encoded production service.

| Source snapshot | Defer reply | Defer update | Modal response paths | Modal-submit branches |
|---|---:|---:|---:|---:|
| Bot 005 | 3 | 7 | 0 SDK calls; 3 raw type-9 form branches | 2 |
| Social Owner Console | 0 | 9 | 3 | 3 |
| Fan Club | 2 | 5 | 3 | 4 |
| Gift Assist | 3 | 7 | 3 | 3 |
| LIVE NOW v2 | 3 | 6 | 4 | 4 |
| LIVE & Events Listener | 1 | 0 | 0 | 0 |
| Engagement Engine | 0 | 2 | 0 | 0 |

A generic component defer is unsafe: some selectors open modals, while modal submissions and commands use separate response paths. `src/bot005-interaction-ack-plan.mjs` now plans Bot 005 command type 5 and ordinary component type 6 responses. Known modal-opening selectors require a supplied type-9 form builder; the multi-step coaching modal requires a separate response handler. These paths fail closed when their builder is absent. The planner is not yet called by Gateway ingress; owner-specific planners for the other feature IDs and actual source identity verification remain outstanding. Keep Gateway activation disabled.

**Not yet complete:** six feature-handler adapters, integration of any ACK planner into Gateway ingress, modal form builders for Bot 005 and other modal-capable handlers, actual production Bot 005 identity/source verification, and live deadline/parity tests. The message-only Engagement adapter does not establish feature parity. Do not activate a live Gateway until all applicable handlers are ported and tested.


## First feature-handler port: Discord Engagement Engine message awards

The original `MESSAGE_CREATE` award path has now been separated into two testable components:

- `src/durable-engagement-ledger.mjs` — transactionally stores per-member XP totals, daily/monthly buckets, channel counts, reply/message counts, 90-day active-day samples, 35-day message-ID dedupe markers, 12-hour content-hash retention and per-user cooldown timestamps.
- `src/discord-engagement-channel-policy.mjs` — verifies the message channel through Discord REST, resolves thread parents, checks the @everyone View Channel permission, excludes private threads, NSFW channels and the original source's sensitive channel-name list.
- `createEngagementMessageHandler` — adapter for `MESSAGE_CREATE` that returns a durable receipt to the shared dispatcher.

The scoring is copied from the recovered source: 5 base XP, +3 for first qualifying channel of the ET day and +2 for a reply. A member receives at most one award per 60 seconds; repeated normalized content from the same member is suppressed for 10 minutes. Qualification requires a human, non-webhook guild message of type 0 or 19, with meaningful text. URLs and user/channel mentions are stripped before checking text length, letter count and word count. Raw message content is never persisted; only a SHA-256 digest and counters are stored. Historical XP is not fabricated.

Focused tests: 18/18 passed (ledger scoring/dedupe/concurrency/period snapshots and Discord channel-policy checks).

**Integrated in candidate source:** the Durable Object injects this message-award adapter only when the manifest enables it, and the dispatcher acknowledges the inbox event only after the XP receipt commits. The original public/staff dashboard sync, `ddxp:` button interactions, ephemeral/private DM delivery and immediate component acknowledgement remain unported. The Engagement Engine is only partially parity-complete and the Gateway remains disabled.
