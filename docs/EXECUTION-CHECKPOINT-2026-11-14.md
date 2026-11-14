# Autonomous execution checkpoint — 2026-11-14

Updated: 2026-11-14 05:43 UTC

## Scope and safety state

This cycle continued the Dawn Dotta / Momentum Movement independent failover work. All changes in this checkpoint are repository/source changes only.

- No production Discord Gateway session was stopped or changed.
- No Railway service was updated, suspended, restarted or redeployed.
- No Render service, database, key-value store, secret or paid resource was created.
- No Cloudflare Worker or Durable Object was deployed; no secrets were provisioned.
- Bot 005 remains the production primary for its own workload on Railway.
- The Bot 005 lease remains scoped only to `momentum-movement:bot-005-gateway`.
- Five other live Gateway-connected workloads remain outside this scope. The earlier assumption that Bot 005 was the only Gateway-connected workload in the project is superseded; see `MOMENTUM-MOVEMENT-GATEWAY-WORKLOAD-INVENTORY.md`.

## Cycle 16 — Coaching Workflow security audit and authenticated transport

### Findings
The recovered Coaching Workflow accepts unauthenticated `POST /interaction` requests. Making that endpoint public without sender authentication would expose an interface that receives Discord interaction payloads and interaction tokens. The recovered process-local `seenInteractions` map also resets on restart.

### Implemented source changes
- Added `implementation/coaching-workflow-auth.mjs`: HMAC-SHA256 signatures cover source identity, millisecond timestamp and exact raw JSON body; verification enforces a 60-second clock window and constant-time signature comparison.
- Added `implementation/coaching-workflow-auth.test.mjs` for valid requests, payload/source tampering, invalid signatures, stale/future timestamps and malformed inputs.
- Updated `implementation/coaching-workflow-client.mjs` to require an explicit source identity and secret, and sign each interaction POST. The read-only `/readyz` check remains unsigned.
- Updated Bot 005 and Coaching Relay candidates to use distinct source identities (`bot005` and `coaching-relay`) and separately generated secrets.
- Added candidate receiver `candidate/coaching/one-on-one-coaching-workflow.ts`; it verifies sender authentication before parsing JSON, rejects missing/equal sender secrets at bootstrap, and retains the existing interaction handling semantics.

### Release boundary
The recovered production Workflow and Relay were not modified. Candidate source is not deployed. No sender secrets or public URL have been created.

## Cycle 17 — durable coaching interaction claims and URL hardening

### Durable idempotency
- Extended the existing Cloudflare Durable Object with a separate SQLite table `coaching_interaction_claims`; it does not alter the `gateway_ownership` lease row or add the Coaching Relay to the Bot 005 lease.
- A unique Discord interaction ID is claimed atomically and retained for seven days. The Worker exposes a separately authenticated `POST /coaching/interaction/claim` route using `COACHING_IDEMPOTENCY_TOKEN`.
- The candidate Workflow calls the claim endpoint after HMAC verification and JSON parsing but before dispatch. A duplicate receives a duplicate response; an unavailable claim service returns 503 and fails closed.
- The Durable Object and Worker have dedicated tests for claims, duplicate detection, restart persistence, input validation, authentication and fail-closed behavior.
- The in-memory map remains only as a short-lived process-local fast path.

### Reliability qualification
The current durable claim is **at-most-once**, not a durable work queue. A process crash after the claim commits but before handler dispatch may require manual recovery. A durable processing-state/recovery queue or explicit acceptance of this failure mode is required before public cutover.

### URL validation repair
- Corrected a malformed trailing-dot normalization in the Cloudflare lease client.
- Hardened lease/fence endpoint URL validation against trailing-dot localhost, internal/private suffixes, reserved test/invalid domains, single-label hosts, IPv4 literals and IPv6 literals.
- Added regression tests for the blocked URL classes.

## Verification performed

- HMAC helper: 4/4 tests passed in an isolated Node.js v22.16.0 harness after correcting async assertion use. This is not the full repo test suite.
- Durable claim SQL semantics: local Node.js v22.16.0 SQLite harness passed first claim, duplicate claim after simulated Durable Object recreation, invalid ID/source, and seven-day expiry cases.
- Lease/fence URL validation: local Node.js v22.16.0 check passed nine rejected private/reserved URL patterns and two allowed public HTTPS patterns.
- Source-level verification: HMAC verification precedes JSON parsing; durable claim precedes accepted dispatch; Bot 005 and Relay identities are distinct; Worker route uses a separate bearer token; DO table is separate from the Gateway lease.
- Full repository test suite remains unverified. GitHub Actions pushes on 2026-11-14 terminate with `startup_failure` before any jobs are created (`total_count: 0`, no runner/job logs). The exact cause is unknown; no claim is made that CI tests passed.

## Current blockers and next work

1. Restore a functioning CI runner or run the complete repository test suite in an equivalent clean Node 22 checkout. Current Actions runs create no jobs.
2. Add a durable processing/recovery workflow to close the at-most-once post-claim crash window, or formally accept and document the manual-recovery behavior.
3. Verify current Render workspace access and inventory; previous authenticated dashboard access stopped at sign-in. Workspace inspection approval does not authorize paid provisioning.
4. Verify Cloudflare account, plan, limits and current deployment state before any deployment. No Worker/DO has been deployed.
5. Provision distinct secrets only in approved provider secret stores; never commit or echo secret values.
6. Deploy/test the coaching receiver and idempotency control plane before changing either caller; migrate Bot 005 and Relay together or intentionally retire the Relay.
7. Continue Bot 005 lease integration on both primary and standby; prove the hard-stop path and exact service identity. The first Railway-to-Render transition still needs a separately verified manual stop of the live Railway Gateway followed by one-time operator bootstrap.
8. Keep all five other Gateway workloads outside the Bot 005 lease and design independent workload scopes if they later need HA.

## Repository revision

Checkpoint recorded on `main` at commit:

`4546854baf878f329291c4d0ab37b60364c1c747`

Production state remains unchanged. Failover is not complete or production-ready.
