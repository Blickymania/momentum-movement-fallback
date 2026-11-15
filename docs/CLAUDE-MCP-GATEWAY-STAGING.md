# Claude Five-Server Discord Manager — Staging Plan

**Status:** Design checkpoint; staging branch only. No Cloudflare deployment, no secrets configured, no Discord changes, no production routing changes.

## Owner constraints

- Preserve five separate communities and deployments: Empress Reigns, Blickymania, BestYouEvaHad, Red Kocaine, and Dawn Dotta / Momentum Movement.
- Do not merge guild data, permissions, bot identities, databases, or operational history.
- Do not modify bot roles: names, permissions, hierarchy, positions, or assignments.
- Do not modify the existing Empress Worker or any current production manager.
- No GitHub Actions, Railway, or Render deployment dependency.
- Never put bot tokens, OAuth client secrets, database URLs, or service keys in source, commits, logs, or chat.
- No production changes until staging, security, and acceptance tests pass.
- Read, audit, prepare changes, and execute specifically approved writes are desired capabilities.

## Live baseline inspected 2026-11-15

All five existing Discord manager connectors reported:
- Discord connection: connected.
- Bot identity: verified and matches its configured application.
- Authorized guild identity: verified and reachable.
- Existing manager configuration: writesEnabled=true on all five.

The existing write-enabled state is pre-existing and was not changed by this project. The new gateway must not assume that the existing managers are read-only. It must never forward an unapproved write, and must use its own authorization and exact-action approval boundary.

Dawn Dotta's available read-only audit reported:
- 106 channels, 12 roles, 11 forums, 15 categories, 36 guild commands.
- One forum uses List View; this is the Academy forum exception and should not be treated as a defect.
- Case Review has an unexpected View Channel grant requiring separate review.
- A Level 50 Lounge category/channel is still present and requires owner review.
- The audit made no changes.

Other four managers have been verified connected and their role/channel inventories were read using GET requests only. No resources were changed.

Read-only inventory counts and managed-role names:
- Dawn Dotta: 106 channels, 12 roles; managed roles include Blickymania Bot 005 and Railway Agent.
- Blickymania: 87 channels, 10 roles; managed roles include Blickymania Bot and Railway Agent (plus Discord-managed Server Booster).
- BestYouEvaHad: 88 channels, 10 roles; managed roles include Blickymania Bot 004 and Railway Agent.
- Empress Reigns: 108 channels, 19 roles; managed roles include Yammie Gang Server Bot, Railway Agent, TikTok (plus Discord-managed Server Booster).
- Red Kocaine: 91 channels, 10 roles; managed roles include Blickymania Bot 003 and Railway Agent (plus Discord-managed Server Booster).

These names are recorded only to protect the current bot-role inventory. No bot role, role assignment, permission, position, or hierarchy was modified.

## Target topology

One public HTTPS MCP endpoint for Claude, one separate OAuth authorization Worker, and five isolated manager Workers behind private Cloudflare Service Bindings:

1. Claude custom remote MCP connector -> one HTTPS /mcp endpoint on discord-claude-gateway.
2. discord-claude-auth handles OAuth discovery, client registration, Discord sign-in/consent, token issuance, refresh, and revocation.
3. discord-claude-gateway validates tokens by Service Binding to the authorization Worker, resolves an explicit guild selection, and checks the signed-in user's per-guild authorization grant.
4. The gateway calls only that guild's private manager Worker through its dedicated Service Binding.
5. Each manager Worker contains only that server's guild ID and bot token secret.
6. The OAuth Worker has its own KV namespace. The gateway has a SQLite-backed Durable Object for immutable change proposals, single-use approvals, idempotency, and audit records. Operational guild data is never combined.

The five manager Workers must not have public routes or public workers.dev endpoints. The gateway is the only Worker configured with bindings to them. The OAuth Worker is bound only to the gateway's resource-server validation interface. The existing Empress Worker is out of scope and must not be repurposed.

## Claude compatibility

