# Claude Five-Server Gateway — OAuth Flow Integration Checkpoint

**Date:** 2026-11-16  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** OAuth authorization flow and one-time Durable Object are verified in local Cloudflare Workers runtime. No deployment.

## Completed in this cycle

- Added a test-only Wrangler config at `auth-worker/wrangler.test.jsonc` with fake test credentials, local KV binding, and the Durable Object migration. It is separate from the staging/production config.
- Added MSW and `@msw/cloudflare` to mock Discord OAuth/token/profile/guild requests; tests do not call Discord or require real credentials.
- Added a complete Workers-runtime OAuth flow test covering:
  - Dynamic client registration.
  - PKCE S256 authorization request.
  - Discord authorization redirect and browser-bound state cookie.
  - Rejection of a callback from the wrong browser cookie without consuming the valid state.
  - Discord token/profile/guild exchange.
  - Owner/Administrator filtering to only configured communities.
  - Exclusion of configured non-admin guilds and unconfigured guilds.
  - Login-state replay rejection.
  - Consent handle consumption and replay rejection.
  - Authorization-code exchange and issuance of `mcp:read` without `mcp:write`.
  - Expired/invalid Discord access token fail-closed behavior.
  - Incomplete auth configuration returns HTTP 503.
- Added actual Durable Object alarm testing with Cloudflare's `runDurableObjectAlarm` test helper.
- The Workers runtime exposed a real compatibility defect: Workers do not support `redirect: "error"` for fetch. Changed Discord outbound requests to `redirect: "manual"`; non-2xx/redirect responses fail closed. This behavior is now exercised by the end-to-end tests.
- Updated the standard Vitest command to exclude all integration tests; `npm run test:workers` runs the Cloudflare-specific suites.
- Updated README with the test-only configuration and integration coverage.
- Updated the package lockfile with MSW and Cloudflare integration dependencies.

## Verification on the latest committed branch

Environment: Node.js 26.12.1, npm 12.2.2, Vitest 4.1.8, Wrangler 4.115.0. The test run used isolated local Miniflare/workerd execution and test-only bindings.

- `npm ci`: PASS.
- `npm run check`: PASS — strict TypeScript and 53 unit tests across 6 files.
- `npm run test:workers`: PASS — 5 tests across 2 files in the actual Workers runtime:
  - 2 OAuth end-to-end/fail-closed tests.
  - 3 SQLite Durable Object concurrency, expiry, and alarm tests.
- Wrangler `deploy --dry-run`: PASS for all seven non-test Worker configurations (gateway router, OAuth Worker, and five private manager Workers).
- Wrangler `deploy --dry-run --config auth-worker/wrangler.test.jsonc`: PASS.
- `npm ci` succeeded from the committed lockfile; only the unused `core-js-pure` postinstall remains blocked by npm's install-script policy.

A non-fatal CIMD compatibility warning is emitted by the OAuth provider; CIMD is not enabled and no global-fetch flag was added because the tested DCR flow does not require it.

## Remaining objectives and external blockers

- Node 22 is the documented runtime target; the isolated execution environment used Node 26. Re-run acceptance on Node 22 before release.
- Discord OAuth refresh-token lifecycle remains unresolved. Current access-token expiry fails closed and requires user reauthorization; the returned Discord refresh token is not persisted or rotated.
- Cloudflare staging KV namespace, hostnames, Discord application credentials, exact five guild IDs, and secrets are not configured.
- The Durable Object migration and seven Workers have not been deployed. No Cloudflare resources have been created.
- The gateway Service Bindings are not yet configured between the router, OAuth Worker, and five manager Workers.
- MCP write access remains disabled. Owner-approved write proposals, a separate owner approval step, atomic approval consumption, typed write executor, and audit trail remain unimplemented.
- Claude account/browser integration and Ui.Vision macro handoff are not yet connected to the gateway. The Claude browser session is readable but the current browser connector cannot type/send; Ui.Vision is not exposed as an executable tool in this session.

## Safety state

- No Worker deployment occurred; every Wrangler command was a dry-run.
- No Cloudflare staging or production resources, bindings, routes, or secrets changed.
- No Discord resources or bot roles changed.
- Five Discord communities remain separate and independently scoped.
- Existing production managers and Empress Worker remain untouched.
- No scheduled automation, cron, or recurring repair process was created.

## Exact next execution step

Implement the owner-approved write proposal model and typed approval executor in staging only, keeping `mcp:write` withheld. Add atomic one-time approval consumption, immutable audit records, idempotency keys, expiry, and negative authorization tests before any write tool is advertised.
