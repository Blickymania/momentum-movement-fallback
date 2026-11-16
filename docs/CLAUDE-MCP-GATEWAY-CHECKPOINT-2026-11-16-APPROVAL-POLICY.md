# Claude Five-Server Gateway — Approval Policy Checkpoint

**Date:** 2026-11-16  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** Separate owner-approval step clarified; manager fetch redirect handling repaired; all staging checks pass.

## Completed in this cycle

- Clarified that approval must be a separate, explicit owner-authenticated step. The current guild owner may also be the requester, but must re-authenticate through the one-time Discord OAuth flow, inspect the exact proposal, and explicitly submit Approve or Reject; no agent may auto-approve.
- Approval now requires:
  - The original requester to be the caller executing the approved proposal.
  - A separately authenticated, current guild owner who explicitly approves or rejects the exact proposal. The owner may also be the requester; this is still a separate OAuth-authenticated approval step.
  - A server-side verified guild-owner result for the approver.
  - Matching guild, exact action hash, approved status, unexpired proposal, and unused approval.
- Added tests for separate owner approval, Administrator-only rejection, replay prevention, and the exact guild/action binding.
- Fixed the same Cloudflare Workers fetch incompatibility in the private manager Worker: Discord API calls now use `redirect: "manual"` and fail closed on non-OK/redirect responses.
- Added a regression test proving the manager Worker uses manual redirect handling and rejects redirects.
- Updated README status so it no longer describes the OAuth flow as untested or the login/consent records as KV-backed.

## Verification on the latest committed branch

Environment: Node.js 26.12.1, npm 12.2.2, Vitest 4.1.8, Wrangler 4.115.0.

- `npm ci`: PASS.
- `npm run check`: PASS — strict TypeScript and 63 unit tests across 7 files.
- `npm run test:workers`: PASS — 18 Workers runtime integration tests across 5 files.
- Wrangler dry-run: PASS for all seven Worker configurations and the separate OAuth test configuration.
- Static scan: no remaining `redirect: "error"` in the OAuth or manager Worker source.

## Important limitation

The separate owner-approval flow is connected to the persistent proposal store through a private service binding and a shared internal secret. The current guild owner must authenticate and explicitly decide; Administrator permission alone is insufficient. The owner may also be the requester. MCP write scope remains disabled; the proposal-only tool does not execute Discord writes.

## Safety state

- No deployment or Cloudflare resource change occurred.
- No Discord resource or bot role changed.
- No production manager or Empress Worker was touched.
- Five communities remain separate.
- No scheduled automation was created.

## Exact next execution step

The proposal-only `discord_propose_change` MCP tool is now implemented and tested. Next, build the lease-based typed manager Worker write executor for the already-approved action types. Keep `mcp:write` disabled until execution retries, idempotency, and end-to-end tests pass.
