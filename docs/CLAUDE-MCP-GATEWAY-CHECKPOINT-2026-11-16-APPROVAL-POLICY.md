# Claude Five-Server Gateway — Approval Policy Checkpoint

**Date:** 2026-11-16  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** Independent owner-approval policy corrected; manager fetch redirect handling repaired; all staging checks pass.

## Completed in this cycle

- Corrected the approval policy so a proposal requester cannot approve their own action.
- Approval now requires:
  - The original requester to be the caller executing the approved proposal.
  - A different Discord user as approver.
  - A server-side verified guild-owner result for the approver.
  - Matching guild, exact action hash, approved status, unexpired proposal, and unused approval.
- Added negative tests for self-approval and an approver who is not verified as the guild owner.
- Fixed the same Cloudflare Workers fetch incompatibility in the private manager Worker: Discord API calls now use `redirect: "manual"` and fail closed on non-OK/redirect responses.
- Added a regression test proving the manager Worker uses manual redirect handling and rejects redirects.
- Updated README status so it no longer describes the OAuth flow as untested or the login/consent records as KV-backed.

## Verification on the latest committed branch

Environment: Node.js 26.12.1, npm 12.2.2, Vitest 4.1.8, Wrangler 4.115.0.

- `npm ci`: PASS.
- `npm run check`: PASS — strict TypeScript and 56 unit tests across 6 files.
- `npm run test:workers`: PASS — 5 Workers runtime integration tests across 2 files.
- Wrangler dry-run: PASS for all seven Worker configurations and the separate OAuth test configuration.
- Static scan: no remaining `redirect: "error"` in the OAuth or manager Worker source.

## Important limitation

The independent-owner approval rule is currently a policy helper with tests. It is not yet connected to a persistent proposal store or a trusted owner-verification flow. The future executor must derive the `approverIsOwner` assertion from the private OAuth authorization service after checking the actual Discord guild owner; it must never trust a caller-supplied boolean. MCP write scope remains disabled and no write tool is exposed.

## Safety state

- No deployment or Cloudflare resource change occurred.
- No Discord resource or bot role changed.
- No production manager or Empress Worker was touched.
- Five communities remain separate.
- No scheduled automation was created.

## Exact next execution step

Implement a staging-only, SQLite-backed write-proposal Durable Object with a pending → approved → consumed state machine and immutable audit rows. Use atomic SQL updates/transactions, idempotency, strict expiry, and tests for concurrent approval/consume, replay, self-approval, mismatched action hashes, and cross-guild reuse. Keep all write tools and `mcp:write` disabled until the persistent store and trusted owner-approval flow are verified.
