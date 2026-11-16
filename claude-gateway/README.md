# Claude Discord Gateway — Local Staging Development

This directory contains the isolated Claude MCP gateway and the reusable private manager Worker source.

## Current scope

- Gateway MCP endpoint: read-only tools only.
- OAuth: a separate Cloudflare OAuth authorization Worker source is implemented and exposed to the gateway through a Service Binding; it is not yet configured, compiled, tested, or deployed.
- Manager adapters: one generic read-only Worker source, deployed as five separate private Workers only after staging setup.
- Writes: not exposed. No role mutations or destructive operations.
- Production: no routes, secrets, deployments, or Discord changes are authorized by this project checkpoint.

## Run the checks

From this directory in a Node.js 22 environment:

```bash
npm install
npm run check
```

The check runs strict TypeScript compilation and the Vitest suite, including the policy, gateway manager-client, per-request authorization, and private manager Worker tests.

Do not mark the project verified until both commands complete successfully and their full output has been reviewed.

## OAuth authorization Worker

The OAuth Worker source is at `auth-worker/src/index.ts`. It uses the Cloudflare OAuth Provider split-worker API and Discord OAuth sign-in with the minimum Discord scopes `identify guilds`.

- Claude authorization requests are validated with PKCE by the OAuth provider.
- Discord sign-in uses a one-time random state value with a 10-minute KV lifetime.
- The user sees a separate consent page before the MCP grant is issued.
- The consent record, including the temporary Discord user access token, is encrypted with AES-GCM before its five-minute KV storage lifetime.
- The OAuth grant props are stored by the OAuth provider's encrypted storage and carry the Discord identity credential for per-call revalidation.
- The auth Worker exposes `validateToken` and `checkGuildAccess` RPC methods over its private Service Binding.
- Every manager read enforces the exact guild list captured in the user's OAuth consent, then rechecks the Discord identity, current guild membership, and owner/Administrator permission. Expired Discord user credentials fail closed and require reauthorization.
- The current consent catalog grants `mcp:read` only. Write scope is deliberately withheld until the independent proposal/approval executor is implemented.

The auth Worker requires a dedicated KV namespace bound as `OAUTH_KV`. Create it in the Cloudflare account, then add the returned namespace ID to `auth-worker/wrangler.jsonc` before any deployment. The config intentionally does not contain a namespace ID.

The following values are configured later in the Cloudflare staging environment, never committed as secrets:

- Variables: `OAUTH_ISSUER_URL`, `MCP_RESOURCE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_REDIRECT_URI`, and the five `GUILD_ID_*` values.
- Worker secrets: `DISCORD_CLIENT_SECRET` and `AUTH_SESSION_ENCRYPTION_KEY`.

Generate the 32-byte AES key locally with `openssl rand -base64 32`. Enter it only through the Cloudflare secret prompt. Do not paste it into chat, source code, or GitHub.

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

The OAuth authorization Worker source exists but remains unconfigured, uncompiled, untested, and undeployed. The immutable write-proposal store, separate owner approval UI, and OAuth/MCP mock-backend integration tests remain outstanding. The five private manager Workers have not been deployed. Run the full source checks first, then complete integration and security tests. Production release requires a separate explicit decision.
