# Momentum Movement failover — hosting and continuation checkpoint

Updated: 2026-11-13
Scope: Dawn Dotta / Momentum Movement only. No other community may be changed.

## Current production read-only verification

Railway project: Dawn Dotta / Momentum Movement (`a1d6b0e4-3169-4c5d-add3-84a70f7dc525`).
Production environment: `c72ea3d9-2c1c-4651-a265-79723e317fa5`.

Latest environment status call:
- 34 services checked; no pending/staged work.
- Dawn Dotta Discord Manager (`596b402b-936b-490e-97c7-d41d9ed87caf`) is online; deployment `f878c9c8-4513-4d44-9a80-d546096d074f` is SUCCESS; one running replica; zero warnings, criticals, or recent failures.
- OAuth PostgreSQL (`3e71f6b5-a248-40b6-b185-a748a5f5b436`) is online; deployment `c231847f-46aa-4808-a026-106062f2f860` is SUCCESS; one running replica; zero warnings, criticals, or recent failures.
- The only service issue in the returned inventory is Dawn Dotta News Forum 24h Retention Cleanup (`23249d7e-6ced-438d-aae2-a82947aa23bd`): CRASHED deployment `582277d8-108d-4d22-b214-0286be447404`, 0/1 replicas, one critical issue. The known root cause remains the retired Discord forum target returning 404. Do not modify or redeploy while the account's expired-trial restrictions block a permitted deployment path.
- No Railway production configuration, service, database, secret, schedule, or Discord resource was changed.

## GitHub Actions recheck

- Repository: `Blickymania/momentum-movement-fallback`.
- Branch: `infra/dawn-dotta-cloudflare-worker`.
- Run rechecked: `43543501851`.
- Dedicated workflow-jobs endpoint returned an empty jobs array.
- Workflow YAML read-back remains a simple push/PR workflow with one Ubuntu job, checkout, Node 22 setup, npm install, and npm check.
- The run therefore still has no runner or step evidence. Do not claim CI passed or rewrite application code to compensate for a pre-job failure.
- GitHub's current documentation confirms push workflows can run from non-default branches when the workflow exists on the pushed ref. Thus, merely keeping this workflow on the feature branch is not sufficient to explain the failure. No repository settings or workflow mutation was made.
- GitHub Actions remains an external/control-plane blocker until the run metadata changes or the repository Actions settings/diagnostic are inspected.

## New hosting candidate reviewed: Hostless

Official Hostless product and documentation pages now advertise:
- A no-card, no-expiry free allowance and always-on apps/background workers.
- Background workers explicitly support long-running queue consumers and processes that do not serve HTTP.
- Shared allowance documentation states 0.5 vCPU, 1 GiB RAM, and 512 MiB database storage across the account; capacity above the allowance requires a payment method or qualifying credit.
- The spending-limit documentation explicitly says existing resources can continue running and still incur charges after the limit blocks new paid capacity. Therefore a spending limit is not a guaranteed invoice cap.

References:
- https://hostless.cloud/
- https://docs.hostless.cloud/overview
- https://docs.hostless.cloud/app/workers
- https://docs.hostless.cloud/plans/limits

Assessment:
- Hostless is a promising *evaluation candidate* for an isolated, low-resource always-on connector process and is more promising than Render Free for process persistence.
- Official documentation reviewed did not establish static egress IPs, private peering to Railway, or guaranteed outbound SSH/TCP behavior needed by the prepared Railway CLI tunnel. No actual egress test or account provisioning was performed.
- The legal/privacy pages surfaced in search did not provide sufficient independently verified enterprise/security assurance for placing a production Railway project token or database-connectivity secret there.
- Do not deploy production credentials, create an account resource, enable billable capacity, or connect the production database to Hostless yet.
- If evaluated later, first use a non-production dummy secret and isolated network probe; confirm outbound SSH/TCP, resource accounting, account free allowance, and actual billing safeguards. Only after successful evidence should the host be reconsidered. Do not expose Railway PostgreSQL publicly.

## Source review

- Re-read current Worker, router, and Wrangler config from the feature branch.
- Confirmed the Worker remains hard-bound to the Momentum Movement guild/application IDs and destructive channel/category/role deletion is blocked.
- Confirmed the router only fails over GET/HEAD after transport errors; non-read requests are forwarded once and never automatically replayed.
- No source code change was justified in this cycle. No untested speculative security patch was committed.
- Previous test evidence remains: 33/33 isolated V8 source-invariant harness assertions and 3/3 native Node connector-script tests. These are not a full TypeScript/Wrangler/DB/runtime test suite.

## Infrastructure and safety status

- Prepared Railway SSH + Cloudflare Tunnel connector remains isolated in GitHub and has only mocked lifecycle validation.
- No trusted persistent connector host is yet verified.
- No Cloudflare Tunnel, VPC Service, Hyperdrive binding, Worker deployment, DNS change, public DB proxy, or production cutover exists.
- Existing Railway Manager remains authoritative and untouched.
- No cron, reminder, scheduler, monitor, or recurring automation was created or changed.

## Exact next execution step

Continue the independent verification path without waiting for a "NEXT" prompt:
1. Investigate Hostless only as a non-production candidate; establish outbound TCP/SSH and actual free-tier capacity/billing behavior before any secret is introduced.
2. Continue local/offline TypeScript and Wrangler validation using an executable environment that does not require a paid host; preserve the distinction between source harnesses and native build tests.
3. Continue to keep GitHub Actions and the retired cleanup service documented as blockers until new evidence or a permitted control-plane path is available.
4. Keep Railway production, private database exposure, Cloudflare resources, credentials, and all Discord content unchanged.
