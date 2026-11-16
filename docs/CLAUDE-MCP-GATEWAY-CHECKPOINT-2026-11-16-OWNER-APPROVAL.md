# Claude Five-Server Gateway — Owner Approval Flow Checkpoint

**Date:** 2026-11-16  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** Separate Discord guild-owner approval flow and private gateway decision bridge implemented and verified locally. No deployment and no Discord writes.

## Completed in this cycle

- Added shared owner-approval request/response contracts.
- Added an Auth Worker RPC method, `createOwnerApprovalSession`, that creates a one-time, encrypted, 10-minute approval link bound to a proposal ID, guild ID, requester ID, server key, and exact action hash.
- Added a separate owner-approval OAuth route using Discord `identify guilds`:
  - Link consumption is one-time.
  - Discord OAuth state is browser-cookie bound.
  - The current Discord guild owner is required (`guild.owner === true`); Administrator permission alone is explicitly insufficient.
  - The current owner may also be the requester, but must still re-authenticate through the separate one-time approval flow, inspect the exact proposal, and explicitly approve or reject; no agent can approve automatically.
  - The exact proposal is fetched from the gateway and displayed before the decision.
  - Owner identity and guild ownership are checked again when the owner submits Approve or Reject.
  - Decision handles are encrypted, short-lived, and one-time; replay is rejected.
- Added private gateway routes for fetching the exact pending proposal and recording the owner decision. They require a constant-time comparison against `OWNER_APPROVAL_INTERNAL_SECRET`, verify the proposal/guild/requester/action hash/status/expiry, then call the per-guild proposal store.
- Added a private `GATEWAY_SERVER` Service Binding from the auth Worker back to the gateway. The gateway's existing `AUTH_SERVER` binding now includes the owner-session RPC contract.
- Updated README with the new approval flow, private service binding, and secret requirements.
- Kept the OAuth consent catalog and MCP resource server at `mcp:read`; no `mcp:write` scope or Discord write tool is exposed.

## Verification on the latest committed branch

Environment: Node.js 26.12.1, npm 12.2.2, Vitest 4.1.8, Wrangler 4.115.0.

- `npm ci`: PASS.
- `npm run check`: PASS — strict TypeScript and 63 unit tests across 7 files.
- `npm run test:workers`: PASS — 18 Workers runtime integration tests:
  - 8 auth Worker tests (OAuth end-to-end, one-time state/consent storage, owner-only approval, Administrator rejection, separate owner approval by the requester when applicable, one-time link/callback/decision).
  - 10 gateway tests (proposal store state machine, idempotency, owner approval/rejection, concurrency, expiry, immutable audit, internal route secret, proposal binding, action-hash checks).
- Wrangler dry-run: PASS for all seven staging Worker configs and both test Worker configs.
- Scope/security scan: `requiredScopes: ["mcp:read"]`; no `mcp:write` scope in gateway or auth Worker source.
- Secret scan: `OWNER_APPROVAL_INTERNAL_SECRET` is not committed to either deployment Wrangler config; only a fake value exists in the gateway test config.

The OAuth provider emits a non-fatal CIMD-disabled warning. CIMD is not enabled because the tested flow uses dynamic client registration and does not require it.

## Remaining objectives

1. Implement the typed manager Worker write executor for the proposal allowlist, with idempotency, execution leases, bounded retries, and immutable result auditing. Keep role changes (especially bot-role changes), permission overwrites, destructive actions, and bulk operations blocked.
2. Connect the atomic approved-proposal consume and lease-based executor to the five isolated manager Workers.
3. Add end-to-end tests from MCP proposal creation through owner approval and Discord API execution/result recording.
4. Only after end-to-end execution and security tests pass, consider granting `mcp:write`.
5. Configure the same random `OWNER_APPROVAL_INTERNAL_SECRET` in both Workers and create the two private Service Bindings in the real Cloudflare staging environment.
6. Configure the OAuth KV namespace, Discord application credentials, exact five guild IDs, manager Worker tokens, and staging hostnames.
7. Re-run acceptance on Node.js 22, the documented target.
8. Complete the ChatGPT/Claude/Ui.Vision handoff and verify a real Claude MCP client connection. No Claude client connection or Ui.Vision task execution has yet been tested against this gateway.

## Safety state

- No Worker was deployed; all Wrangler commands were dry-runs.
- No Cloudflare staging/production resource, secret, route, or live binding was created or changed.
- No Discord resource or bot role changed.
- All five communities remain independent.
- Existing production managers and Empress Worker remain untouched.
- No scheduler, cron, or recurring automation was created.

## Exact next execution step

Implement the typed manager Worker write executor for already-approved proposals. Add a lease-based execution claim with bounded retry and idempotent Discord API behavior before exposing any actual write tool.
