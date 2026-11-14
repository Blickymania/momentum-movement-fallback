# Momentum Movement — Cloudflare Lease Control Plane

Updated: 2026-11-13 US Eastern

## Purpose and boundary

This project uses one Cloudflare Durable Object as a control-plane lease coordinator for the Momentum Movement Discord Gateway owner. It is not a Discord bot runtime. The Durable Object and its Worker do not open a Discord Gateway, send Discord messages, mutate guild content, or store Discord OAuth credentials.

The only intended scope is:

`momentum-movement:bot-005-gateway`

Do not reuse this Durable Object for another server or combine the five independent communities.

## Why Durable Objects are a candidate

Cloudflare documents Durable Objects as single-threaded, globally unique coordination instances with private, persistent storage; SQLite-backed storage is transactional and strongly consistent. This maps well to one logical lease that both primary and standby must acquire. One deterministic namespace ID routes both processes to the same object; SQLite UPSERT/UPDATE statements enforce acquisition, epoch increment, heartbeat renewal and owner/epoch-guarded release.

Cloudflare makes SQLite-backed Durable Objects available on Workers Free and Workers Paid. Current Workers Free limits include:
- Worker inbound requests: 100,000/day.
- Durable Object requests: 100,000/day.
- Durable Object SQLite row reads: 50 million/day.
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

- `cloudflare/gateway-lease-coordinator.mjs`: SQLite-backed Durable Object. It uses a fixed lease scope, 30-second default TTL, 10–120-second accepted TTL range, owner ID, deployment ID, monotonic fencing epoch, expiry and heartbeat timestamp. Acquisition is an atomic UPSERT allowed only after the prior lease expires and only when the exact prior owner/epoch has been hard-fence confirmed for the exact candidate. The same active owner ID cannot reacquire its own lease. **The Durable Object itself now checks that every owner ID is prefixed by its deployment ID** during bootstrap and acquire; fence confirmation validates both the previous owner's stored deployment binding and the candidate's deployment binding before recording the fence. Renewal and release require the exact owner ID and fencing epoch. Fencing epochs are returned as strings and stay inside JavaScript's safe-integer range.
- `cloudflare/worker.mjs`: public `GET /healthz`, bot-authenticated lease routes, one-time operator-only `/lease/bootstrap`, and bot-facing `/fence`. Direct `/lease/fence/confirm` is not public; only the Worker calls it over the internal Durable Object stub. Ordinary lease routes use `LEASE_SERVICE_TOKEN`; bootstrap uses `LEASE_BOOTSTRAP_TOKEN`; fence requests use deployment-scoped tokens from the secret `FENCE_REQUEST_TOKENS_JSON`. Only the Worker holds `RENDER_API_KEY` and `RENDER_SERVICE_IDS_JSON`. Never put Render or bootstrap credentials in either Bot runtime.
- `cloudflare/wrangler.jsonc`: SQLite Durable Object binding and initial `new_sqlite_classes` migration.
- `implementation/cloudflare-gateway-lease-client.mjs`: Node-side HTTPS client. It rejects Railway/local/IP-literal endpoints, normalizes trailing-dot hostnames and root Worker URL paths, enforces a 32–512-character service secret, uses a bounded request timeout, maps HTTP 409 to a denied lease (null), and fails closed on timeout/network/server error. The coordinator's state route returns the same `{ ok: true, lease }` envelope as the mutation routes.
- `implementation/gateway-owner-supervisor.mjs`: accepts either the PostgreSQL lease backend or the generic `leaseStore` interface. When using Cloudflare, the supervisor acquires before login, renews by HTTP, destroys on lease loss, and releases after graceful shutdown.
- `implementation/discord-gateway-ownership-guards.mjs`: wraps Discord client login, event listeners, Discord REST requests, and global outbound fetch. It fails closed without an active lease and rejects Railway hostnames unconditionally.
- `implementation/fenced-discord-gateway-owner.mjs`: candidate preparation adapter. It must be called immediately after constructing the Discord client and before registering event listeners. It prepares the Cloudflare lease client, installs guards, and only then allows the supervisor to call login. A denied lease leaves the client disconnected. The adapter is not yet integrated into recovered Bot 005 source.
- Tests cover the Durable Object's actual SQLite statement behavior under a Node SQLite simulation, Worker authorization/routing, API client validation/timeouts, and an end-to-end local path from supervisor through Worker/client to the Durable Object.

