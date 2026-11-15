# Claude Discord Gateway — Local Staging Development

This directory contains the isolated Claude MCP gateway and the reusable private manager Worker source.

## Current scope

- Gateway MCP endpoint: read-only tools only.
- OAuth: gateway expects a separate authorization Worker Service Binding; that Worker is not implemented yet.
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

The OAuth authorization Worker, approval database/UI, and integration tests remain outstanding. The five private manager Workers have not been deployed. Run tests first, then complete OAuth and mock-backend integration tests. Production release requires a separate explicit decision.
