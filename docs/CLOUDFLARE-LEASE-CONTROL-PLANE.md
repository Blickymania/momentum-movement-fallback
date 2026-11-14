# Momentum Movement — Cloudflare Lease Control Plane

Updated: 2026-11-13 US Eastern

## Purpose and boundary

This project uses one Cloudflare Durable Object as a control-plane lease coordinator for the Momentum Movement Discord Gateway owner. It is not a Discord bot runtime. The Durable Object and its Worker do not open a Discord Gateway, send Discord messages, mutate guild content, or store Discord OAuth credentials.

The only intended scope is:

`momentum-movement:discord-gateway`

Do not reuse this Durable Object for another server or combine the five independent communities.

## Why Durable Objects are a candidate

Cloudflare documents Durable Objects as single-threaded, globally unique coordination instances with private, persistent storage; SQLite-backed storage is transactional and strongly consistent. This maps well to one logical lease that both primary and standby must acquire. One deterministic namespace ID routes both processes to the same object; SQLite UPSERT/UPDATE statements enforce acquisition, epoch increment, heartbeat renewal and owner/epoch-guarded release.

Cloudflare makes SQLite-backed Durable Objects available on Workers Free and Workers Paid. Current Workers Free limits include:
- Worker inbound requests: 100,000/day.
- Durable Object requests: 100,000/day.
- Durable Object SQLite row reads: 5 million/day.
- Durable Object SQLite row writes: 100,000/day.
- SQLite stored data: 5 GB total.
- Durable Object compute duration: 13,000 GB-s/day.

If any Workers Free limit is exceeded, further operations of that type fail; they do not silently continue as paid overage. Daily limits reset at 00:00 UTC. Account-specific plan, usage and limits must be checked before production use.

Indicative single-guild usage (not a guarantee):
- One primary renewing every 10 seconds: 8,640 Durable Object and Worker requests/day, and approximately 8,640 SQLite row writes/day.
- One standby reading state every 15 seconds: 5,760 Durable Object and Worker requests/day, and approximately 5,760 SQLite row reads/day.
- Combined baseline: about 14,400 requests/day, well below the published 100,000/day Free request limits. Retries, monitoring and other Workers traffic consume additional quota. A missed/failed renewal must always close the primary Gateway; failed coordinator requests must keep the standby disconnected.

This makes the coordination component potentially $0 on an eligible Free account, but it does not remove the cost of the persistent Bot 005/standby hosting runtime. The Cloudflare account's actual plan has not been verified. No Cloudflare billing plan was changed.

Official documentation:
- Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Durable Objects storage: https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- Durable Objects design rules: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Worker pricing and limits: https://developers.cloudflare.com/workers/platform/pricing/ and https://developers.cloudflare.com/workers/platform/limits/

## Components committed

- `cloudflare/gateway-lease-coordinator.mjs`: SQLite-backed Durable Object. It uses a fixed lease scope, 30-second default TTL, 10–120-second accepted TTL range, owner ID, deployment ID, monotonic fencing epoch, expiry and heartbeat timestamp. Acquisition is an atomic UPSERT allowed only when the previous lease has expired. The same active owner ID cannot reacquire its own lease. Renewal and release require the exact owner ID and fencing epoch. Fencing epochs are returned as strings and are checked to stay inside JavaScript's safe-integer range.
- `cloudflare/worker.mjs`: public `GET /healthz` plus bearer-authenticated lease routes. Only `/lease/state`, `/lease/acquire`, `/lease/renew`, and `/lease/release` are forwarded to the Durable Object. A 32–512-character service secret is required. The secret is read from `LEASE_SERVICE_TOKEN`; do not put it in source or Wrangler config.
- `cloudflare/wrangler.jsonc`: SQLite Durable Object binding and initial `new_sqlite_classes` migration.
- `implementation/cloudflare-gateway-lease-client.mjs`: Node-side HTTPS client. It rejects Railway/local/IP-literal endpoints, normalizes trailing-dot hostnames and root Worker URL paths, enforces a 32–512-character service secret, uses a bounded request timeout, maps HTTP 409 to a denied lease (null), and fails closed on timeout/network/server error. The coordinator's state route returns the same `{ ok: true, lease }` envelope as the mutation routes.
- `implementation/gateway-owner-supervisor.mjs`: now accepts either the PostgreSQL lease backend or the new generic `leaseStore` interface. When using Cloudflare, the same supervisor acquires before login, renews by HTTP, destroys on lease loss, and releases after graceful shutdown.
- Tests cover the Durable Object's actual SQLite statement behavior under a Node SQLite simulation, Worker authorization/routing, API client validation/timeouts, and an end-to-end local path from supervisor through Worker/client to the Durable Object.

