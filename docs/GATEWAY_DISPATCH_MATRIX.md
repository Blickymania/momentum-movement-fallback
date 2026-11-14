# Momentum Movement Gateway feature dispatch matrix

**Scope:** Dawn Dotta / Momentum Movement only  
**Source inventory:** 7 existing Gateway clients  
**Status:** selector ownership and durable delivery framework implemented and tested; original feature-handler adapters are not yet ported or wired to the coordinator. Gateway activation remains disabled.

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
- Handler adapters still need to be implemented so the initial Discord interaction is acknowledged within Discord's deadline and any later webhook-token use decrypts only in transient memory. The standalone dispatcher is not yet wired to the DO or supplied feature-handler adapters.

## Implemented files and current limitation

- `src/gateway-handler-registry.mjs`: validated manifest, strict selectors, guild/application scoping, exact collision rules and single-LIVE-publisher mode.
- `src/durable-gateway-dispatcher.mjs`: durable per-handler leases, retry policy, idempotency contract, receipt tracking, FIFO acknowledgement and quarantine.
- `src/interaction-token-vault.mjs`: AES-256-GCM interaction-token protection.
- `src/gateway-coordinator-core.mjs`: registry-aware ingress filtering and encrypted interaction payload persistence.
- `src/gateway-coordinator-do.mjs`: refuses startup without matching client definitions, handler manifest and token-encryption secret.

**Not yet complete:** the actual seven feature-handler implementations have not all been ported to Workers/DO adapters. The dispatcher is currently a tested standalone module; it is not wired into the DO alarm/interaction path. A live Gateway must not be activated until handler adapters are ported, their idempotency receipts are durable, interaction acknowledgement is immediate, and every feature family passes parity tests.
