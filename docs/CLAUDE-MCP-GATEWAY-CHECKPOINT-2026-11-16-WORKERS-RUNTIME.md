# Claude Five-Server Gateway — Workers Runtime Verification Checkpoint

**Date:** 2026-11-16  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** SQLite Durable Object integration tests added; latest committed branch passes unit, Workers runtime, and Wrangler dry-run checks. No deployment.

## Completed in this cycle

- Added the official `@cloudflare/vitest-plugin` Workers runtime integration harness, pinned at 1.8.3, compatible with the project's Vitest 4.1.8.
- Added `vitest.workers.config.ts` targeting the OAuth Worker Wrangler configuration and the one-time-store integration test file.
- Added a separate `npm run test:workers` script so Cloudflare runtime tests do not run in the standard Node/Vitest suite.
- Added `package-lock.json` and exact allowlist entries for the required `workerd` and `esbuild` postinstall scripts. The unused `core-js-pure` postinstall remains blocked.
- Added actual Workers-runtime tests using the SQLite-backed Durable Object through RPC:
  - Concurrent consumers race for one stored value; exactly one receives it.
  - Expired records are not returned by the real Durable Object.
- Added core-level coverage for the record clear path used by the Durable Object alarm handler.
- Updated README install/test commands to use `npm ci`, `npm run check`, and `npm run test:workers`.

## Verification on the latest committed branch

Environment: Node.js 26.12.1, npm 12.2.2, Wrangler 4.115.0, Vitest 4.1.8. The environment was isolated from production credentials and resources.

- `npm ci`: PASS.
- `npm run check`: PASS — strict TypeScript compilation and 53 unit tests across 6 files.
- `npm run test:workers`: PASS — 2 tests against the real local Cloudflare Workers runtime/SQLite Durable Object.
- Wrangler `deploy --dry-run`: PASS for all seven Worker configurations (gateway, OAuth Worker, and five independent manager Workers).
- npm install-script review: only the unused `core-js-pure` script remains blocked; required `workerd` and `esbuild` scripts are pinned and allowlisted.

The Cloudflare test runtime emits a non-fatal CIMD compatibility warning from the OAuth provider. No additional global-fetch compatibility flag was added because it is not required for the current test behavior.

## Remaining verification limitations and blockers

- The alarm cleanup handler's core clear operation is unit-tested, but scheduled alarm delivery has not been independently observed in a test.
- The environment used Node 26, not the documented Node 22 target. Re-run the acceptance suite on Node 22 before release.
- Full OAuth/MCP integration tests remain outstanding: Discord OAuth redirect and token exchange mocks, browser-bound state, consent replay, access-token expiry, and per-request authorization across all five guild bindings.
- Discord OAuth refresh-token lifecycle remains unresolved; current behavior requires reauthorization after Discord access-token expiry.
- Cloudflare staging KV namespace, Durable Object migration, hostnames, Discord app credentials, guild IDs, and secrets remain unconfigured.
- Five private manager Workers and gateway Service Bindings remain undeployed/unconfigured.
- Owner-approved write proposal storage, separate owner approval UI, atomic approval consumption, audit trail, and typed write executor remain outstanding. MCP write scope remains withheld.

## Safety state

- No Worker was deployed. Wrangler commands were dry-runs only.
- No Cloudflare staging or production resources/secrets changed.
- No Discord server resources or bot roles changed.
- The five communities remain independent.
- Existing production managers and Empress Worker remain untouched.
- No scheduler or recurring automation was created.

## Exact next execution step

Build an OAuth/MCP mock-backend integration test suite inside the Workers runtime. Verify login-state one-time consumption, consent-handle one-time consumption, owner/Admin guild filtering, token expiry fail-closed behavior, and per-request guild authorization without using live Discord credentials or changing Cloudflare resources.
