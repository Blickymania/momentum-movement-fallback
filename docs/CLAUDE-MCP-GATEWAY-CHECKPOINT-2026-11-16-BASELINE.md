# Claude Five-Server Gateway — Baseline Verification Checkpoint

**Date:** 2026-11-16  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Scope:** Staging source only. No production deployment or Discord writes.

## Completed in this cycle

- Confirmed the exact staging branch exists and downloaded that branch for isolated execution.
- Bootstrapped npm 12.2.2 in the remote Node.js 26 test environment because that environment supplied Node but no npm executable. No package-manager bootstrap files were added to the repository.
- Fixed the AES-GCM key import TypeScript buffer typing by copying the decoded key bytes into a concrete ArrayBuffer before WebCrypto import.
- Extracted Discord OAuth cookie-state and per-request guild authorization helpers into `auth-worker/src/discord-auth.ts`, allowing their tests to run in ordinary Node/Vitest without importing the Cloudflare-only `cloudflare:workers` runtime module.
- Corrected the manager-client negative test to pass an intentionally invalid runtime resource through the static type boundary.
- Corrected the manager Worker role test fixture to reflect Discord's actual array response for the guild roles endpoint.

## Verification results

Command: `npm run check` (using the bootstrapped npm 12.2.2 shim in the isolated test environment)

- TypeScript strict check: PASS.
- Vitest: PASS — 5 test files, 49 tests passed.
- Wrangler `deploy --dry-run`: PASS for all seven Worker configurations:
  - gateway router
  - OAuth authorization Worker
  - Empress private manager Worker
  - Blickymania private manager Worker
  - BestYouEvaHad private manager Worker
  - Red Kocaine private manager Worker
  - Dawn Dotta private manager Worker

The seven Wrangler checks were dry-runs only; no deployment occurred. The environment used Node.js 26.12.1, not the documented Node 22 target. Re-run the acceptance suite on Node 22 before release.

## Current security and integration blockers

- OAuth login-state and consent-handle consumption still use KV read-then-delete operations, which are not atomic one-time consumption. Replace these paths with a Durable Object transaction or D1 `DELETE … RETURNING` and add concurrent replay tests before deployment.
- OAuth/MCP mock-backend integration tests and full end-to-end conformance tests remain outstanding.
- Discord OAuth refresh-token lifecycle remains unresolved; current behavior requires reauthorization after Discord access-token expiry.
- Cloudflare staging Durable Object/KV bindings, hostnames, Discord app credentials, guild IDs, and secrets remain unconfigured.
- The five private manager Workers and gateway Service Bindings remain undeployed/unconfigured.
- Owner-approved write proposal storage, independent approval UI, atomic approval consumption, audit trail, and typed write executor remain unimplemented. MCP write scope remains withheld.

## Safety and deployment state

- No Cloudflare deployment or staging resource mutation occurred.
- No production deployment, route, secret, or binding changed.
- No Discord server resources or bot roles changed.
- Existing production managers and Empress Worker remain untouched.
- No scheduler or recurring automation was created.
- The five communities remain separate adapters.

## Exact next execution step

Implement the OAuth one-time state and consent-handle store as a dedicated Durable Object with transactional consume semantics. Add concurrent replay tests for both login state and consent handles, wire the binding and migration into the OAuth Worker staging config, then run TypeScript, Vitest, and all Wrangler dry-runs again.
