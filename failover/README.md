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

- **Primary candidate — Botkeep:** one free workload slot, 512 MB RAM, 0.5 vCPU, 1 GB storage, Bun runtime, 24/7 operation, no manual renewals, and no credit card. Use this for the primary LIVE & Events Listener.
- **Standby candidate — Silly Development:** one free server per account, 256 MB RAM, 25% CPU, 512 MB disk, Bun runtime, 24/7 operation, no expiry or renewal, and no credit card. Use this as the standby listener. Its free service has no uptime guarantee, so treat it as a secondary recovery target, not a guaranteed SLA.
- **Coordinator — Cloudflare Workers Free + SQLite Durable Object:** no card is required for the Workers Free offer; SQLite-backed Durable Objects are available on Free. The published allowance is 100,000 Durable Object requests/day and 100,000 SQL rows written/day. A 20-second heartbeat is about 4,320 renewals/day for one listener.

These are candidates, not active deployments. Verify account eligibility, free-slot availability, terms, and dashboard limits before provisioning. Do not create extra accounts to stack a provider's free allocation. Provider references: [Botkeep](https://botkeep.cloud/), [Silly Development](https://sillydev.co.uk/), and [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Deploying the coordinator

1. Create a Cloudflare account using its Free plan; do not select a paid Workers plan.
2. Install Wrangler in a local development environment.
3. From `failover/lease-control`, deploy with `wrangler deploy`.
4. Set the control secret with `wrangler secret put LEASE_CONTROL_TOKEN` using a fresh high-entropy random value. Never commit it.
5. Confirm `GET /health` returns the expected service name.
6. Store the resulting HTTPS Worker URL and the same secret only in the primary/standby listener secret managers as `LISTENER_LEASE_URL` and `LISTENER_LEASE_TOKEN`.

## Safety gate before deployment and cutover

- Do not enable the new listener client on the existing Railway listener.
- Do not start a second Discord Gateway client until both primary and standby use this coordinator and every Discord API request is gated on a valid lease.
- The production listener remains unchanged until an isolated failover build passes integration tests and rollback is ready.
- This foundation is not a completed failover deployment. It still requires Cloudflare deployment, secret configuration, primary/standby provisioning, and two-instance takeover tests.

## Local tests

Run from the repository root:

```sh
node --test failover/tests/*.test.mjs
```

The tests cover the lease state machine and local lease-client safety behavior. They do not replace a live Cloudflare Durable Object integration test.
