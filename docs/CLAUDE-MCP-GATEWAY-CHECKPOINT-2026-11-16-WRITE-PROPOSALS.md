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
- `npm run check`: PASS — strict TypeScript and 63 unit tests across 7 files.
- `npm run test:workers`: PASS — 18 Workers runtime integration tests:
  - 8 auth Worker tests (OAuth, one-time stores, owner approval).
  - 10 gateway Durable Object and private-route tests covering idempotency, verified owner approval in a separate explicit step, rejection, guild/requester/hash binding, concurrent consume, expiry alarms, and audit immutability.
- Wrangler `deploy --dry-run`: PASS for all seven non-test Worker configs (gateway, OAuth Worker, and five private manager Workers).
- Wrangler dry-run: PASS for both isolated test configs (OAuth and gateway proposal store).
- Scope review confirms the gateway still requires `mcp:read`; no `mcp:write` scope or write tool is exposed.

## Remaining objectives

1. The proposal-only `discord_propose_change` tool is implemented: it validates live channel inventory, stores an idempotent proposal, and returns a one-time owner approval URL without executing a Discord write.
2. Implement a typed manager Worker write executor with execution leases, bounded retries, and idempotent Discord API behavior.
3. Connect the proposal-only MCP tool to the executor only after the separate owner approval has been verified and consumed.
4. Add end-to-end tests from MCP proposal creation through owner approval and execution result recording.
5. Only then consider exposing `mcp:write` and actual Discord write tools.
6. Re-run the full acceptance suite on Node 22 before release.
7. Configure actual Cloudflare staging resources, reciprocal Service Bindings, hostnames, shared secret, Discord application credentials, and the five exact guild IDs.

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

Implement the lease-based typed manager Worker write executor for the approved `message.send` and `channel.update` action types. Ensure an expired execution lease can be reclaimed safely, enforce a small retry limit, use Discord message nonce/enforce_nonce for send idempotency, and append each attempt/result to the immutable audit log. Keep `mcp:write` disabled until this passes end-to-end tests.
