# Claude Five-Server Gateway — Implementation Checkpoint

**Date:** 2026-11-15  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** Initial read-only MCP gateway source added. Not compiled, tested, deployed, or connected to Claude.

## Work added in this checkpoint

- `claude-gateway/src/manager-client.ts`
  - Defines five distinct Service Binding slots.
  - Uses fixed per-server guild ID configuration.
  - Allows only four internal read resources: status, channels, roles, and commands.
  - Does not accept arbitrary URLs, methods, guild IDs, or Discord REST paths.
  - Fails closed on missing bindings, invalid guild IDs, non-success responses, invalid JSON, and oversized responses.
  - Redacts response fields whose names indicate credentials or secrets.
- `claude-gateway/src/manager-access.ts`
  - Requires a fresh authorization check through the private authorization Worker for every manager read.
  - Requires current guild membership and owner or Administrator permission.
  - Reuses the shared guild/scope policy and defaults all calls to read-only.
- `claude-gateway/src/index.ts`
  - Adds an OAuth-protected MCP resource-server entrypoint.
  - Registers only read tools: list servers, manager status, channels, roles, and command inventory.
  - Requires `mcp:read`.
  - Does not expose write tools.
- `claude-gateway/test/manager-client.test.ts`
  - Adds tests for binding isolation, fixed paths, missing configuration, response validation, and redaction.
- `claude-gateway/test/manager-access.test.ts`
  - Adds tests for current membership, Administrator checks, read scope, and fail-closed configuration.
- `claude-gateway/wrangler.jsonc`
  - Adds a staging-only configuration with `workers_dev: false`.
  - Service Binding names are explicitly separated for OAuth and each of the five manager Workers.
  - Resource and issuer URLs are deliberately blank; the gateway returns HTTP 503 until real values are configured.
  - Referenced staging services do not yet exist and have not been deployed.

## What is still missing

1. The OAuth authorization Worker, including Discord sign-in, user session, consent, owner/Administrator verification, token issuance, refresh, revocation, and the RPC methods `validateToken` and `checkGuildAccess`.
2. Five private staging manager Workers implementing the internal read protocol. The existing production managers are not being repurposed.
3. Real staging guild IDs and domain names, to be configured only after the corresponding staging services and security design are reviewed.
4. The proposal database, authenticated approval UI, one-time approval consumption, audit records, and typed write executor.
5. Automated build and test execution.

## Verification state

- GitHub confirmed the files were committed to the staging branch.
- Static source review only; TypeScript compilation and Vitest have not been run.
- No Cloudflare resources were created or modified.
- No secrets were added.
- No Discord resources were changed.
- No GitHub Actions workflow was run.
- No deployment or production cutover occurred.

## Next steps

1. Run `npm install` and `npm run check` from `claude-gateway/` in a Node environment.
2. Fix all compile and test failures before expanding the implementation.
3. Implement the Discord OAuth authorization Worker and its per-call guild authorization RPC.
4. Implement the five private manager adapters using test-only/mock Discord backends first.
5. Add the immutable proposal and external owner-approval system.
6. Complete integration and security tests before any staging deployment.

**Release gate:** No production deployment or Discord write is authorized by this checkpoint.