## Verified test scope

Local Node.js v22.16.0 tests run in an isolated folder using Node's built-in `node:sqlite` and simulated Cloudflare Durable Object context/namespace:
- Durable Object and HTTP API tests: 9 passed.
- Worker/client tests: 9 passed.
- Supervisor-to-Worker-to-Durable-Object local end-to-end ownership test: 1 passed.
- Gateway ownership-guard tests: 6 passed.
- Prepared Discord owner adapter tests: 2 passed.
- Standby hard-stop controller tests: 8 passed.
- **Combined Cloudflare control-plane + Bot 005 fencing + hard-stop orchestration suite: 35 passed, 0 failed.**

This simulates SQLite semantics and the Worker/client path locally. The tests also cover the authenticated state-read route, successful state response envelope, root Worker URL path composition, trailing-dot localhost rejection, minimum service-secret length, denial of direct client.login before ownership, guarded event callbacks, guarded Discord REST calls, blocked direct Railway HTTP, and clean shutdown. It is not a Cloudflare preview/runtime integration test and does not validate actual Cloudflare account configuration, Durable Object migrations, secret deployment, account-specific quota usage, true Discord.js compatibility, process-kill fencing, or network outages at the edge. The guard blocks new REST/fetch requests after lease loss; it cannot cancel a request that was already sent and accepted remotely.

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


## Bot 005 outbound side-effect guard — source-only

The candidate guard components are now committed:
- implementation/discord-gateway-ownership-guards.mjs wraps client.login(), client.on(), client.once(), client.rest.request(), and the configured process fetch target.
- Only the Cloudflare lease coordinator origin is exempt from the global fetch ownership check. The Cloudflare client must be constructed first so it captures the original fetch transport.
- Every other outbound fetch requires the active ownership assertion. Any hostname containing "railway" or ending in .rlwy.net is rejected regardless of lease status.
- Event listeners registered after guard installation are skipped without an active lease. One-time event listeners remain registered if an event arrives before ownership is granted.
- implementation/fenced-discord-gateway-owner.mjs prepares the coordinator client and guard, then calls the Gateway supervisor. It is designed to be created immediately after the Discord Client and before any application event listeners are registered.
- If lease acquisition is denied, the adapter never calls client.login(). Graceful shutdown revokes local egress, destroys the client, and releases the owner/epoch lease.

The expanded local Node.js v22.16.0 suite now totals **27 passed, 0 failed**: the previous 19 Cloudflare tests plus six ownership-guard tests and two prepared-owner integration tests.

Important limits:
- These are mocked Discord client/REST objects; actual discord.js instance method mutability and version compatibility are not yet verified against the recovered Bot 005 runtime. If the client.rest.request hook cannot be installed, setup throws before login.
- The helper must be installed before the source registers any event listeners. The recovered Bot 005 source has not yet been patched to call this helper.
- A REST request already transmitted before ownership loss cannot be recalled. Per-effect epoch checks, idempotency receipts, and external hard-stop/process termination remain required.
- The guard blocks the existing hard-coded Railway coaching URL. That coaching workflow must be migrated to a public HTTPS service endpoint and configured explicitly before coaching handlers can function on an independent host. There is no silent fallback to Railway.


## Physical hard-stop orchestration — source-only contract

Added implementation/standby-hard-stop-controller.mjs and eight tests. Its sequence is deliberately strict:
1. Read the single Momentum Movement lease.
2. Refuse to touch anything if an unexpected owner currently holds an active lease.
3. Ask a provider-specific process-control adapter to stop the known primary by exact owner ID, deployment ID and process ID.
4. Accept success only when the adapter confirms state=stopped and gatewayClosed=true for those exact identifiers.
5. Release only the prior primary's matching fencing epoch, then re-read the lease and refuse takeover if any active owner remains.
6. Start standby through the fenced owner callback. That callback must acquire the lease before login and await the application-level READY/guild verification signal.