- Use a remote MCP server over Streamable HTTP at /mcp.
- Use OAuth rather than a shared bearer key.
- Support Dynamic Client Registration, PKCE S256, authorization-code flow, refresh-token rotation, revocation, and resource metadata.
- Register Claude's callback https://claude.ai/api/mcp/auth_callback when the chosen OAuth registration mode requires an explicit callback allowlist. Also accommodate the currently documented claude.com callback if Anthropic changes it.
- Claude Free currently permits one custom connector, so expose one aggregate gateway rather than five separate connectors.
- The MCP endpoint must be public HTTPS on port 443; Claude connects from Anthropic's cloud, not from the user's local browser.

## Authentication and guild authorization

- Authenticate the user through Discord OAuth using only the required identity and guild-membership scopes.
- For every requested guild, verify current membership and require the guild owner or Administrator permission before granting management access.
- Never trust a guild ID supplied by Claude without checking it against the signed-in user's grant and the target manager's hard-coded guild ID.
- Issue a short-lived, revocable access token. Bind each grant to the user ID, client ID, allowed guild IDs, scopes, and resource audience.
- Enforce mcp:read and mcp:write separately.
- Recheck authorization on every tool call; do not rely only on connector setup-time permissions.

## Tool surface

Read tools:
- discord_list_servers
- discord_manager_status
- discord_manager_audit
- discord_list_channels
- discord_list_roles
- discord_get_channel
- discord_get_role
- discord_get_member
- discord_get_command_inventory

Write workflow:
- discord_propose_change: validates a typed action, guild scope, caller permissions, bot permissions, role hierarchy, protected-resource policy, and creates an immutable proposal.
- discord_get_proposal: returns the exact diff, target guild, resource IDs, and expiration.
- discord_approve_proposal: approval occurs through a separately authenticated owner approval page; Claude cannot approve its own proposal.
- discord_apply_approved_change: applies the one-time, unexpired approval after revalidating current Discord state and permissions.
- discord_cancel_proposal: invalidates a pending proposal.

Do not expose a generic unrestricted Discord REST proxy as a write tool. Use typed operations with allowlisted routes and schemas. Deny role CRUD and role permission/hierarchy/assignment mutations by default. Deny all channel/category/role deletions by default. Any future exception requires separate, specific owner authorization and a dedicated reviewed workflow.

## Mandatory safety controls

- Default gateway mode: read-only.
- STAGING_WRITES_ENABLED=false until all security and integration tests pass.
- Production write gate remains closed until a separate explicit release decision.
- Exact-action, single-use approval is bound to user, guild, method, resource, normalized payload hash, and expiration.
- Approval is obtained outside Claude through an authenticated owner-controlled page; no model/tool call can mint its own approval.
- Revalidate guild ownership, Discord bot identity, permissions, role hierarchy, resource ownership, and current object version immediately before applying.
- Idempotency key and durable audit event for every attempted write.
- Fail closed on missing scope, ambiguous target, stale approval, API uncertainty, rate limit, or identity mismatch.
- Do not expose secrets or raw OAuth tokens in tool results or logs.
- Do not enable automatic broad permissions, bulk edits, or unattended destructive actions.
- Protect owner-authored messages and all bot roles.
- No @everyone notifications except separately authorized SOS workflow.

## Deployment layout

Suggested Cloudflare Workers:
- discord-claude-auth: public OAuth authorization endpoints; bound to its dedicated OAUTH_KV namespace.
- discord-claude-gateway: public MCP endpoint, OAuth resource checks, guild selection, proposal and approval orchestration; bound to discord-claude-auth, the approval Durable Object, and five managers.
- manager-empress: private single-guild Discord adapter.
- manager-blickymania: private single-guild Discord adapter.
- manager-bestyouevahad: private single-guild Discord adapter.
- manager-red-kocaine: private single-guild Discord adapter.
- manager-dawn-dotta: private single-guild Discord adapter.

Each child manager gets only its own bot token and authorized guild ID. The gateway uses Cloudflare Service Bindings to reach the private managers. No child manager receives another server's credentials. OAuth storage is dedicated to the gateway and is not used as a shared operational database.

