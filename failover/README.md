# Momentum Movement — listener failover foundation

This folder contains an isolated, Dawn Dotta-only failover foundation. It does not alter the recovered production source or any live deployment.

## Control-plane design

- Cloudflare Worker + SQLite-backed Durable Object.
- One fixed lease namespace: `momentum-movement-live-events-listener`.
- A single Durable Object serializes lease transitions and persists the monotonically increasing fencing token.
- The Worker requires `Authorization: Bearer <LEASE_CONTROL_TOKEN>` and exposes only acquire, renew, check, release, and a non-sensitive health endpoint.
- The listener client maintains a conservative local safety deadline and refuses Discord API calls after lease expiry or coordinator rejection.
- The listener must acquire before opening a Discord Gateway connection. A standby instance must not connect until it acquires the lease.

## Isolated listener integration

`failover/listener/index.tsx` is a separate build based on the recovered LIVE & Events Listener. It leaves the root recovery snapshot unchanged. When `LISTENER_RUNTIME_ACTIVE=true`, it requires `LISTENER_LEASE_URL` and `LISTENER_LEASE_TOKEN`, attempts to acquire the lease before connecting to Discord Gateway, remains disconnected while another instance owns the lease, and stops the client when lease ownership is lost. Discord REST calls are gated by the local lease deadline; in-flight calls are aborted when the lease is lost.

The isolated listener still requires a live coordinator URL and secret before it can start. Keep the current Railway listener unchanged until a primary and standby have both been configured and takeover has been verified.

## Free-plan fit (verify before deployment)

Cloudflare's current Free plan documents included daily request, compute-duration, SQL read/write, and storage allowances for SQLite-backed Durable Objects. At a 20-second heartbeat, one listener uses about 4,320 renewals per day. This is below the published 100,000 requests/day and 100,000 SQL rows written/day allowances. Monitor actual usage and keep heartbeat and retry behavior within account limits.

## Recommended no-card runtime layout

- **Primary candidate — Botkeep:** one free workload slot for new signups, 512 MB RAM, 0.5 shared vCPU, 1 GB storage, Bun runtime, 24/7 operation, no manual renewals, and no credit card. It is a beta with no uptime SLA. Use this for the primary LIVE & Events Listener.
- **Standby candidate — Silly Development:** 256 MB RAM, 25% CPU, 512 MB disk, Bun runtime, 24/7 operation, no expiry or renewal, and no credit card. The exact free-server count per account must be checked in the account panel; do not create extra accounts to stack capacity. Its acceptable-use policy prohibits using the service as file storage, a media server, or a CDN, so use it only for the small standby listener, never for the media vault. It has no uptime guarantee.
- **Coordinator — Cloudflare Workers Free + SQLite Durable Object:** the Workers Free plan is the default plan, and SQLite-backed Durable Objects are supported on Free; key-value-backed Durable Objects are not. Published Free allowances include 100,000 Durable Object requests/day, 13,000 GB-s/day, 5 million SQL rows read/day, 100,000 SQL rows written/day, and 5 GB stored SQL data. The listener's 20-second primary heartbeat is about 4,320 renewals/day; a single standby polling every 10 seconds adds at most about 8,640 acquire attempts/day while it is waiting. If any Free limit is exceeded, further operations of that type fail rather than silently upgrading to paid usage. Do not enable Workers Paid or any billable overage.

These are candidates, not active deployments. Verify account eligibility, free-slot availability, terms, and dashboard limits before provisioning. Do not create extra accounts to stack a provider's free allocation. Cloudflare's Free plan is the default, but this research did not independently verify every signup/payment-method prompt; if the dashboard requires a card or paid subscription to enable the required feature, stop and do not proceed. Provider references: [Botkeep Free plan](https://botkeep.cloud/), [Botkeep FAQ](https://botkeep.cloud/faq), [Silly Development Free plan](https://sillydev.co.uk/), [Silly Development terms](https://sillydev.co.uk/terms), [Silly Development acceptable-use policy](https://sillydev.co.uk/acceptable-use), [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), and [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Deploying the coordinator

1. Create a Cloudflare account using its Free plan; do not select a paid Workers plan.
2. Install Wrangler in a local development environment.
3. From `failover/lease-control`, deploy with `wrangler deploy`.
4. Set the control secret with `wrangler secret put LEASE_CONTROL_TOKEN` using a fresh high-entropy random value. Never commit it.
5. Confirm `GET /health` returns the expected service name.
6. Store the resulting HTTPS Worker URL and the same secret only in the primary/standby listener secret managers as `LISTENER_LEASE_URL` and `LISTENER_LEASE_TOKEN`.

## Prepared GitHub Actions deployment path

A manual-only workflow is available at `.github/workflows/deploy-dawn-dotta-lease.yml`. It deploys only the isolated lease coordinator; it does not touch Railway or connect a Discord Gateway client.

Before using it, add these three repository Actions secrets to the private recovery repository:

- `CLOUDFLARE_API_TOKEN` — scoped Cloudflare API token authorized to deploy Workers and manage the SQLite Durable Object binding
- `CLOUDFLARE_ACCOUNT_ID` — the account ID for the Free-plan account
- `LEASE_CONTROL_TOKEN` — a newly generated high-entropy secret used only by this lease coordinator and both listener hosts (generate a 64-character hex value, e.g. `openssl rand -hex 32`)

For the first deployment, Cloudflare currently requires a Workers **Admin** role scoped to the Workers product to create a new Worker; do not grant platform-wide or Zone/R2 permissions. After the Worker exists, rotate the API token to Workers **Editor** scoped to this specific Worker for subsequent deploys and secret updates. See [Cloudflare's Workers authorization guide](https://developers.cloudflare.com/workers/authorization/).

Then open GitHub Actions → **Deploy Momentum Movement lease coordinator** → **Run workflow** and select the recovery branch. The workflow runs the 18 tests, installs Wrangler, writes the secret to a mode-0600 temporary file on the ephemeral GitHub runner, deploys code and secret together with `--secrets-file`, then removes the temporary file. The secret is never committed or echoed. Do not add these secrets to source files, issue comments, build logs, or the Discord bot.

After deployment, capture the Worker HTTPS `workers.dev` URL from the deployment output and set it as `LISTENER_LEASE_URL` on both listener hosts. Set the same `LEASE_CONTROL_TOKEN` as `LISTENER_LEASE_TOKEN` on both. The GitHub workflow does not provision Botkeep/Silly Development accounts and does not perform production cutover.

## Safety gate before deployment and cutover

- Keep the existing Railway listener online and unchanged throughout build and isolated testing.
- The existing Railway listener is not lease-aware. Never activate either new host while that old Railway listener is still connected.
- At cutover, stop/disable the old Railway listener first. Activate Botkeep and verify it acquires the lease and opens the single healthy Gateway; only then activate Silly Development and verify it remains disconnected in standby. Verify exactly one lease holder before declaring cutover complete.
- For rollback, stop both new hosts before restarting the old Railway listener. Never run the old unleased listener alongside a new lease-aware owner.
- If the old Railway listener cannot be stopped safely, do not perform live cutover; keep the new builds in standby.
- This foundation is not a completed failover deployment. It still requires Cloudflare deployment, secret configuration, primary/standby provisioning, and two-instance takeover tests.

## Local tests

Run from the repository root:

```sh
node --test failover/tests/*.test.mjs
```

The tests cover lease state transitions, local lease-client safety, listener wiring, and static coordinator security/readiness configuration. Nineteen test cases are currently defined; do not treat them as passing until an authenticated GitHub Actions run or local Node test run confirms the result. They do not replace a live Cloudflare Durable Object integration test.
