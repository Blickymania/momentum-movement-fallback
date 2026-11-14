# Momentum Movement coaching ingress migration

**Scope:** migrate the coaching interaction transport as a dependency of Bot 005 failover. This is a read-only assessment and migration contract, not a production cutover instruction.

## Recovered production components

| Component | Railway service | Latest successful deployment | Runtime |
|---|---|---|---|
| 1-on-1 Coaching Interaction Relay | `aa366b1c-60fc-468e-b694-dceaf7d90580` | `035d6149-adb7-4961-85a8-d22bf1e41d1e` (2026-11-10) | Bun 1.4.4 |
| 1-on-1 Coaching Workflow | `018a08a9-d6ed-4de5-987d-b2eacb2633cb` | `7a55ecb9-8f48-4371-af51-ec57cf54c0ec` (2026-11-11) | Bun 1.4.4 |

Exact source snapshots are preserved in:
- `recovered/railway/one-on-one-coaching-interaction-relay.mjs`
- `recovered/railway/one-on-one-coaching-workflow.mjs`

Both snapshots were retrieved from the deployed Railway Function source on 2026-11-14. Secret values were not read or exported. The source scan found no embedded static bearer key, private key, GitHub token, AWS key, or OpenAI key.

## Current production behavior verified from deployed source

### Relay (Gateway-connected sender)
- Opens a raw Discord Gateway WebSocket and sends IDENTIFY using the configured bot token, application ID `1565304619838742598`, and intents `4097`.
- Filters coaching custom IDs beginning with `coach:` and forwards the interaction payload to the workflow service.
- Backend URL is hardcoded to `http://coaching-workflow.railway.internal:3000`.
- The forward request is plain HTTP with only `content-type: application/json`; there is no HMAC/source signature, static service authorization header, or durable idempotency request.
- Relay reconnect behavior is bounded exponential retry, but forwarding is a single HTTP attempt with a 2.5-second timeout.
- Its configured Railway variables are only `APPLICATION_ID`, `AUTHORIZED_GUILD_ID`, and `DISCORD_BOT_TOKEN`; the backend URL is hardcoded.

### Workflow (receiver / interaction processor)
- Accepts POST `/interaction`, parses the body, filters for `coach:` custom IDs, and rejects requests only if the workflow is not ready. The handler does not authenticate the sender or verify a signature.
- Duplicate suppression uses an in-memory `Map` called `seenInteractions`, pruned after 15 minutes. It is lost on restart and is not shared across multiple receiver instances.
- After marking an ID as seen, it calls `void handle(i)` and immediately responds `{accepted:true}`. Processing failures occur after acceptance and the sender cannot know whether the work completed.
- `pendingActions` is also in-memory and only prevents concurrent duplicate button actions in one process.
- The configured environment includes a `DATABASE_URL` variable, but this deployed source contains no reference to `DATABASE_URL` or a PostgreSQL client. Do not assume a durable database inbox exists.
- Interaction actions call Discord interaction callbacks/webhooks and update Discord channel messages; those side effects must be protected against replay.

## Why the existing Cloudflare claim endpoint is not sufficient by itself

The candidate Cloudflare Worker exposes `/coaching/interaction/claim`, backed by `CoachingInteractionIdempotency`. It provides durable unique claims, but a sender-side “claim then POST” shortcut can lose an interaction if the claim succeeds and the sender/receiver crashes before the workflow accepts and processes it. The existing DO claim record is not a durable work queue with pending/processing/completed states, retry leases, and replay.

**Do not wire a sender-side claim as a substitute for a durable inbox.** Use the idempotency primitive only as part of an end-to-end acceptance design that cannot acknowledge work before durable storage.

## Required target contract

1. **Two independent authenticated sources:** Bot 005 and Coaching Interaction Relay each use a separate high-entropy HMAC secret and fixed source identity (`bot005` / `coaching-relay`). The receiver verifies HMAC-SHA256 over source, timestamp, and exact request body; reject expired timestamps, unknown source, invalid application/guild, oversized payload, and non-`coach:` interactions.
2. **Public HTTPS only:** replace the Relay's hardcoded Railway-private URL with validated configuration. Both senders use bounded timeouts and signed requests; no private Railway hostname is allowed in the candidate receiver URL.
3. **Durable inbox before acceptance:** persist interaction ID, source, payload, received timestamp, state, attempt count, and a stable idempotency key before returning HTTP 202. A unique key prevents duplicate enqueue. A durable queue or equivalent transactional inbox must survive process restarts and multiple replicas.
4. **Recoverable processing:** worker claims a queued record with a bounded processing lease; commits completion only after the handler outcome is persisted. On crash/lease expiry the record becomes eligible for bounded retry. Permanent failures are surfaced for review rather than silently discarded.
5. **Idempotent Discord side effects:** use interaction ID + action identity and a persisted outcome/step journal so a retry does not duplicate channel-message creation, staff actions, voice permissions, or other mutations. Acknowledgement deadlines and Discord interaction-token expiry must be handled explicitly.
6. **Independent failure domains:** keep the coaching Relay's Gateway consumer distinct from the Bot 005 command Gateway lease. A Bot 005 takeover must not accidentally stop or double-start the coaching Relay. The Relay is a separate live Gateway-connected workload even though it uses the same Discord application ID.
7. **Operational cutover:** deploy receiver and idempotency store in staging, replay/duplicate/crash tests, migrate Relay and Bot 005 senders to HTTPS, verify both source identities, then test failover/failback. Production migration only after clean full-suite and staging proof.

## Required tests before rollout

- Valid signatures accepted for each source; wrong source/secret, invalid timestamp, replay outside tolerance, wrong guild/application, oversized body rejected.
- Duplicate interaction across separate receiver instances creates one inbox record.
- Crash after durable enqueue but before processing; retry still processes exactly once logically.
- Crash mid-processing and after Discord API success but before completion record; side-effect journal prevents duplicate mutation.
- Receiver unavailable after send, timeout, and bounded retry; no interaction acknowledged as accepted unless durably stored.
- Relay reconnect/forward; primary and standby Bot 005 preserve the same feature scope without sharing the Relay's lease.
- Discord callback response within the interaction acknowledgement window; expired interaction tokens are surfaced as terminal/recoverable errors.

## Current disposition

The live Relay and Workflow services remain on Railway and unchanged. No new secrets, URLs, database tables, deployments, or schedulers were written. This migration is a blocker to independent cross-provider coaching operation, and is separate from the Bot 005-only Gateway fencing implementation.