A missing, ambiguous, mismatched, or throwing hard-stop result never starts the standby. The module itself does not contain a Render, Railway, Fly.io or other host API adapter. There is no production process-stop integration yet.

The prepared owner now exposes markApplicationReady(), markApplicationNotReady(), waitUntilReady(), ready, and gatewayLoginComplete. This prevents successful client.login() completion from being mistaken for a verified application READY state. The app should call markApplicationReady() only after confirming the expected bot identity and target guild, and call markApplicationNotReady() when that state is lost.

Latest full local test suite: **35 passed, 0 failed** (19 Cloudflare/SQLite API, six egress guard, two prepared-owner, eight hard-stop controller). This remains a Node simulation with fake process-control evidence and mocked Discord client; it is not a live provider kill or Cloudflare-hosted failover test.

## Deployment-bound fencing and per-deployment request credentials

The Worker now requires a separate bearer token for each candidate deployment. Store `FENCE_REQUEST_TOKENS_JSON` as a Cloudflare secret JSON object keyed by deployment ID, for example:

`{"primary-deploy":"<unique-primary-token>","standby-deploy":"<unique-standby-token>"}`

Each value must be a random secret of at least 32 characters. Give each Bot runtime only its own token. The Worker checks that the requested owner ID begins with the exact deployment ID plus a colon; `prepareFencedDiscordGatewayOwner` enforces the same format and defaults to a fresh UUID per process. A primary token cannot request a fence for the standby deployment.

The Worker alone owns `RENDER_API_KEY`, `RENDER_SERVICE_IDS_JSON` (mapping deployment IDs to distinct Render service IDs), and the Durable Object namespace binding. The bot does not possess the Render API key or direct hard-fence confirmation authority.

The public Worker surface is `GET /healthz`, `GET /lease/state`, `POST /lease/acquire`, `/lease/renew`, `/lease/release`, operator-only `POST /lease/bootstrap`, and bot-facing `POST /fence`. The Durable Object's `/lease/fence/confirm` method is not publicly routed; the Worker invokes it internally only after the Render stop is verified.

## Render hard-stop semantics and initial migration limitation

The Worker-side fencer uses Render's `POST /v1/services/{serviceId}/suspend` endpoint, which returns HTTP 202 when a suspend request is accepted, then reads `GET /v1/services/{serviceId}` until the service's `suspended` value is exactly `suspended`. An accepted 202 by itself is not treated as stop proof. Render documents the `suspended` and `not_suspended` service states. Sources: https://api-docs.render.com/reference/suspend-service-1 and https://api-docs.render.com/reference/retrieve-service.

**The current production Bot 005 is still hosted on Railway.** Render cannot suspend that Railway service. The automated fencer therefore becomes usable only after both primary and standby have been migrated to distinct Render services. The initial Railway-to-independent cutover requires a separate, verified operator-controlled stop of the old Railway Gateway process followed by the one-time operator bootstrap. Never bootstrap while the legacy Gateway may still be connected. This is a manual migration boundary, not an automated failover claim.

After both deployments are on Render, the Worker can suspend the previous service and verify its suspended state before confirming a transfer. The candidate service must already be running without a Gateway connection. To fail back to a previously suspended service, that candidate must first be resumed through an authorized host workflow; the fencer deliberately refuses a suspended candidate.

Render documents service suspension rate limits; this controller issues one suspend request per promotion and polls only the service record for state readback. Source: https://api-docs.render.com/reference/rate-limiting.

## Current local verification after deployment-binding changes

Latest component-local Node.js 22.16.0 simulations:
- Render suspension + Durable Object Worker path: 2 passed.
- Lease store, SQLite coordinator, and Render fencer component batch: 18 passed.
- Discord event/REST/fetch guard: 7 passed.
- Prepared Gateway owner adapter with deployment-prefixed owner ID: 5 passed.
- Provider-neutral hard-stop contract and e2e supervisor batch: 9 passed.
- **Latest combined local result: 65 passed, 0 failed across the selected component suites.**

