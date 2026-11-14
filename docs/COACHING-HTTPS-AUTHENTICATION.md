# Coaching HTTPS migration — authentication and release gates

## Security boundary

The recovered production Coaching Workflow accepts `POST /interaction` without authenticating the caller. That route must not be exposed through a public HTTPS URL as-is. The candidate receiver verifies HMAC-SHA256 over the exact raw request body with a 60-second timestamp window before parsing JSON or dispatching the interaction.

The signed input is:

```text
source + "\n" + timestamp_ms + "\n" + raw_json_body
```

The receiver compares signatures without an early-exit byte comparison. The request body is capped at 256 KiB and the receiver responds with a generic 401 on authentication failure. Public `GET /readyz` remains a read-only readiness probe and does not accept interaction content. The former in-memory duplicate map remains only as a short-lived fast path; the candidate now requires a separate durable Cloudflare claim before dispatch.

## Separate sender identities

Bot 005 and the independent Coaching Interaction Relay MUST use different secrets. A credential leaked from one source must not authorize the other source.

| Component | Sender identity | Sender environment | Receiver secret |
|---|---|---|---|
| Bot 005 | `bot005` | `COACHING_WORKFLOW_SOURCE=bot005`, `COACHING_WORKFLOW_AUTH_SECRET` | `COACHING_BOT005_AUTH_SECRET` |
| Coaching Interaction Relay | `coaching-relay` | `COACHING_WORKFLOW_SOURCE=coaching-relay`, `COACHING_WORKFLOW_AUTH_SECRET` | `COACHING_RELAY_AUTH_SECRET` |

Each sender secret must be independently generated with at least 32 random bytes, provisioned through the hosting provider's secret store, and never committed to this repository or printed in logs. The candidates enforce the exact sender identity and reject a sender secret that matches the Discord bot token; the workflow receiver also rejects equal sender secrets and requires the idempotency token to be distinct from both sender secrets and the bot token. Generate locally with:

```sh
openssl rand -hex 32
```

The value generated for Bot 005 must be copied only to Bot 005's `COACHING_WORKFLOW_AUTH_SECRET` and the workflow's `COACHING_BOT005_AUTH_SECRET`. Repeat independently for the Relay. Do not reuse the lease, Discord bot, Render, Cloudflare, or any other credential.

## Candidate files

- `implementation/coaching-workflow-auth.mjs`: HMAC signing and verification primitives.
- `implementation/coaching-workflow-auth.test.mjs`: tamper, source separation, timestamp and malformed-header tests.
- `implementation/coaching-workflow-client.mjs`: signed sender client; readiness stays read-only.
- `candidate/bot-005/blickymania-bot-005.ts`: Bot 005 caller; requires the `bot005` identity and its own secret.
- `candidate/coaching/one-on-one-coaching-interaction-relay.ts`: Relay caller; requires the `coaching-relay` identity and its own secret.
- `candidate/coaching/one-on-one-coaching-workflow.ts`: receiver-side verifier applied before JSON parse and dispatch; requires a separate authenticated Cloudflare idempotency claim.

## Durable replay protection

The candidate workflow calls the separately authenticated Cloudflare Worker route `POST /coaching/interaction/claim` after HMAC verification and JSON parsing but before dispatch. The Worker uses its own `COACHING_IDEMPOTENCY_TOKEN` and a dedicated `COACHING_IDEMPOTENCY_STORE` namespace binding to reach a separate `CoachingInteractionIdempotency` Durable Object class. That class has its own SQLite storage and a `coaching_interaction_claims` table keyed by Discord interaction ID, with a seven-day retention index. It is a different Durable Object class and instance from `GatewayLeaseCoordinator`, so coaching claims do not contend with Bot 005's lease heartbeat/fence operations and do not add the Coaching Relay to Bot 005's Gateway lease scope.

The same token protects `GET /coaching/interaction/healthz`. Before the Workflow sets itself ready, it makes a bounded health request and checks the expected service identity and `ready:true`. The Worker then reads the dedicated Durable Object's internal `GET /healthz`. This prevents a missing binding or unavailable claim store from being mistaken for a ready Workflow at startup.

The durable claim is at-most-once: if the workflow process crashes after the claim is stored but before dispatch completes, the interaction will not be replayed automatically and may require manual recovery. This failure mode remains an explicit release gate; a durable processing-state/recovery queue would be required to guarantee eventual processing after that crash window.

## Mandatory release gates

1. Run all unit tests, including HMAC, sender client, candidate source and existing workflow tests.
2. Deploy the receiver privately or behind HTTPS with both receiver secrets before either caller is switched.
3. Verify an unsigned request, wrong-source secret, stale timestamp and altered body are rejected; verify properly signed calls from each service are accepted.
4. Verify the Cloudflare claim route rejects unauthenticated/invalid callers and a duplicate interaction ID returns `claimed=false`, including after Durable Object recreation.
5. Confirm both production callers can reach the same receiver; changing only Bot 005 leaves the Relay on the Railway internal URL.
6. Verify data persistence, access controls and workflow readiness under load before a public cutover.
7. Only after the separate Bot 005 Gateway lease/fence path is provisioned and proven may Bot 005's primary/standby cutover proceed.

## Current state

- HMAC sender and receiver source is committed; the authenticated workflow client fails closed without per-source secret configuration.
- Bot 005 and the separate Relay have distinct source identities and require different HMAC secrets.
- Cloudflare Worker and a separate `CoachingInteractionIdempotency` Durable Object class provide a separately authenticated, durable interaction-ID claim store with seven-day retention and isolated SQLite execution from the Bot 005 Gateway lease.
- These are candidate/source changes only. No public endpoint, Cloudflare Worker/DO deployment, or secret provisioning occurred. The recovered Railway workflow and Relay remain untouched.
- The full repository test suite has not run successfully in GitHub Actions because runs terminate as `startup_failure` before jobs are created. The auth helper alone passed a 4-test local Node 22.16.0 harness; SQLite claim semantics passed a separate local Node 22.16.0 harness. These are limited component checks, not full integration tests.

**Remaining reliability gate:** the durable claim is at-most-once, not a durable work queue. A workflow crash after claiming but before handling can require manual recovery. Add a durable processing-state/recovery queue or explicitly accept this failure mode before public cutover.


**Isolation improvement:** the first implementation co-located coaching claims and Gateway lease rows in one Durable Object class. That has been removed. Current code binds `CoachingInteractionIdempotency` separately, so lease heartbeats and Render fence control do not share the same Durable Object instance or SQLite database with coaching claim traffic.
