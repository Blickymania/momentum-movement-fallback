# Claude Five-Server Gateway — OAuth and Private Adapter Checkpoint

**Date:** 2026-11-15  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** OAuth authorization Worker source added; read-only MCP gateway and generic private manager adapter source present. Not compiled, tested, or deployed.

## OAuth authorization Worker added

Path: `claude-gateway/auth-worker/src/index.ts`

- Uses the official Cloudflare Workers OAuth Provider split-worker API.
- Validates incoming Claude authorization requests, including client, redirect URI, resource, response type, and PKCE.
- Redirects users through Discord OAuth with `identify guilds` scopes.
- Uses a random one-time OAuth state stored with a ten-minute KV TTL.
- Verifies the Discord identity and checks configured guild membership at sign-in.
- Requires the Discord guild owner or Administrator permission in at least one configured community before issuing an MCP grant.
- Presents a separate read-only consent page with an explicit Allow/Deny decision.
- Encrypts the short-lived consent record with AES-GCM before storing it in KV.
- Stores the Discord user access token inside the OAuth provider's encrypted grant props, not in MCP tool output or source.
- Exposes `validateToken` and `checkGuildAccess` RPC methods for the gateway's private Service Binding.
- Rechecks the Discord user's current identity, membership, and owner/Administrator permission on every manager-specific read.
- Grants `mcp:read` only. `mcp:write` is deliberately withheld until the separate proposal and approval executor exists.
- Fails closed if OAuth URLs, Discord app configuration, session encryption key, or KV binding are missing.

Auth Worker config template: `claude-gateway/auth-worker/wrangler.jsonc`. It has no public workers.dev endpoint and has blank URLs, Discord client ID, redirect URI, and guild IDs. The dedicated KV namespace must be created and its ID added to the config before deployment. The Discord client secret and AES-GCM key must be added as Worker secrets through Cloudflare, never committed.

## Updated gateway

- The MCP gateway's OAuth props now include the Discord identity credential.
- Each manager read passes that credential over the private Auth Worker Service Binding for a fresh guild authorization check.
- The gateway still registers read-only MCP tools only.
- The OAuth provider resource server still requires `mcp:read`.

## Added test coverage

- `claude-gateway/auth-worker/test/index.test.ts`: verifies owner/Admin membership, identity mismatch, missing membership, OAuth authorization errors, and invalid IDs.
- `claude-gateway/manager-worker/test/index.test.ts`: verifies private read-only behavior, fixed guild scoping, identity checks, and token non-disclosure.
- `claude-gateway/test/manager-access.test.ts`: verifies per-request authorization and fail-closed behavior.
- `claude-gateway/test/manager-client.test.ts`: verifies isolated service binding reads, strict resource allowlist, and redaction.
- `claude-gateway/tsconfig.json` includes source and tests for all three Worker components.

## Remaining work

1. Import the exact staging branch into a Node 22 environment and run `npm install` and `npm run check`.
2. Fix all compiler and test failures before further expansion.
3. Create the dedicated OAuth KV namespace and add its ID to the auth Worker config.
4. Configure real staging hostnames, Discord application credentials, exact redirect URI, and the five authorized guild IDs through Cloudflare settings only.
5. Implement and test the five separate private manager Workers using test-only/mock Discord backends first.
6. Add the immutable write proposal store, authenticated external owner approval UI, atomic one-time approval consumption, and audit log.
7. Add integration, OAuth conformance, MCP Inspector, and security tests.
8. Deploy only to staging after the full acceptance suite passes. Production remains a separate release decision.

## Verification and safety state

- GitHub confirms source/config/checkpoint files are committed to the isolated staging branch.
- Source was reviewed for fixed service binding routing, strict GET-only manager paths, fresh Discord authorization, missing-config fail-closed behavior, and credential redaction.
- TypeScript compilation: **not run**.
- Vitest: **not run**.
- OAuth/MCP end-to-end tests: **not run**.
- Cloudflare KV, domains, Worker secrets, and service bindings: **not configured**.
- No Cloudflare deployment occurred.
- No Discord resources changed.
- Existing production managers and Empress Worker remain untouched.
- No GitHub Actions, Railway, or Render deployment was run or added as a deployment dependency.

**Release gate:** This source checkpoint does not authorize production deployment or Discord writes.