These tests use isolated working copies, simulated Cloudflare context, Node SQLite, fake Discord clients, and mocked Render HTTP responses. The combined command exercised five working directories containing the locally reconstructed component sources; it is not a clean repository checkout test run, Cloudflare-hosted integration test, or actual Render service suspension test. GitHub Actions still fails before job creation and has no job logs.

## Remaining gates

- No Cloudflare Worker/DO is deployed; no secrets are configured; Cloudflare account plan/usage remain unverified because dashboard authentication expired.
- Render workspace service inventory remains inconclusive (`null`); no Render service, database, or Key Value resource has been provisioned in this effort.
- Render's fencer cannot stop the currently active Railway Bot 005. Initial migration requires a manual, verifiable stop before operator bootstrap.
- Bot 005 application source has not been integrated with the prepared owner adapter. Compatibility with the exact production Bun/Discord.js runtime has not been verified.
- The Bot 005 source still calls `http://coaching-workflow.railway.internal:3000/interaction`; the guard rejects Railway calls. That service must be migrated to public HTTPS with state/feature parity before independent hosting.
- Discord Manager `OAUTH_DATABASE_URL` host remains unknown.
- No actual Render service suspension, production Discord Gateway login, failover/failback, or rollback has occurred.

## Render credential isolation correction

The unused helper that could combine a PostgreSQL/Cloudflare lease store with the Render API adapter inside a Bot process has been removed. The Render service fencer is now intentionally consumed only by cloudflare/worker.mjs. Bot-side code uses only cloudflare-fence-request-client.mjs, which sends candidate identity and a deployment-specific request token to the Worker; it never imports a Render API client or receives the Render API key. The current component suite no longer includes the two removed helper-wrapper tests. The Render fencer suite is 7/7, and the Worker-to-Render-to-Durable-Object flow remains separately simulated.


## Durable Object-level owner/deployment identity enforcement

The most recent hardening moved the identity check into `cloudflare/gateway-lease-coordinator.mjs` itself. Worker-only validation is not relied on:
- Bootstrap rejects an owner ID that does not begin with its deployment ID plus a colon.
- Lease acquire independently enforces the same prefix.
- Fence confirmation reads the current lease and verifies the old owner is bound to its stored deployment, then verifies the candidate owner is bound to the requested candidate deployment before it writes the fence evidence.
- The Worker and Render fencer also validate deployment-bound candidate/previous identities before invoking Render API operations.

The updated SQLite test suite explicitly rejects unbound bootstrap/acquire owners and unbound old/candidate identities in fence confirmation. The Render fencer test suite also verifies mismatched owner identities are rejected before any Render API call.

## Latest local verification and hosted CI

A single local Node.js v22.16.0 test invocation across isolated component working directories returned **65 tests, 65 passed, 0 failed**:
- Durable Object + Render fencer: 14
- Worker controller + fence request client + ownership egress guard: 15
- Prepared Discord owner adapter: 5
- Provider-neutral hard-stop controller: 8
- Shared lease + Gateway supervisor + independent preflight: 23

Latest observed GitHub Actions run is `43556643815`, commit `3d06db570263be426a62a846ffac64a2e044673c`, with conclusion `startup_failure`; the jobs endpoint returned an empty list. Immediately preceding runs `43556634163` and `43556557762` failed the same way. No runner or job logs exist. This is an unresolved hosted-CI blocker; do not claim GitHub Actions passed or guess at the cause.


## Fence-request timeout alignment

The bot-facing fence requester now defaults to 30 seconds (the maximum supported by its validator). The Worker fencer allows up to 15 seconds of suspension-state polling, with each Render service-state request independently bounded to 5 seconds. This gives the caller room for the candidate-state read, prior-state read, suspend acknowledgement, state readback/poll, and Durable Object confirmation. The operation remains fail-closed on any timeout or unavailable response; it never treats the Render HTTP 202 acknowledgement alone as proof of a stopped Gateway host.

After this timeout adjustment, the full selected local Node.js 22.16.0 component run still returned 65 tests passed and 0 failed.
