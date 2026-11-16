# Claude Discord Gateway — Local Staging Development

This directory contains the isolated Claude MCP gateway and the reusable private manager Worker source.

## Current scope

- Gateway MCP endpoint: read tools, `discord_propose_change` for owner-approved proposals, and `discord_execute_approved_change` to execute only an exact proposal that the current guild owner has separately approved.
- OAuth: a separate Cloudflare OAuth authorization Worker is implemented and has local Workers-runtime test coverage; it is not yet configured or deployed.
- Manager adapters: one generic private Worker source, intended to be deployed as five separate Workers with independent guild IDs, bot tokens, write secrets, and Service Bindings.
- Discord writes: narrowly limited to `message.send` and allowlisted `channel.update` fields. Each action must first be proposed, reviewed through a one-time owner-only Discord verification flow, approved by the current guild owner, then consumed once by the original requester under an execution lease and immutable audit trail. Role mutations, bot-role changes, permission overwrites, deletes, and bulk actions are not available.
- Production: no routes, secrets, deployments, or Discord changes are authorized by this project checkpoint.

## Run the checks

From this directory in a Node.js 22 environment:

```bash
npm ci
npm run check
npm run test:workers
```

`npm run check` runs strict TypeScript compilation and the regular Vitest suite, including policy, gateway manager-client, per-request authorization, private manager Worker, and one-time-store core tests. `npm run test:workers` runs two isolated Cloudflare Workers Vitest suites: the OAuth Worker using `auth-worker/wrangler.test.jsonc`, and the gateway proposal store using `wrangler.test.jsonc`. Discord HTTP requests are mocked with MSW; no live Discord credentials or external Discord API calls are used. The suites exercise OAuth registration, PKCE authorization, browser-bound callback state, owner/Administrator guild filtering, consent replay rejection, read-only token issuance, expired Discord-token fail-closed behavior, the separate owner-approval OAuth flow (actual guild owner only, separate explicit owner approval step, one-time link/callback/decision), private gateway approval routes, and the SQLite-backed write-proposal Durable Object (idempotency, explicit rejection, cross-guild/requester/hash checks, concurrent consume, expiry alarms, and immutable audit rows). Test credentials and KV IDs in the test-only Wrangler files are placeholders and are not used by staging or production. The Workers test plugin and pinned dependency graph are included in the package manifest and lockfile.

Do not mark the project verified until both commands complete successfully and their full output has been reviewed.

## OAuth authorization Worker

The OAuth Worker source is at `auth-worker/src/index.ts`. It uses the Cloudflare OAuth Provider split-worker API and Discord OAuth sign-in with the minimum Discord scopes `identify guilds`.

- Claude authorization requests are validated with PKCE by the OAuth provider.
- Discord sign-in uses a random state value in a SQLite-backed Durable Object with a 10-minute TTL and atomic consume, bound to a per-flow `__Host-` Secure, HttpOnly, SameSite=Lax browser cookie; the callback rejects state values not present in the initiating browser session.
- The user sees a separate consent page before the MCP grant is issued.
- The consent record, including the temporary Discord user access token, is encrypted with AES-GCM before its five-minute Durable Object lifetime; abandoned records are cleaned up by alarms.
- The OAuth grant props are stored by the OAuth provider's encrypted storage and carry the Discord identity credential for per-call revalidation.
- The auth Worker exposes `validateToken`, `checkGuildAccess`, and `createOwnerApprovalSession` RPC methods over its private Service Binding.
- A separate one-time owner-approval link authenticates through Discord, requires `guild.owner === true` (Administrator is not sufficient), and rechecks ownership at the final approve/reject submission. The auth Worker calls the gateway only through a private Service Binding and a shared internal secret; the gateway rechecks proposal ID, guild, requester, status, and action hash before recording the decision.
- Every manager read enforces the exact guild list captured in the user's OAuth consent, then rechecks the Discord identity, current guild membership, and owner/Administrator permission. Expired Discord user credentials fail closed and require reauthorization.
- The OAuth grant currently provides `mcp:read`. `discord_propose_change` validates the live channel inventory, creates an internal pending proposal, and returns a one-time owner approval link. `discord_execute_approved_change` is available to the original requester after the current Discord guild owner separately approves the exact action. The executor consumes the approval atomically, obtains a bounded execution lease, calls only the selected private manager using its distinct write secret, and records the outcome in the immutable audit log. This is not arbitrary write access: only `message.send` and `channel.update` are supported; role and bot-role changes, permission overwrites, deletes, and bulk actions remain excluded.

The auth Worker requires a dedicated KV namespace bound as `OAUTH_KV` for the OAuth Provider's supported grant/client storage. Create it in the Cloudflare account, then add the returned namespace ID to `auth-worker/wrangler.jsonc` before any deployment. The config intentionally does not contain a namespace ID.