Use Cloudflare's maintained @cloudflare/workers-oauth-provider library for OAuth 2.1 rather than extending the custom single-guild OAuth implementation. Use its documented split-worker pattern: OAuthAuthorizationServer in discord-claude-auth, OAuthResourceServer in discord-claude-gateway, and token validation over a Service Binding. The library supports client registration, PKCE, refresh/revocation, resource audiences, and OAuth metadata. The combined OAuthProvider form exists, but the split model is preferred for this trust boundary.

Use a dedicated SQLite-backed Durable Object for exact-action proposals, one-time approvals, idempotency, and append-only audit events. Its transactional storage is preferable to KV for single-use approval consumption. The gateway OAuth KV namespace and approval Durable Object are central authorization infrastructure only; they do not contain merged guild operational data.

Cloudflare's published Free allowances currently include 100,000 Worker requests/day, 10 ms CPU per invocation, 100,000 KV reads/day, 1,000 KV writes/day, and 100,000 Durable Object requests/day with SQLite storage. These are hard limits: overages fail rather than silently becoming paid usage. Enforce a fail-closed usage budget and monitor consumption. Service Bindings do not add a separate charge and can reach Workers without public routes. Re-check pricing and limits before deployment.

The existing Dawn Hyperdrive configuration remains isolated to the Dawn staging source and is not required for the central OAuth store in this design. Do not assume it is attached to a deployed Worker. Keep it unchanged and do not repurpose the Dawn Neon database for another community.

## Staging and verification sequence

1. Create and test the gateway protocol implementation locally/in a browser Node environment.
2. Build a generic single-guild manager adapter and unit-test guild isolation and typed tool allowlists.
3. Create five isolated staging Worker configurations with no secrets and no public routes.
4. Configure Service Bindings and verify the gateway cannot address an unbound manager.
5. Integrate @cloudflare/workers-oauth-provider with a dedicated KV namespace and test Claude DCR, callback, PKCE, refresh rotation, revocation, token audience, and guild authorization with synthetic identities.
6. Test read-only Discord access first, without changing production.
7. Test all write workflows against a mocked Discord API or a separate test guild. Never test writes against the five production guilds during staging.
8. Perform security tests: cross-guild ID injection, wrong-user access, expired/revoked token, replayed approval, altered payload, role hierarchy violation, protected role mutation, delete attempts, prompt-injected tool output, rate limits, and missing bindings.
9. Connect Claude only after the remote endpoint passes MCP Inspector and OAuth conformance tests.
10. Review acceptance evidence. Production release remains a separate, explicit decision.

## Acceptance criteria

- Claude can connect through one custom connector.
- One authenticated user can select only guilds for which they are owner/administrator.
- Each manager Worker can reach only its own guild and bot credential.
- Read-only tools work for all five managers.
- Write proposals are fully typed, previewed, and independently approved.
- An approval cannot be reused, altered, transferred to another user, or applied to another guild.
- Protected bot roles and destructive operations remain blocked.
- OAuth tokens refresh and revoke correctly.
- Production resources, current managers, current routing, and all five Discord servers remain unchanged throughout staging.
- No GitHub Actions, Railway, or Render deployment dependency exists.

## Current blockers

- Only the Dawn Dotta Worker source branch is available in this repository. Source code for the other four manager connectors has not been recovered into this project.
- The existing Dawn source is single-guild and includes a generic Discord request tool. It is not safe to expose directly to Claude with writes enabled. Its current custom OAuth code should not be reused as the new gateway's OAuth provider; use the maintained Cloudflare OAuth provider library.
- The Cloudflare account inventory previously showed only the separate Empress Worker; no dedicated Dawn or other manager Workers were present at that inspection.
- Cloudflare deployment and secret configuration tools are not available in this session. Browser access currently provides read-only page inspection.
- Claude connector creation must be completed by the user in their Claude account after the public HTTPS endpoint exists.

No deployment or production change is authorized by this plan.
