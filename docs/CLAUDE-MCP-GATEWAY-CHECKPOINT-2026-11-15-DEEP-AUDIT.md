# Claude Five-Server Gateway — Deep Audit Checkpoint

**Date:** 2026-11-15  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Latest audit commit:** `7c3131aa3eb8dff5638b2e56edc9e4a105cca98b`  
**Verification status:** Source reviewed and targeted fixes committed; TypeScript and Vitest have NOT been executed.

## Scope inspected

- MCP gateway entrypoint and OAuth resource-server boundary.
- OAuth authorization Worker and consent flow.
- Per-request Discord guild authorization.
- Private manager Worker and its five isolated Wrangler configurations.
- Typed write policy and single-use approval helper.
- Manager client response handling and redaction.
- Unit tests, package scripts, TypeScript config, and staging documentation.

## Security/correctness defects fixed

1. **OAuth consent guild list was not enforced on tool calls.** The authorization Worker saved `authorizedGuildIds` in the encrypted OAuth grant props, but the gateway did not check that list before accessing a manager. A user who later gained Administrator rights in another configured community could potentially use an existing grant without consenting to that community. The gateway now passes the grant's approved guild list into the MCP tool handler and checks the selected fixed guild ID against it before the live Discord authorization RPC.
2. **Discord user IDs were not validated at the gateway boundary.** Per-request authorization now rejects malformed user IDs before making the authorization Service Binding call.
3. **Duplicate configured guild IDs could undermine five-server separation.** The manager client now rejects reads when two configured managers share the same valid guild ID, and reports those managers as not configured in the public configuration summary.
4. **A unit test asserted the wrong authorization RPC arguments.** The test now checks the full user ID, guild ID, and Discord access-token argument sequence.
5. **Documentation drift.** The README and staging plan now distinguish implemented source from unconfigured/untested infrastructure and no longer claim that the OAuth Worker or reusable manager Worker source is absent.

## Added/updated test coverage

- OAuth-consented guild allowlist is enforced before current Discord authorization is called.
- Malformed Discord user IDs fail closed before the authorization RPC.
- Duplicate configured guild IDs fail closed and are not reported as configured.
- Authorization RPC test expectation includes all three arguments.

## Important remaining findings

- The Discord OAuth access token refresh lifecycle is not implemented. Expired Discord credentials fail closed and the user must reconnect; this is safe but not a complete refresh experience.
- The immutable write-proposal store, separate owner approval UI, atomic one-time approval consumption, durable audit events, and typed write executor are not implemented.
- OAuth/MCP end-to-end integration and conformance tests are not implemented.
- The five private manager Workers and OAuth Worker are source/config templates only; no new Cloudflare staging resources, secrets, KV namespace, hostnames, or Service Bindings have been configured.
- All current MCP tools remain read-only. No Discord write operation is exposed by this gateway.
- The project still requires a real Node 22 environment to run `npm install` and `npm run check`. A previous GitHub Actions attempt failed before any job started, so it did not compile or run tests.
- StackBlitz was still showing the unrelated `node.new Starter` workspace during the latest browser inspection. Do not run checks against that starter workspace.

## Safety state

- No production deployment or branch merge.
- No Cloudflare resources or secrets changed.
- No Discord resources, bot roles, permissions, or assignments changed.
- No existing production manager or Empress Worker changed.
- No credentials added to source or documentation.

## Next verification gate

1. Import the exact staging branch into a clean Node 22/WebContainer environment.
2. Run `npm install` and `npm run check`; capture full output.
3. Fix all compile and unit-test failures, then rerun until clean.
4. Add mocked integration tests for OAuth state/consent, token expiry, grant guild allowlist, Service Binding isolation, and manager identity.
5. Complete the remaining security architecture before considering any staging deployment.
