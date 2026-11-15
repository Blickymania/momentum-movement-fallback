# Claude Five-Server Gateway — Read-Only Adapter Checkpoint

**Date:** 2026-11-15  
**Branch:** `infra/claude-five-server-gateway-staging`  
**Status:** Read-only MCP gateway source and generic private manager adapter source committed. No compile/test run or deployment.

## Added since the initial policy checkpoint

### Gateway
- `claude-gateway/src/index.ts`: OAuth Resource Server wrapper and MCP Streamable HTTP handler.
- Read tools only: list servers, manager status, channels, roles, and command inventory.
- Every manager-specific read calls the authorization Worker to re-check the current Discord membership and owner/Administrator permission.
- The gateway requires `mcp:read`; it has no write tools.

### Private manager adapter
- `claude-gateway/manager-worker/src/index.ts`: generic read-only Discord API adapter.
- Rejects all non-GET requests, unknown paths, query parameters, invalid configuration, and a mismatched fixed guild ID.
- Uses only fixed Discord API v10 GET routes for application identity, bot identity, guild, channels, roles, and guild commands.
- Never accepts arbitrary Discord URLs or paths.
- Does not return the bot token or Discord error bodies.
- Verifies the Discord application identity during status checks.
- Allows array responses for channel, role, and command collections.

### Isolation/configuration
- Five separate Wrangler configs were added under `claude-gateway/manager-worker/`, one for each independent server.
- Each private manager config uses `workers_dev: false`, has no public route, and has blank guild/application IDs until the correct staging values are supplied.
- `claude-gateway/wrangler.jsonc` defines one gateway Service Binding for the auth Worker and one distinct binding for each private manager Worker. It also uses `workers_dev: false`.
- Gateway resource and issuer URLs remain blank and cause HTTP 503 until real staging hostnames are selected.
- `claude-gateway/README.md` records local test commands and release boundaries.

### Tests added
- `claude-gateway/test/manager-client.test.ts`
- `claude-gateway/test/manager-access.test.ts`
- `claude-gateway/manager-worker/test/index.test.ts`
- TypeScript configuration now includes the manager-worker source and tests.

## Important implementation boundary

The gateway and manager adapter are only source-level components at this point. The OAuth authorization Worker that implements `validateToken` and `checkGuildAccess` does not yet exist. The five private manager Worker services do not yet exist in Cloudflare. Therefore the current gateway is not yet deployable or usable by Claude.

No write tools are registered. No approval UI or proposal database exists yet. No Discord write path is exposed.

## Verification status

- GitHub confirms the source files and staging configs were committed to the isolated branch.
- Regex escaping in the Snowflake validator and OAuth scope parser was reviewed and corrected.
- TypeScript compilation: **not run**.
- Vitest: **not run**.
- MCP Inspector/OAuth conformance: **not run**.
- Cloudflare resources, domains, and secrets: **not configured**.
- Discord resources: **unchanged**.
- Existing production managers and Empress Worker: **unchanged**.
- GitHub Actions: **not run**.
- No deployment or production cutover occurred.

## Immediate next milestone

Import this exact branch into a Node 22 environment and run:

```bash
cd claude-gateway
npm install
npm run check
```

Resolve every TypeScript or test failure before implementing the OAuth authorization Worker. Then test the private manager adapter against mocked Discord API responses. Do not deploy the staging configs until the OAuth service and all five private manager services exist and pass the integration/security checks.

**Release gate:** No production deployment or Discord write is authorized by this checkpoint.
