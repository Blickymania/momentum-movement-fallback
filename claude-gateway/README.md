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

`npm run check` runs strict TypeScript compilation and the regular Vitest suite, including policy, gateway manager-client, per-request authorization, private manager Worker, and one-time-store core tests. `npm run test:workers` runs two isolated Cloudflare Workers Vitest suites: the OAuth Worker using `auth-worker/wrangler.test.jsonc`, and the gateway proposal store using `wrangler.test.jsonc`. Discord HTTP requests are mocked with MSW; no live Discord credentials or external Discord API calls are used. The suites exercise OAuth registration, PKCE authorization, browser-bound callback state, owner/Administrator guild filtering, consent replay rejection, read-only token issuance, fresh Discord reauthorization after an expired credential, the resource Worker’s token audience and expiry checks, 401 reconnect challenge, authenticated MCP reads and approved execution, the separate owner-approval OAuth flow (actual guild owner only, separate explicit owner approval step, one-time link/callback/decision), private gateway approval routes, and the SQLite-backed write-proposal Durable Object (idempotency, explicit rejection, cross-guild/requester/hash checks, concurrent consume, expiry alarms, and immutable audit rows). Unit tests also check the five private manager Wrangler configs, reciprocal service bindings, and required staging placeholders. Test credentials and KV IDs in the test-only Wrangler files are placeholders and are not used by staging or production. The Workers test plugin and pinned dependency graph are included in the package manifest and lockfile.

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
- Every manager read and controlled write enforces the exact guild list captured in the user's OAuth consent, then rechecks the Discord identity, current guild membership, and owner/Administrator permission. The MCP resource Worker checks the stored Discord token expiry before creating a handler, applies a 30-second safety window, and returns HTTP 401 with a Bearer `invalid_token` challenge when the timestamp is missing, expired, or near expiry. MCP OAuth refresh tokens are supported and tested, but refreshing the MCP token preserves the linked Discord credential. The Discord refresh token is not persisted, so an expired Discord credential requires a fresh Discord authorization. End-to-end client reconnect behavior remains a staging acceptance test.
- The OAuth grant currently provides `mcp:read`. `discord_propose_change` validates the live channel inventory, creates an internal pending proposal, and returns a one-time owner approval link. `discord_execute_approved_change` is available to the original requester after the current Discord guild owner separately approves the exact action. The executor consumes the approval atomically, obtains a bounded execution lease, calls only the selected private manager using its distinct write secret, and records the outcome in the immutable audit log. This is not arbitrary write access: only `message.send` and `channel.update` are supported; role and bot-role changes, permission overwrites, deletes, and bulk actions remain excluded.

The auth Worker requires a dedicated KV namespace bound as `OAUTH_KV` for the OAuth Provider's supported grant/client storage.

