# Claude Five-Server Gateway — Execution Lease and Retry Checkpoint

**Date:** 2026-11-16  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** Persistent execution-attempt and lease state machine implemented and verified. The typed Discord write executor is not implemented or exposed. No deployment.

## Completed in this cycle

- Added a persistent `write_proposal_executions` SQLite table to the per-guild proposal Durable Object. It is initialized idempotently when the Durable Object starts; no external database migration or scheduler is required.
- Atomic proposal consumption now creates the execution record in the same transaction as the `approved` → `consumed` transition.
- Added atomic `claimExecution` for consumed proposals, with a unique random fencing token for every attempt.
- Added `renewExecutionLease`; only the current, unexpired token and matching attempt may renew.
- Added fenced `recordExecutionResult`; stale tokens, expired leases, wrong requesters, and mismatched attempts are rejected.
- Added retryable versus terminal failure state and a hard maximum of three execution attempts.
- Expired running leases can be reclaimed on the next explicit execution attempt. Failed retryable attempts can start a new attempt. A terminal failure cannot be retried.
- Added immutable audit events for execution start, expired-lease reclaim, retry start, success, and failure. Lease tokens are not written to the audit log.
- Added integration tests for concurrent claim atomicity, lease renewal, lease expiry/reclaim, stale-worker fencing, the retry cap, and terminal failures.
- No cron, scheduled retry, or recurring maintenance process was created. Lease expiry is evaluated only when an executor explicitly attempts to claim work.

## Verification on the latest local staging source

Environment: Node.js 26.12.1, npm 12.2.2, Vitest 4.1.8, Wrangler 4.115.0.

- `npm run check`: PASS — strict TypeScript and 63 unit tests across 7 files.
- `npm run test:workers`: PASS — 23 Workers runtime integration tests:
  - 8 auth Worker tests.
  - 15 gateway Durable Object and private-route tests.
- Wrangler dry-run: PASS for all seven staging Worker configs and both test Worker configs.
- OAuth scope remains `mcp:read`; no `mcp:write` scope or Discord write executor is exposed.

The test environment emits a non-fatal CIMD-disabled warning. The dynamic client registration flow used by these tests does not require CIMD.

## Remaining objectives

1. Implement the typed manager Worker write executor for only the approved `message.send` and `channel.update` action types.
2. For message sends, derive a stable Discord nonce from the proposal identity and use Discord's nonce enforcement where supported. For channel updates, use idempotent PATCH semantics.
3. Ensure the executor claims a consumed proposal with a lease, renews only when needed, and records every attempt/result with the current fencing token.
4. Add end-to-end tests from MCP proposal creation through separate owner approval, execution, retry/recovery, and immutable audit verification.
5. Only after those tests and security review pass, consider granting `mcp:write`.
6. Configure the real Cloudflare staging environment: reciprocal private Service Bindings, the same random owner-approval secret on both Workers, OAuth KV, Discord application credentials, five exact guild IDs, manager tokens, and staging hostnames.
7. Re-run acceptance on Node.js 22, the documented target.
8. Complete the ChatGPT/Claude/Ui.Vision handoff and verify a real Claude MCP client connection. The three-agent workflow has not yet been demonstrated end-to-end.

## Safety state

- No Worker was deployed; all Wrangler commands were dry-runs.
- No Cloudflare staging/production resource, secret, route, or live binding changed.
- No Discord resource or bot role changed.
- All five communities remain independent.
- Existing production managers and Empress Worker remain untouched.
- No scheduled automation was created.

## Exact next execution step

Implement the typed manager Worker write executor for the two allowlisted actions only. It must revalidate the exact consumed proposal, use the existing lease/fencing protocol, use Discord nonce/enforce_nonce for message-send idempotency, use idempotent channel PATCH for updates, record the result, and never modify roles, bot roles, permission overwrites, or perform deletes/bulk actions. Keep `mcp:write` disabled until end-to-end tests pass.
