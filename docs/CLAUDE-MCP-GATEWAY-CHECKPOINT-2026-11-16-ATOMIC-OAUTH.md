# Claude Five-Server Gateway — Atomic OAuth Consumption Checkpoint

**Date:** 2026-11-16  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** Atomic one-time OAuth state and consent storage implemented and committed; source checks pass; no deployment.

## Completed in this cycle

- Added `OAuthOneTimeStore`, a SQLite-backed Durable Object.
- Added `AtomicOneTimeStoreCore`, which stores one expiring record per random state/consent handle.
- The auth Worker derives a separate Durable Object ID from each random login-state or consent handle, avoiding a single global hot object.
- Login state and consent payloads are no longer stored in KV. They are stored in the Durable Object; `OAUTH_KV` remains for OAuth Provider-managed grant/client storage.
- Consumption uses one SQLite `DELETE … RETURNING` statement. The record is removed atomically by the database statement, and only the caller receiving the deleted row can use it.
- TTLs are bounded (1–600 seconds), payload size is bounded (32 KiB), expiry is checked at consume, and a Durable Object alarm clears abandoned records.
- Added the `OAUTH_ONE_TIME_STORE` binding and SQLite class migration `v1` to `auth-worker/wrangler.jsonc`.
- Updated the current README to document the new storage path and the not-yet-deployed migration.

## Verification results on the latest committed branch

Environment: Node.js 26.12.1, npm 12.2.2 bootstrapped in an isolated remote execution workspace. The workspace did not include npm by default; npm 12 was used after npm 10 encountered an Arborist dependency-tree exception. The repository was not changed by the bootstrap.

- `npm run check`: PASS.
- TypeScript strict compilation: PASS.
- Vitest: PASS — 6 test files, 52 tests passed.
- Wrangler `deploy --dry-run`: PASS for all seven Worker configurations (gateway router, auth Worker, and five independent manager Workers).
- Static check confirms no KV read/delete path remains for custom Discord login state or consent handles.
- The OAuth Worker dry-run recognizes the SQLite Durable Object binding.

## Test limitation

The new one-time-store unit tests use an in-memory SQL adapter to test the core's SQL statements, expiry handling, payload limits, and competing-consume behavior. They do not yet execute the Durable Object against Cloudflare's actual SQLite-backed runtime. Add a Workers/Miniflare integration test for the real Durable Object before staging deployment.

## Remaining objectives

1. Add real Workers runtime integration tests for SQLite Durable Object initialization, alarm cleanup, and concurrent RPC consumes.
2. Add OAuth/MCP mock-backend integration tests for authorization redirect, browser-bound state, consent, token expiry, and fresh per-request guild authorization.
3. Decide and implement a secure Discord OAuth refresh-token lifecycle, or keep the documented reconnect-on-expiry behavior with explicit UX.
4. Configure the Cloudflare staging KV namespace, Durable Object migration, hostnames, Discord app credentials, exact guild IDs, and secrets. No such resources or secrets are configured yet.
5. Deploy only to staging after runtime integration and security acceptance tests pass.
6. Implement owner-approved write proposal storage, external owner approval, atomic approval consumption, audit log, and typed write executor. MCP write scope remains withheld.

## Safety state

- No Worker was deployed. Wrangler commands were dry-runs only.
- No production deployment, route, secret, binding, or Discord resource changed.
- No Discord bot roles changed.
- All five communities remain isolated.
- Existing production managers and Empress Worker remain untouched.
- No scheduler or recurring automation was created.

## Exact next execution step

Add a real Cloudflare Workers test harness for `OAuthOneTimeStore` and prove concurrent RPC consumption returns the record to exactly one caller. Then add a test proving the alarm removes an unconsumed expired record. Keep the test harness staging-only and do not deploy.
