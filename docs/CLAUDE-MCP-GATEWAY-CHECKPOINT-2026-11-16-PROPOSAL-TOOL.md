# Claude Five-Server Gateway — Proposal-Only MCP Tool Checkpoint

**Date:** 2026-11-16  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** Proposal-only `discord_propose_change` tool implemented and locally verified. It does not execute a Discord write. No deployment.

## Completed in this cycle

- Added `discord_propose_change` to the MCP server. It requires the caller's current Discord owner/Administrator authorization and exact guild inclusion in the OAuth grant.
- The tool derives the guild ID from the selected independent manager configuration; the caller cannot supply or override the guild ID.
- It reads the selected manager's live channel inventory before proposal creation.
- Initial action allowlist:
  - `message.send` only for text and announcement channels.
  - `channel.update` only for text, announcement, and forum channels.
  - Forum layout and archive fields only for forum channels.
- Permission overwrites, role changes (including bot roles), deletes, bulk actions, unsupported channel types, and unknown channel IDs are rejected.
- The tool validates the action through the shared policy, creates an idempotent per-guild proposal, and calls the Auth Worker `createOwnerApprovalSession` RPC to obtain a one-time owner approval URL.
- The result clearly states that no Discord write has been executed. If the Auth Worker is temporarily unavailable, the pending proposal is preserved and the same idempotency key can be retried to request a fresh approval link.
- The owner may also be the requester, but the owner must still re-authenticate in the separate approval flow, review the exact action, and explicitly approve or reject.
- Added channel-inventory validation and proposal/link orchestration unit tests.
- OAuth remains `mcp:read` only. The proposal tool changes only internal proposal state; `mcp:write` and all Discord write execution tools remain disabled.

## Verification on the latest committed branch

Environment: Node.js 26.12.1, npm 12.2.2, Vitest 4.1.8, Wrangler 4.115.0.

- `npm ci`: PASS.
- `npm run check`: PASS — strict TypeScript and 63 unit tests across 7 files.
- `npm run test:workers`: PASS — 18 Workers runtime integration tests across 5 files.
- Wrangler dry-run: PASS for all seven staging Worker configs and both isolated test Worker configs.
- Scope check: MCP resource server still requires `mcp:read`; no `mcp:write` scope is present.
- Tool review: only `message.send` and `channel.update` can be proposed; no Discord write executor is connected.

The OAuth provider emits a non-fatal CIMD-disabled warning. The tested dynamic client registration flow does not require CIMD.

## Remaining objectives

1. Add a typed manager Worker write executor for the two allowlisted action types only. Use Discord message nonce/enforce_nonce for send idempotency and idempotent PATCH semantics for channel updates.
2. Connect execution results and attempts to the append-only audit log and verify crash recovery from expired leases.
3. Add end-to-end tests from MCP proposal creation through owner approval, execution, retry, and audit verification.
4. Only after all execution tests and security checks pass, consider granting `mcp:write`.
5. Configure Cloudflare staging resources, reciprocal Service Bindings, the shared owner-approval secret, OAuth KV, Discord application credentials, exact guild IDs, manager tokens, and staging hostnames.
6. Re-run acceptance on Node.js 22.
7. Complete the ChatGPT/Claude/Ui.Vision handoff and verify a real Claude MCP client connection. The three-agent workflow has not yet been demonstrated end-to-end.

## Safety state

- No Worker was deployed; all Wrangler commands were dry-runs.
- No Cloudflare staging/production resource, secret, route, or live binding changed.
- No Discord resource or bot role changed.
- All five communities remain independent.
- Existing production managers and Empress Worker remain untouched.
- No scheduler, cron, or recurring automation was created.

## Exact next execution step

Implement the typed manager Worker write executor for the approved `message.send` and `channel.update` proposals. Use the existing lease claim, unique fencing token, bounded retry count, and immutable audit events. Use Discord nonce/enforce_nonce for message sends and idempotent PATCH for channel updates. Keep `mcp:write` disabled until end-to-end execution tests pass.
