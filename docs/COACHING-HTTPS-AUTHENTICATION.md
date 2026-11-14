# Coaching HTTPS migration — authentication and release gates

## Security boundary

The recovered production Coaching Workflow accepts `POST /interaction` without authenticating the caller. That route must not be exposed through a public HTTPS URL as-is. The candidate receiver verifies HMAC-SHA256 over the exact raw request body with a 60-second timestamp window before parsing JSON or dispatching the interaction.

The signed input is:

```text
source + "\n" + timestamp_ms + "\n" + raw_json_body
```

The receiver compares signatures without an early-exit byte comparison. The request body is capped at 256 KiB and the receiver responds with a generic 401 on authentication failure. The recovered workflow's interaction-ID deduplication map is process-local memory only; it does not survive a restart and is not sufficient as a durable anti-replay guarantee. Public `GET /readyz` remains a read-only readiness probe and does not accept interaction content.

## Separate sender identities

Bot 005 and the independent Coaching Interaction Relay MUST use different secrets. A credential leaked from one source must not authorize the other source.

| Component | Sender identity | Sender environment | Receiver secret |
|---|---|---|---|
| Bot 005 | `bot005` | `COACHING_WORKFLOW_SOURCE=bot005`, `COACHING_WORKFLOW_AUTH_SECRET` | `COACHING_BOT005_AUTH_SECRET` |
| Coaching Interaction Relay | `coaching-relay` | `COACHING_WORKFLOW_SOURCE=coaching-relay`, `COACHING_WORKFLOW_AUTH_SECRET` | `COACHING_RELAY_AUTH_SECRET` |

Each sender secret must be independently generated with at least 32 random bytes, provisioned through the hosting provider's secret store, and never committed to this repository or printed in logs. Generate locally with:

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
- `candidate/coaching/one-on-one-coaching-workflow.ts`: receiver-side verifier applied before JSON parse and dispatch.

## Mandatory release gates

1. Run all unit tests, including HMAC, sender client, candidate source and existing workflow tests.
2. Deploy the receiver privately or behind HTTPS with both receiver secrets before either caller is switched.
3. Verify an unsigned request, wrong-source secret, stale timestamp and altered body are rejected; verify properly signed calls from each service are accepted.
4. Implement and test durable interaction-ID idempotency that survives workflow restarts before public exposure. The current in-memory `seenInteractions` map only mitigates duplicate requests while one process remains alive.
5. Confirm both production callers can reach the same receiver; changing only Bot 005 leaves the Relay on the Railway internal URL.
6. Verify data persistence, access controls and workflow readiness under load before a public cutover.
7. Only after the separate Bot 005 Gateway lease/fence path is provisioned and proven may Bot 005's primary/standby cutover proceed.

## Current state

All changes listed above are candidate/source changes only. No public endpoint was created, no secrets were provisioned, and no production service was stopped, redeployed or modified. The recovered Railway workflow and Relay remain untouched.


**Additional release blocker:** do not expose the receiver publicly until replay/idempotency state is durable across workflow restarts. HMAC authentication and the 60-second timestamp window reduce exposure but do not substitute for a durable interaction-ID uniqueness constraint.