All seven staging Wrangler templates set `keep_vars: true`. Non-secret runtime variables entered in the Cloudflare dashboard are intended to remain the staging source of truth and will be preserved by later Wrangler deployments instead of being replaced by the blank repository placeholders. This setting does not create or preserve resource bindings; the `OAUTH_KV` namespace ID still needs to be filled into the auth Worker config. See [Cloudflare's Wrangler source-of-truth guidance](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth). The staging Wrangler config now declares this binding with a blank `id` placeholder. Create a dedicated staging KV namespace in the Cloudflare account, then replace only that blank ID with the returned namespace ID before any deployment. Do not reuse a production namespace.

Custom Discord login state and consent handles do **not** use KV. They use the `OAUTH_ONE_TIME_STORE` SQLite-backed Durable Object binding and the `v1` `new_sqlite_classes` migration already declared in `auth-worker/wrangler.jsonc`. Each random state/handle maps to its own Durable Object instance. The store uses one SQLite `DELETE … RETURNING` statement for atomic consumption, checks expiry, and sets a Durable Object alarm to remove abandoned records. The test suite includes concurrent-consume, expiry, and payload/TTL-bound tests. The migration is configuration only until an authorized staging deployment; no Durable Object namespace has been deployed or created yet.

The following values are configured later in the Cloudflare staging environment, never committed as secrets:

- **Auth Worker variables:** `OAUTH_ISSUER_URL`, `MCP_RESOURCE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_REDIRECT_URI`, and all five `GUILD_ID_*` values.
- **Gateway Worker variables:** the same `OAUTH_ISSUER_URL`, `MCP_RESOURCE_URL`, and all five `GUILD_ID_*` values. The five guild IDs must exactly match the auth Worker and the corresponding manager Workers.
- **Each manager Worker variables:** its own matching `DISCORD_GUILD_ID` and its own `DISCORD_APPLICATION_ID`.
- **Auth Worker secrets:** `DISCORD_CLIENT_SECRET`, `AUTH_SESSION_ENCRYPTION_KEY`, and `OWNER_APPROVAL_INTERNAL_SECRET`.
- **Gateway Worker secrets:** the same `OWNER_APPROVAL_INTERNAL_SECRET`, plus five different secrets named `MANAGER_WRITE_SECRET_EMPRESS`, `MANAGER_WRITE_SECRET_BLICKYMANIA`, `MANAGER_WRITE_SECRET_BESTYOUEVAHAD`, `MANAGER_WRITE_SECRET_RED_KOCAINE`, and `MANAGER_WRITE_SECRET_DAWN_DOTTA`.
- **Each manager Worker secrets:** its own `DISCORD_BOT_TOKEN` and its own `MANAGER_WRITE_SECRET`. The manager's `MANAGER_WRITE_SECRET` must match only the corresponding gateway secret above; never reuse one manager's write secret for another manager.

The auth Worker declares a private `GATEWAY_SERVER` Service Binding back to `discord-claude-gateway-staging`; the gateway declares `AUTH_SERVER` plus the five isolated manager Service Bindings. Each manager Worker must be deployed as a separate service with `workers_dev: false`.

Generate the 32-byte AES key locally with `openssl rand -base64 32`. Generate the owner-approval internal secret and each of the five unique manager write secrets independently with `openssl rand -hex 32`. Enter secrets directly through Cloudflare's secret prompts, never into source code, Wrangler vars, GitHub, or chat. The owner-approval internal secret is shared only between the auth and gateway Workers; each manager write secret is shared only between its matching gateway configuration and manager Worker.

## Change proposal and approved-execution MCP tools

`discord_propose_change` is the first controlled write-workflow step, not a Discord write tool. It requires the caller to have current owner/Administrator access to the exact OAuth-consented guild. It reads the selected manager's live channel inventory before storing a proposal. The initial allowlist is:

- `message.send` proposals for text and announcement channels only.
- `channel.update` proposals for text, announcement, and forum channels. Forum layout/archive fields are restricted to forum channels.

Permission overwrites, all role changes (including bot roles), deletes, bulk actions, and unsupported channel types are rejected. The proposal store uses a stable idempotency key; the proposal tool returns a one-time owner approval URL. The current guild owner must inspect the exact action and explicitly approve or reject it through the separate Discord OAuth flow. Proposal creation never performs a Discord write. After approval, the original requester can call `discord_execute_approved_change`; the gateway rechecks current access, consumes the approval once, claims an execution lease, dispatches only to that server's private manager binding, and records the result in the audit log.

## Execution recovery foundation

When an approved proposal is consumed, the Durable Object creates a persistent execution record. The executor foundation supports an atomic claim, a unique fencing token per attempt, lease renewal, stale-worker rejection, retryable versus terminal failures, and a hard three-attempt limit. Expired leases are reclaimed on the next explicit execution attempt; no cron or recurring repair process is created. These recovery primitives are connected to the typed manager write executor. The manager accepts only the two allowlisted action types and validates the separate per-server write secret, guild/channel binding, and approved action fingerprint. OAuth grants remain limited to `mcp:read`; write capability is separately gated by the exact owner-approved proposal and original-requester checks.

## Manager Worker isolation

The same source at `manager-worker/src/index.ts` is intended to be used by five distinct Cloudflare Workers. Each worker has its own Wrangler config:

- `manager-worker/wrangler.empress.jsonc`
- `manager-worker/wrangler.blickymania.jsonc`
- `manager-worker/wrangler.bestyouevahad.jsonc`
- `manager-worker/wrangler.red-kocaine.jsonc`
- `manager-worker/wrangler.dawn-dotta.jsonc`

Each config has `workers_dev: false` and blank guild/application IDs. The gateway config has no public workers.dev endpoint and points to separate staging Service Binding names.

Before any staging deployment, the auth Worker, gateway Worker, and all five manager Worker services must exist. Configure identical five guild IDs in the auth and gateway Workers and the matching `DISCORD_GUILD_ID` in each corresponding manager Worker. Set each manager's correct application ID, unique bot token, and unique write secret, and mirror that write secret only in the corresponding gateway secret. Configure the shared owner-approval secret on the auth and gateway Workers. Never put bot tokens or write secrets in source, Wrangler vars, commits, or chat.

## Current staging bindings

The gateway Service Bindings target:

- `discord-claude-auth-staging`
- `manager-empress-staging`
- `manager-blickymania-staging`
- `manager-bestyouevahad-staging`
- `manager-red-kocaine-staging`
- `manager-dawn-dotta-staging`

No staging deployments or live Service Binding connectivity have been verified. The gateway's `MCP_RESOURCE_URL` and `OAUTH_ISSUER_URL` remain intentionally blank, so requests fail closed with HTTP 503 until staging hostnames are selected and configured.

## Do not deploy yet

The OAuth authorization Worker, MCP gateway Worker, and five private manager Worker templates are implemented. The current staging source passed CI run `43948764504`: strict TypeScript, 87 unit/configuration tests, and 35 Cloudflare Workers integration tests (122 tests total). This is source-level verification only; no live staging deployment, Cloudflare binding connectivity, or real Discord write was performed. The shared owner-approval internal secret, reciprocal Service Bindings, OAuth URLs/client settings, staging KV namespace ID, five guild/application IDs, five bot tokens, and five manager write secrets remain unconfigured or unverified. Real Claude client reconnect acceptance, live staging OAuth, manager connectivity, and rollback testing remain outstanding. Production release requires a separate explicit decision. See [the staging deployment runbook](../docs/CLAUDE-MCP-GATEWAY-STAGING-DEPLOYMENT-RUNBOOK.md) for the reciprocal Service Binding bootstrap sequence, Claude OAuth acceptance, and rollback procedure.
