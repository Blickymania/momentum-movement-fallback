# Dawn Dotta HTTP Manager — Northflank test deployment

**Status: prepared only. No Northflank project, service, build, payment method, or deployment has been created.**

This runbook applies only to the stateless Dawn Dotta HTTP/MCP Manager. It does not apply to any of the six Discord Gateway workloads and must not be used to enable Gateway takeover or production routing.

## 1. Existing application — reuse, do not rebuild

- Repository: `Blickymania/momentum-movement-fallback`
- Branch: `infra/dawn-dotta-cloudflare-worker`
- Build context: repository root
- Dockerfile: `render/Dockerfile`
- Container runtime: Bun 1.4.4
- Container port: `10000`
- Entrypoint: `bun run manager.ts`
- Health / liveness: `GET /healthz`
- Readiness: `GET /readyz`

The Dockerfile already copies the recovered Manager into the Bun image. Northflank supports a custom Dockerfile in a subdirectory when its path and root build context are specified. Keep the existing Dockerfile and application source; do not convert this service to Node.

## 2. Sandbox and billing gates

Northflank's published Developer Sandbox includes two services, two jobs, one database add-on, and up to $20/month of Northflank Cloud resources. A one-build-service plus one-deployment-service arrangement uses the two service slots. Keep PostgreSQL on the existing Neon staging branch; do not create a Northflank database add-on.

Important unresolved account-level limits:

- Northflank's public pricing page says the Sandbox needs no card, but its billing documentation says a payment method may be required before resources can be created.
- The public quota documentation says free projects have separate compute limits but does not give a complete Sandbox-specific CPU/RAM/build-plan matrix.
- The current public compute-plan table lists `nf-compute-50` (0.5 vCPU / 1 GiB) for deployment. The first listed plan marked for builds is `nf-compute-400-16` (4 vCPU / 16 GiB). Actual Sandbox eligibility and build-minute/resource treatment must be confirmed in the account before creating either resource.
- Northflank's billing documentation describes a default $50 billing threshold that can create an invoice and charge the default payment method. A billing alert is an email/notification, not a hard spend cap.

**Stop conditions:** Do not add a payment card, buy credits, select Pay as You Go, attach BYOC, upgrade the account, or create a service if the account cannot guarantee that the work stays inside the free Sandbox allowance without a paid charge. Do not use a billing threshold as a spending limit.

Official references:
- https://northflank.com/pricing
- https://northflank.com/docs/v1/application/billing/pricing-on-northflank
- https://northflank.com/docs/v1/application/billing/resource-plans-and-quotas
- https://northflank.com/docs/v1/application/billing/billing-thresholds
- https://northflank.com/docs/v1/application/billing/monitor-spending

## 3. Proposed Northflank layout — not yet created

Use one project in the Northflank region closest to the existing Neon `aws-us-west-2` staging database (prefer Northflank `us-west` if offered to this account).

1. Link the Northflank Git integration to GitHub with access limited to this private repository.
2. Create one **build service** from the requested branch. Choose Dockerfile, root build context, and `render/Dockerfile`. Do not enable automatic builds for every push; use manual build/release while this is a test.
3. Create one **deployment service** from the build output. Use one instance only, no autoscaling, and no persistent volume.
4. Configure public HTTP port `10000`. Configure liveness at `/healthz` and readiness at `/readyz`.
5. Keep the Northflank project on Developer Sandbox. Do not select a paid plan to satisfy a resource selector. If the free plan cannot run the Docker builder or Manager at the available quota, stop and report the blocker instead of upgrading.

The two-service layout is compatible with the published Sandbox service count, but the actual free build plan and CPU/RAM quota still need account verification.

## 4. Resource sizing

**Sandbox test target:** `nf-compute-50` (0.5 vCPU / 1 GiB), one Manager instance, only if the account allows it within the Sandbox allowance. Published list price is $12/month when run continuously; this is a resource-price reference, not a forecast of Sandbox charges.

**Initial production candidate:** `nf-compute-100-2` (1 vCPU / 2 GiB), one instance, published list price $24/month. This is the preferred starting production size for the HTTP Manager pending real memory/CPU measurements. If measured load requires more headroom, `nf-compute-200` (2 vCPU / 4 GiB) is listed at $48/month.

Additional published usage rates include $0.06/GB egress and $0.11657/GiB/month for persistent NVMe. The Manager is stateless and should not need a persistent disk. Builds and runtime are billed by usage; confirm the exact build-plan charge in the account before starting a build.

## 5. Runtime variables and secrets

Set values only in Northflank's encrypted runtime-variable / secret interface. Never put secret values in this repository, build arguments, Dockerfile, logs, or chat.

| Variable | Purpose |
|---|---|
| `PORT` | `10000` (already defaulted by the Dockerfile) |
| `DISCORD_BOT_TOKEN` | Manager bot credential for read-only identity and guild checks |
| `AUTHORIZED_GUILD_ID` | Momentum Movement guild scope |
| `APPLICATION_ID` | Expected Manager bot application identity |
| `WRITES_ENABLED` | Must be `false` for the entire test |
| `MANAGER_SERVICE_KEY` | Temporary test bearer key; code still accepts legacy `RAILWAY_SERVICE_KEY` for compatibility |
| `MCP_OAUTH_ENABLED` | `true` when testing the staging database readiness check |
| `OAUTH_DATABASE_URL` | Existing Neon **staging** connection string only |
| `DISCORD_OAUTH_CLIENT_ID` | OAuth provider client ID, needed only for an authorized OAuth-flow test |
| `DISCORD_OAUTH_CLIENT_SECRET` | OAuth provider secret, needed only for an authorized OAuth-flow test |
| `DISCORD_OAUTH_REDIRECT_URI` | New Northflank URL ending in `/oauth/callback`, after the hostname exists and callback is approved |
| `OAUTH_ISSUER_URL` | New Northflank HTTPS origin |
| `OAUTH_RESOURCE_URL` | New Northflank HTTPS origin plus `/mcp` |

For the first deployment, use only the Neon staging endpoint. Do not point this service at a production database. The readiness route checks the five existing OAuth tables with read-only `to_regclass` queries when OAuth is enabled; it does not run schema creation or insert/update token rows. Do not call `/register`, `/oauth/authorize`, `/oauth/token`, or `/oauth/revoke` during the initial smoke test.

## 6. Test sequence

1. Confirm the container builds and starts.
2. Confirm `GET /healthz` returns HTTP 200.
3. With `WRITES_ENABLED=false`, confirm `GET /readyz` returns HTTP 200 only after the expected Discord bot, Momentum guild, and (when OAuth is enabled) Neon staging database/schema checks pass.
4. Confirm an invalid/missing bearer key receives HTTP 401 on `POST /mcp`.
5. With the temporary test bearer key, run JSON-RPC initialize and tools/list.
6. Run only the read-only `discord_manager_status` tool. Do not issue a modifying `discord_guild_request`.
7. Verify container restart behavior and logs contain no credential values.
8. Keep the service isolated. No live MCP client is redirected to it.

The GitHub workflow adds a container build/start smoke test using no secrets. It expects `/healthz` to return 200 and `/readyz` to fail closed with 503 when credentials are deliberately absent.

## 7. Explicitly out of scope

- No production route, Cloudflare Worker, router variable, DNS, OAuth callback, or existing Railway/Render service is changed.
- No Gateway process is deployed, fenced, started, stopped, or transferred.
- No Gateway lease is acquired, renewed, or released.
- No Northflank resources are created until account billing and Sandbox eligibility are confirmed.
- No paid service or production cutover is authorized by this runbook.