Custom Discord login state and consent handles do **not** use KV. They use the `OAUTH_ONE_TIME_STORE` SQLite-backed Durable Object binding and the `v1` `new_sqlite_classes` migration already declared in `auth-worker/wrangler.jsonc`. Each random state/handle maps to its own Durable Object instance. The store uses one SQLite `DELETE … RETURNING` statement for atomic consumption, checks expiry, and sets a Durable Object alarm to remove abandoned records. The test suite includes concurrent-consume, expiry, and payload/TTL-bound tests. The migration is configuration only until an authorized staging deployment; no Durable Object namespace has been deployed or created yet.

The following values are configured later in the Cloudflare staging environment, never committed as secrets:

- Variables: `OAUTH_ISSUER_URL`, `MCP_RESOURCE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_REDIRECT_URI`, and the five `GUILD_ID_*` values.
- Worker secrets: `DISCORD_CLIENT_SECRET`, `AUTH_SESSION_ENCRYPTION_KEY`, and the same random `OWNER_APPROVAL_INTERNAL_SECRET` on both the gateway and auth Workers. The auth Worker declares a private `GATEWAY_SERVER` Service Binding back to `discord-claude-gateway-staging`; the gateway already declares `AUTH_SERVER`.

Generate the 32-byte AES key locally with `openssl rand -base64 32` and the internal service secret with `openssl rand -hex 32`. Enter the exact same internal secret separately into both Workers using Cloudflare secret prompts. Do not paste either value into chat, source code, or GitHub. The future staging setup must set `OWNER_APPROVAL_INTERNAL_SECRET` on both Workers.

## Proposal-only MCP tool

`discord_propose_change` is the first controlled write-workflow step, not a Discord write tool. It requires the caller to have current owner/Administrator access to the exact OAuth-consented guild. It reads the selected manager's live channel inventory before storing a proposal. The initial allowlist is:

- `message.send` proposals for text and announcement channels only.
- `channel.update` proposals for text, announcement, and forum channels. Forum layout/archive fields are restricted to forum channels.

Permission overwrites, all role changes (including bot roles), deletes, bulk actions, and unsupported channel types are rejected. The proposal store uses a stable idempotency key; the tool returns a one-time owner approval URL. The current guild owner must inspect the exact action and explicitly approve or reject it through the separate Discord OAuth flow. No Discord write is performed at proposal time, and no executor is wired yet.

## Execution recovery foundation

When an approved proposal is consumed, the Durable Object creates a persistent execution record. The executor foundation supports an atomic claim, a unique fencing token per attempt, lease renewal, stale-worker rejection, retryable versus terminal failures, and a hard three-attempt limit. Expired leases are reclaimed on the next explicit execution attempt; no cron or recurring repair process is created. These are recovery primitives only: no Discord API write executor is connected, and `mcp:write` remains disabled.

## Manager Worker isolation

The same source at `manager-worker/src/index.ts` is intended to be used by five distinct Cloudflare Workers. Each worker has its own Wrangler config:

- `manager-worker/wrangler.empress.jsonc`
- `manager-worker/wrangler.blickymania.jsonc`
- `manager-worker/wrangler.bestyouevahad.jsonc`
- `manager-worker/wrangler.red-kocaine.jsonc`
- `manager-worker/wrangler.dawn-dotta.jsonc`

Each config has `workers_dev: false` and blank guild/application IDs. The gateway config has no public workers.dev endpoint and points to separate staging Service Binding names.

Before any staging deployment, the OAuth Worker and all five manager Worker services must exist, the correct guild/application IDs must be configured, and each bot token must be set as a Worker secret using Cloudflare's secret interface. Never put bot tokens in source, Wrangler vars, commits, or chat.

## Current staging bindings

The gateway Service Bindings target:

- `discord-claude-auth-staging`
- `manager-empress-staging`
- `manager-blickymania-staging`
- `manager-bestyouevahad-staging`
- `manager-red-kocaine-staging`
- `manager-dawn-dotta-staging`

Those services do not yet exist. The gateway's `MCP_RESOURCE_URL` and `OAUTH_ISSUER_URL` are intentionally blank, so requests fail closed with HTTP 503 until the real staging hostnames are selected.

## Do not deploy yet

The OAuth authorization Worker is locally compiled and integration-tested but remains unconfigured and undeployed. The per-guild write-proposal Durable Object, immutable audit log, separate Discord owner-approval interface, private gateway decision bridge, and proposal-only `discord_propose_change` MCP tool are implemented and locally tested. The shared internal secret and reciprocal Service Bindings are not configured/deployed. The proposal store now includes persistent execution state, lease renewal, fencing tokens, and a bounded three-attempt retry policy. The typed manager write executor and actual Discord write-tool integration remain outstanding. The five private manager Workers have not been deployed. Run the full source checks first, then complete integration and security tests. Production release requires a separate explicit decision.
