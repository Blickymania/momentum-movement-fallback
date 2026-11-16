# Claude Five-Server Gateway — Persistent Write Proposal Store Checkpoint

**Date:** 2026-11-16  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** Persistent proposal state machine and immutable audit store implemented and verified in local Workers runtime. No deployment and no Discord writes.

## Completed in this cycle

- Added `WriteProposalStore`, a SQLite-backed Durable Object exported by the gateway Worker and bound as `WRITE_PROPOSAL_STORE`.
- Added the gateway `v1` SQLite Durable Object migration and a separate test-only Wrangler config.
- The intended deployment model is one proposal-store Durable Object instance per guild, preserving separation between the five independent manager deployments.
- Added pending → approved/rejected → consumed/expired transitions.
- Proposal creation revalidates the typed action using `validateProposedAction`, binds the guild and server key, hashes the normalized action with SHA-256, enforces a 10-minute maximum TTL, and supports unique idempotency keys.
- Owner approval/rejection requires a different user from the requester and an internal `verifiedGuildOwner` assertion. The assertion is documented as trusted gateway input that must come from the private Auth Worker after checking current Discord guild ownership; it is not exposed as an MCP input.
- Consumption is atomic and one-time: the original requester, guild, and exact action hash must match, and one SQLite state transition marks the proposal consumed.
- Expiry alarms mark pending/approved proposals expired and append audit events.
- Added an append-only audit table with SQLite triggers blocking UPDATE and DELETE. It records creation, approval, rejection, consumption, expiry, and execution result events.
- Execution result metadata is allowlisted and bounded; the system actor is recorded as `gateway`.
- No write executor or MCP write tool was added. The OAuth grant and MCP resource server still require `mcp:read` only.

## Verification on the latest committed branch

Environment: Node.js 26.12.1, npm 12.2.2, Vitest 4.1.8, Wrangler 4.115.0.

- `npm ci`: PASS.
- `npm run check`: PASS — strict TypeScript and 56 unit tests across 6 files.
- `npm run test:workers`: PASS — 12 Workers runtime integration tests:
  - 5 OAuth and one-time OAuth store tests.
  - 7 write-proposal Durable Object tests covering idempotency, independent owner approval, rejection, guild/requester/hash binding, concurrent consume, expiry alarms, and audit immutability.
- Wrangler `deploy --dry-run`: PASS for all seven non-test Worker configs (gateway, OAuth Worker, and five private manager Workers).
- Wrangler dry-run: PASS for both isolated test configs (OAuth and gateway proposal store).
- Scope review confirms the gateway still requires `mcp:read`; no `mcp:write` scope or write tool is exposed.

## Remaining objectives

1. Build the separate owner approval interface and trusted Discord owner authentication path. The gateway must obtain owner verification directly from the private Auth Worker; never accept a caller-supplied boolean.
2. Add gateway proposal creation/status/approval routing, with per-guild authorization and requester binding.
3. Add the typed manager write executor, initially restricted to allowlisted non-destructive operations. Keep role mutations, bot-role changes, permission-risk operations, destructive operations, and bulk actions blocked unless separately authorized.
4. Add end-to-end tests from proposal creation through owner approval and execution result recording.
5. Only then consider exposing `mcp:write` and the write tools.
6. Re-run the full acceptance suite on Node 22 before release.
7. Configure actual Cloudflare staging resources, service bindings, hostnames, secrets, Discord application credentials, and the five exact guild IDs.

## Important security limitation

The proposal store's `verifiedGuildOwner` field is an internal assertion. It is not itself cryptographic proof. Until the owner approval interface is connected to the private Auth Worker and that service verifies `isOwner === true` for the exact guild, the proposal store must not be called from any public/MCP approval route. The current code does not do so. No write tools are advertised.

## Safety state

- No deployment occurred; all Wrangler commands were dry-runs.
- No Cloudflare staging or production resource, secret, binding, or route changed.
- No Discord resource or bot role changed.
- All five communities remain independent.
- Existing production managers and Empress Worker remain untouched.
- No scheduler or recurring automation was created.

## Exact next execution step

Implement the separate owner approval OAuth/session flow in the auth Worker. It must bind an approval session to a single proposal ID and guild ID, verify the authenticating Discord user is the current guild owner (not merely Administrator), consume the session once, and provide the gateway with a trusted internal verification result. Keep proposal approval and all writes disabled until this flow passes integration tests.
