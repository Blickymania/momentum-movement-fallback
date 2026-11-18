# Momentum Movement Worker manager port

**Scope:** Dawn Dotta / Momentum Movement only.  
**Status:** Worker-compatible source and local test harness implemented; Cloudflare account/database/runtime not yet provisioned.

## Files

- src/worker.mjs: HTTP and JSON-RPC/MCP entrypoint.
- src/manager-core.mjs: Worker-compatible manager behavior and the existing three tools.
- src/oauth-routes.mjs: OAuth 2.1 / PKCE routes.
- src/oauth-d1-store.mjs: D1 persistence.
- migrations/0001_oauth_schema.sql: versioned D1 schema.
- wrangler.toml.example: no-secret Worker and D1 binding template.

## HTTP surface

- GET /healthz: process-only liveness, before identity and D1 configuration gates; it makes no credentials or Discord requests.
- GET /readyz: checks deployment identity, D1 connectivity, required OAuth tables and columns when OAuth is enabled, and Discord bot/guild identity.
- POST /mcp: MCP/JSON-RPC endpoint supporting server/discover, initialize, notifications/initialized, tools/list, and tools/call.
- OAuth metadata and routes are delegated to src/oauth-routes.mjs when MCP_OAUTH_ENABLED=true.

## Preserved manager tools

1. discord_manager_status
2. discord_guild_request
3. discord_manager_audit

Security behavior preserved in the core:
- Hard-coded expected guild and application ID checks before serving a tool invocation.
- Bot and guild identity validation before reporting connected.
- Strict Discord API route validation and authorized guild scope.
- Channel ownership is checked before accessing a channel ID directly.
- Writes require WRITES_ENABLED=true, and Discord bot application identity is rechecked before a write.
- Channel/category/role DELETE requests are blocked by the owner-preservation policy.
- New manager-created messages are silent by default (suppress notifications, disable broad mentions and TTS); normal notification mode must be explicitly requested by the caller.
- OAuth bearer tokens are validated for resource and authorized guild; any non-GET discord_guild_request requires mcp:write.
- A static internal MCP bearer secret can be configured with MCP_INTERNAL_BEARER_TOKEN; it must be at least 32 characters. It is not embedded in code or source control.

## Compatibility and external cutover

The previous Railway manager is Bun 1.4.4 and uses Bun SQL/PostgreSQL. The Worker replacement uses Web APIs and D1. The external MCP connector must be deliberately reconfigured to the new Worker URL and approved authentication method after the Worker is deployed and fully tested. No connector, URL, or credential has been changed. Do not reuse the old Railway service key or copy its value into a Worker setting; generate a new dedicated internal bearer secret if that route is needed.

## Tests

The local test suite includes a D1-compatible in-memory SQLite harness and mocks Discord API responses; no production bot token or Discord OAuth secret is used. Manager core tests cover guild isolation, route safety, channel ownership, write gating, deletion blocking and quiet-message defaults. Worker tests cover startup identity, health/readiness, MCP auth and JSON-RPC, tool calls, OAuth bearer authentication, and read/write scope boundaries.

A passing local suite does not prove Cloudflare runtime compatibility, real Discord gateway uptime, account eligibility, free-tier limits, or OAuth redirect registration. Deploy and test only after the owner's no-card Cloudflare account is available.

## Required production secrets (never commit)

- DISCORD_BOT_TOKEN
- DISCORD_OAUTH_CLIENT_ID
- DISCORD_OAUTH_CLIENT_SECRET
- MCP_INTERNAL_BEARER_TOKEN (optional only if all MCP clients use OAuth)

Non-secret variables: AUTHORIZED_GUILD_ID, APPLICATION_ID, MCP_OAUTH_ENABLED, issuer/resource/redirect URLs. Secrets must be supplied via Cloudflare secret bindings, not plain-text vars.
