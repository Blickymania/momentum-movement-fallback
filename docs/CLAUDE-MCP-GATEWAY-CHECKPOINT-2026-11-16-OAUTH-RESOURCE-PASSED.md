# Claude MCP Gateway Checkpoint — 2026-11-16 — OAuth Resource Worker Verified

## Project and component
- Repository: `Blickymania/momentum-movement-fallback`
- Staging branch: `infra/claude-five-server-gateway-staging`
- Components: OAuth authorization Worker, OAuth-protected MCP resource Worker, isolated manager adapters, and Durable Object proposal/audit store.
- Scope: five independent Discord communities; no merging.

## Completed cycle
- Added an OAuth-protected resource Worker integration suite using the real exported Worker `fetch` handler, Cloudflare Workers Vitest runtime, an in-process MCP client, and mocked private Auth Worker/manager bindings.
- Added coverage for:
  1. Unauthenticated request receives an OAuth Bearer challenge.
  2. Valid resource-bound token permits MCP tool discovery and manager read after current Discord Administrator verification.
  3. Valid token and current Admin identity can execute an already owner-approved proposal for the original requester.
  4. A token validated for a different resource audience is rejected.
  5. Missing or near-expiry Discord credential is rejected with a 401 `invalid_token` reconnect challenge before manager or guild access calls.
- The 30-second Discord token expiry safety window is implemented in `src/manager-access.ts` as `assertDiscordCredentialCurrent` and is called before the MCP handler is created.
- Staging auth Wrangler config now declares a dedicated `OAUTH_KV` binding with a blank namespace ID placeholder. This is configuration-only; no namespace has been created or deployed.
- README now explicitly documents that Discord refresh tokens are not persisted and automatic Discord-token refresh is not implemented. Expired/near-expiry Discord credentials require a new Discord authorization/reconnect. Actual Claude UI reconnect remains a staging acceptance test.
- The resource Worker test is included in `vitest.write.config.ts`; the test harness uses mock service bindings and does not call production Discord APIs.

## Test and verification evidence
- Final clean CI run: `43946251424`
- Run commit: `c1de85ca637a4994faeae520d19c9a909c24a948`
- Run conclusion: `success`
- `npm ci --no-audit --no-fund`: passed.
- `npm run check`: TypeScript passed; 84 unit tests passed across 9 files.
- `npm run test:workers`:
  - Auth Worker: 8 integration tests passed across 3 files.
  - Proposal/owner-approval/MCP/resource Worker suite: 24 integration tests passed across 4 files.
  - Resource Worker suite: 5 tests passed.
  - MCP handler suite: 4 tests passed.
- Total verified tests: 116 passed.
- Workflow is least-privilege (`contents: read`), uses `npm ci`, runs both suites, and does not deploy.

## Staging commits and concurrent additions
- `2d015b37c49223ae073d80e99f84f31a9af1a0eb` — add fail-closed Discord credential expiry guard.
- `fe5e2d16e8dfee2c1281e1f06d238f43a6da372a` — add Discord credential expiry/reconnect unit coverage.
- `5cadfd2865c651096831449dc708635ae243a441` — document expiry/reconnect behavior.
- `9c8668d63f24680385ea0a1fb22b0ec3df74f462` — declare the staging `OAUTH_KV` binding with blank ID.
- `0542a2f78140b2410c0ed2c5a15e592266f5e83f` — clarify dedicated staging KV namespace setup and refresh-token limitation.
- `55074a664538b7f6bf522e317ae4f4fbbae29e06` — add resource Worker expiry/reconnect test coverage.
- `c1de85ca637a4994faeae520d19c9a909c24a948` — corrected test formatting and verified the new expiry/reconnect test suite.
- Previous checkpoint `bcafed0c35ebc6e4d8ea0f6b34306df0ad744266` records the MCP handler integration cycle.

## Remaining objectives
1. Inspect all five manager Worker staging configs and the MCP resource/auth Worker Service Bindings. Verify each server has a unique fixed guild ID, private manager Service Binding, and distinct per-server bot credential/write secret binding. Do not reveal or copy secret values.
2. Verify the auth Worker `OAUTH_KV` namespace and resource/auth Worker Service Bindings are ready for staging. The blank KV namespace ID must be supplied from the user's Cloudflare account before staging deployment.
3. Test the full OAuth authorization-code/Discord consent/token issue/reconnect lifecycle with mocked Discord OAuth/API endpoints. Confirm a new authorization flow replaces the expired Discord credential and restores manager access.
4. Decide whether automatic Discord refresh-token persistence is necessary. It is currently intentionally not implemented; do not store refresh tokens until rotation, encryption, and concurrent-refresh handling are designed and tested.
5. Complete actual Claude client connection and reconnect acceptance. This requires a real client authorization interaction; Browser connector is read-only and no Ui.Vision workstation is registered, so do not claim those interactions were executed.
6. Keep production deployment, production branch merge/cutover, Discord resource writes, and all bot-role changes out of scope until staging acceptance is complete and a separate release decision is made.

## Safety and scheduler state
- No production deployment or production Discord resource change.
- No bot roles changed; preserve bot-role names, permissions, hierarchy, positions, and assignments.
- No secret values read, copied, or written.
- No schedulers, cron jobs, reminders, or recurring maintenance created or changed.
- CI is read-only and test-only; it does not deploy.
- No production release authorized.

## Last verified state
- Clean lockfile install: passed.
- TypeScript and unit tests: passed (84).
- Auth Worker integration tests: passed (8).
- Proposal/owner-approval/MCP/resource Worker integration tests: passed (24).
- Total: 116 passing tests.
- CI run `43946251424`: completed successfully.
- Staging source includes a fail-closed Discord expiry guard and a 401 reconnect challenge.
- Automatic Discord refresh is not implemented; reconnect requires a new Discord OAuth authorization.
- Production state unchanged.

## Exact next execution step
Inspect the five manager Worker configuration files and resource/auth Wrangler configuration. Produce a non-secret staging readiness matrix showing each manager's fixed guild binding, private service binding, credential binding, write-secret binding, and whether any required staging IDs/values remain blank. Do not deploy or read secret values.