## Verified test scope

Local Node.js v22.16.0 tests run in an isolated folder using Node's built-in `node:sqlite` and simulated Cloudflare Durable Object context/namespace:
- Durable Object and HTTP API tests: 9 passed.
- Worker/client tests: 9 passed.
- Supervisor-to-Worker-to-Durable-Object local end-to-end ownership test: 1 passed.
- **Total for this Cloudflare control-plane suite: 19 passed, 0 failed.**

This simulates SQLite semantics and the Worker/client path locally. The tests also cover the authenticated state-read route, successful state response envelope, root Worker URL path composition, trailing-dot localhost rejection, and minimum service-secret length. It is not a Cloudflare preview/runtime integration test and does not validate actual Cloudflare account configuration, Durable Object migrations, secret deployment, account-specific quota usage, or network outages at the edge.

The GitHub Actions workflow still fails before job creation with `startup_failure`; these tests have not run in GitHub-hosted Actions. Do not report hosted CI as passing.

## Deployment and secret gates

No Worker has been deployed. No Durable Object namespace has been created. No secret has been set. No Cloudflare account setting, plan, route, DNS record, or billing configuration has been changed.

To deploy later, after account plan and ownership are verified:
1. Confirm the intended Cloudflare account and Workers plan, and review the current account usage and quotas.
2. Generate a random 256-bit-or-stronger secret outside the repository.
3. Configure `LEASE_SERVICE_TOKEN` using Cloudflare's secret store (for Wrangler, `wrangler secret put LEASE_SERVICE_TOKEN`); never include it in a commit.
4. Review the Wrangler plan/migration and confirm the account will create exactly one SQLite-backed Durable Object class.
5. Deploy the Worker/control plane only after explicit user authorization for the Cloudflare resource change.
6. Set the same secret, and the HTTPS Worker URL, only in the isolated candidate runtime environment; do not add either to live Bot 005 yet.
7. Run a Cloudflare-hosted preproduction test with two unique owner IDs, expiry, loss of renewal, and recovery. Do not connect either candidate process to the production Discord Gateway.

## Remaining safety gaps

- Bot 005 has not been adapted to the supervisor or lease store.
- Standby is not deployed and must remain disconnected from Discord Gateway.
- The external hard-stop controller is absent. A Durable Object lease does not terminate or physically fence an old process/socket.
- The Bot 005 source still references `http://coaching-workflow.railway.internal:3000/interaction`; that dependency must move before the full service can be called Railway-independent.
- Discord Manager's `OAUTH_DATABASE_URL` host remains unknown and must be audited without displaying credentials.
- Production failover/failback, Discord handler parity, side-effect fencing, duplicate-event idempotency, and rollback are untested.

## Decision status

**Recommended control-plane candidate: Cloudflare SQLite Durable Object.** It avoids adding a separate Postgres database solely for one lease, and the documented Free-tier quotas appear sufficient for a low-volume single-guild heartbeat/status pattern. This is an architecture recommendation, not an account deployment or production approval. A persistent independent runtime and hard-stop controller remain separate requirements.
