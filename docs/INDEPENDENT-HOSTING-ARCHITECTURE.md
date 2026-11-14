# Dawn Dotta / Momentum Movement — Railway-Independent Failover Architecture

Updated: 2026-11-13 US Eastern

## Governing decision

Railway is not a deployment dependency for recovery or future operations. Existing Railway resources may remain the current production footprint and source of historical state, but no new deploy, recovery, cutover, coordination, or failover step may require Railway access or billing.

## Verified production baseline

- Discord guild: `1565048205970767992`
- Bot application: `1565304619838742598`
- Bot 005 remains the only currently verified production Discord Gateway owner.
- Recovered Bot 005 source calls `await client.login(token)`; no shared lease acquisition/heartbeat/fencing protocol is present.
- Recovered Core Shadow is a read-only HTTP process; it does not connect to Discord Gateway or write Discord data.
- An old Railway PostgreSQL service exists, but it is not an independent coordination dependency and must never be treated as the failover control plane.
- Railway deployment is unavailable because its trial expired. Do not spend time repairing or waiting on Railway.

## Target architecture

1. **Primary:** Keep the existing Bot 005 runtime untouched until a reviewed replacement/cutover path exists. It remains the sole Gateway owner.
2. **Independent standby runtime:** Host Core Shadow successor on a persistent process platform independent of Railway. It must support long-lived outbound Discord Gateway WebSocket connections, persistent process execution, health endpoints, graceful shutdown, and an authorized secret store. A sleeping/free web tier is not suitable as an always-on Gateway standby.
3. **Independent coordination store:** Use separately hosted PostgreSQL-compatible storage or another strongly consistent lease store. Do not rely on Railway PostgreSQL for takeover availability.
4. **Lease and fencing protocol:** Both primary and standby participate in one shared ownership protocol before either can own the Gateway. Lease records include owner ID, monotonically increasing fencing epoch, expiry, heartbeat, and deployment identity. Acquisition is atomic. A stale owner must stop processing and close its Gateway session when renewal fails. Side effects must be guarded by current lease epoch and idempotency receipts.
5. **Fail-closed behavior:** A standby must not infer primary death from one failed health probe. Require lease expiry and independent evidence. If coordination is unavailable, standby remains disconnected.
6. **Failback:** Primary recovery must not automatically open a second Gateway. It may request priority reacquisition only after standby relinquishes its lease and closes its Gateway, followed by fencing-epoch increment and verification.
7. **Cloudflare:** HTTP control plane/monitoring only where useful. Do not place persistent Discord Gateway ownership in a standard Cloudflare Worker.
8. **Observability:** Separate liveness, readiness, lease owner/epoch, last heartbeat, Gateway state, and failover transition logs. Never expose tokens or database credentials.

## Hard safety gates

- Do not connect standby to Discord Gateway until primary participates in the same lease/fencing protocol.
- A PostgreSQL lease is not physical fencing of an already-open Discord Gateway socket. The old process must be stopped by a proven out-of-band control before standby login.
- Do not provision paid infrastructure until exact billing cost is explicitly approved.
- Never claim a free sleeping service is always-on.
- Never print, commit, or copy plaintext secrets.
- Never stop, restart, redeploy, or alter live Bot 005 for a test.
- Never treat an HTTP health endpoint alone as proof that a Gateway owner is dead.
- Do not enable Discord writes on standby before command/handler parity, fencing, idempotency, and controlled failover tests pass.

## Independent-hosting inventory

User confirmed the Render workspace:
- Name: `My Workspace`
- Workspace ID: `tea-dbcqe7ss728c73fthlug`

Latest read-only inventory observations:
- Render workspace listing confirms the workspace.
- Render service listing returned literal `null` on three calls, including calls with and without preview services. This is inconclusive; it does not prove the workspace has no services.
- Render Postgres listing returned `No Postgres instances found`.
- Render Key Value listing returned `No Key Value instances found`.
- No Render service, database, Key Value, or other resource has been created or changed.

The prior Cloudflare browser tab was an account member-policy page, not a Worker deployment page. No Cloudflare resource has been created or modified.

## Source-only preflight runtime

The approved preflight entry point is `implementation/momentum-movement-independent-preflight.mjs`, a Node.js service. Do not deploy the previous Bun prototype `implementation/momentum-movement-core-shadow-preflight.ts`; it uses generic `DATABASE_URL` and has no independent-host guard.

The Node service:
- Exposes read-only `GET /healthz`, `GET /readyz`, and `GET /preflight`; other methods are rejected.
- Requires `COORDINATION_DATABASE_URL` for readiness and does not fall back to `DATABASE_URL`.
- Accepts PostgreSQL URL schemes only and rejects Railway hostnames and local/private loopback-style hostnames.
- Optionally probes `PRIMARY_HEALTH_URL` over HTTPS; Railway internal endpoints and local/private targets are rejected. This probe is diagnostic only and is not a takeover signal.
- Opens no Discord Gateway session, does not write to Discord, and never returns credentials or configured URLs.
- Handles SIGTERM/SIGINT with graceful HTTP server shutdown.
- Uses the pinned npm dependency `postgres@3.4.7`.

The service and eight Node built-in tests are committed. Local Node.js v22.16.0 result: 8 passed, 0 failed. The database was injected/mocked in tests; no live independent Postgres instance was connected, and no deployment was performed.

## Lease implementation status

A reusable module is committed at `implementation/shared-gateway-lease.mjs`, with tests at `implementation/shared-gateway-lease.test.mjs`. It provides atomic lease acquisition, owner/epoch-guarded renewal and release, database-clock expiry, monotonic fencing epoch advancement, and fail-closed heartbeat behavior. Local isolated Node test result: 6 passed, 0 failed. Mock-backed tests do not prove live Postgres concurrency, network-partition safety, or physical Gateway fencing.

**Critical remaining safety gap:** the legacy Bot 005 process is not yet integrated with this lease module, and no external hard-stop/fencing controller has been verified. Do not activate standby takeover until Bot 005 itself uses the protocol and the controller can prove that the old process/socket is stopped before standby login.

## GitHub Actions status

An event-triggered workflow exists at `.github/workflows/failover-tests.yml`; it has no scheduled trigger. Run `43550719031` and the later run `43551272700` both ended with `startup_failure`; the Actions API reported zero jobs for both, so neither runner began and no test job ran. The workflow YAML was read back and is structurally valid. The exact startup cause is not exposed by the available connector response. A direct read of repository Actions settings/check-suite metadata was rejected by the connector's endpoint allow-list; do not assert a root cause without evidence.

The repository's private repository metadata reports admin/push access for the connected GitHub identity. This does not, by itself, prove Actions billing or policy configuration. No successful hosted CI run has been verified yet.

## Scheduler audit

The automation inventory contained 25 tasks. Relevant five-server/Dawn/Momentum maintenance and failover tasks previously found were disabled. No scheduler, cron, reminder, or recurring repair was created or changed. Preserve the user's maximum-one-centralized-maintenance-process rule; do not duplicate existing tasks.

## Next implementation sequence

1. Read back the latest GitHub files and verify the committed source matches the locally tested source.
2. Continue GitHub Actions startup diagnosis using supported read-only metadata; no runner logs exist for the zero-job run.
3. Resolve Render service inventory through another supported read-only route; never infer emptiness from a null response.
4. Select an independent coordination database and verify actual pricing, persistence, and service limits.
5. Add a versioned lease schema migration and test it against a disposable real PostgreSQL instance.
6. Implement the Bot 005 primary lease adapter and an external hard-stop/fencing controller. Preserve the live primary until safe migration is possible.
7. Implement standby runtime in disconnected mode; Gateway login remains disabled.
8. Verify competing-owner exclusion, lease expiry, heartbeat loss, DB outage, fencing epochs, idempotent side effects, process termination, failover, failback, and rollback.
9. Only then consider a controlled cutover. No paid infrastructure may be provisioned without explicit approval of the exact spend.

## Existing maintenance process policy

No new scheduler has been created. Reuse at most one existing centralized project maintenance/recovery process if the user's existing automation inventory and authorization permit it.


## Additional dependency audit — verified source references

A full-string scan of the recovered Bot 005 source found one direct Railway-internal runtime call:
- Bot 005 forwards coaching interactions to `http://coaching-workflow.railway.internal:3000/interaction`.
- This is a hard-coded in-cluster dependency, not an environment-configurable external URL. It must be migrated to an independently hosted coaching service or replaced with an independently reachable endpoint before claiming the full Momentum Movement runtime is Railway-independent.
- No evidence was found in the Bot 005 source scan for a `DATABASE_URL` dependency; do not infer its database usage from the generic architecture alone.

The recovered Dawn Dotta Discord Manager source also has platform-specific configuration:
- It reads `RAILWAY_SERVICE_KEY` for static bearer authentication.
- It reads `OAUTH_DATABASE_URL` for its OAuth database; the actual configured host is not in the recovered source and must be inspected without printing credentials.
- Its health response identifies the service as `railway`, and its write-guard error text refers to a Railway service.
- These references are not proof that the OAuth database itself is hosted on Railway. The database hostname must be checked in the deployment environment before migration.
- The recovered Core Shadow source contains no `.railway.internal` or `DATABASE_URL` string in its source body; it performs read-only Discord API probes and exposes `/healthz` and `/readyz`.

## External database account audit

The connected Supabase organization `Blickymania` is on the Free tier. It currently has two projects, both `ACTIVE_HEALTHY`:
- `discord-oauth-control-plane` — `zoufxdgxjjwiieqitnxf`
- `blickymania-discord-oauth` — `ecjpniihtxernirygcbq`

The inspected `public` and `private` schemas had no tables in either project. These projects are OAuth-named control-plane resources and were not repurposed for Momentum Movement. Supabase Free currently permits two active projects, and Free projects can pause after one week of inactivity; its published Pro plan starts at $25/month with additional projects from $10/month. Any separate project would require a paid-plan/cost review or a different provider. Source: https://supabase.com/pricing.

## Render production-tier cost and free-tier suitability

The confirmed Render workspace is `My Workspace` (`tea-dbcqe7ss728c73fthlug`). Inventory reads returned:
- Services: literal `null` on repeated calls (including preview-inclusive and preview-excluded); service inventory remains unknown.
- Postgres: no Postgres instances found.
- Key Value: no Key Value instances found.

Render's current public pricing lists its smallest persistent service/background-worker compute at $7/month and its smallest paid Postgres compute at $6/month. That gives a reference floor of about $13/month for one persistent process plus one Postgres database, excluding usage or workspace-specific costs. Render's Free Postgres expires after 30 days, has no backups, and can be restarted/maintained at any time; Free web services have resource and instance-hour limits. Do not use those free resources as production failover coordination or an always-on standby. Sources: https://render.com/pricing and https://render.com/docs/free.

No Render or Supabase resources have been created, upgraded, paused, or modified. No billing authorization has been given or used.


## Gateway owner supervisor — source-only candidate

The repository now contains `implementation/gateway-owner-supervisor.mjs`. It composes the shared lease module into a strict startup/shutdown sequence:

1. Acquire the independent lease first.
2. Do not call Gateway login when lease acquisition returns no row.
3. Start heartbeat supervision and a bounded renewal timeout before login.
4. Race Gateway login against lease-loss notification.
5. Gate adapter side effects with `assertOwned()`; handler integration remains a separate required change.
6. On renewal loss or timeout, immediately invoke the local Gateway destroy callback. If a late login resolves after lease loss, issue another destroy.
7. On graceful shutdown, stop heartbeat, destroy the local Gateway, then release only the matching owner/fencing epoch.

The heartbeat timer is referenced so an active owner process does not exit silently while supervising its lease. Every process instance must use a fresh unique owner ID. The destroy callback must tolerate invocation during connect and after a late connection completion.

**This is not production integration.** The recovered Bot 005 startup still calls `client.login(token)` directly. The supervisor does not stop a different process or prove an already-open socket is closed; the external hard-stop controller is still required. It must not be deployed as an active standby owner.

## Private coordination schema

A source-only migration is committed at `migrations/001_gateway_ownership.sql`. It creates `failover.gateway_ownership` in a non-public schema, applies length and positive-epoch constraints, and revokes schema/table permissions from `PUBLIC`. Runtime SQL explicitly qualifies the private schema. No database has had this migration applied.

The shared lease module now bootstraps the schema/table/revoke as separate SQL statements and provides atomic acquisition, owner/epoch-bound renewal/release, database-clock expiry, and fail-closed heartbeat behavior. Active leases cannot be reacquired even by the same owner ID.

Local Node.js v22.16.0 isolated test result for the current lease + supervisor test set: 15 passed, 0 failed. A separate preflight suite previously passed 8/8. All use fake database responses or injected adapters; none proves live PostgreSQL serialization, real Gateway shutdown, or physical process fencing.

## GitHub Actions diagnosis update

The latest observed run `43552702634` for commit `35aa10ea525e02645a11bd0be3cc4c0c0098c1b8` still ended `startup_failure` with zero jobs. A browser attempt to inspect the private repository and Actions settings failed with `ERR_SOCKS_CONNECTION_FAILED`; its secure sign-in card expired. No exact startup reason or repository Actions permission setting was returned, and no settings were changed. Do not guess at a billing, policy, permissions, or YAML cause.

## Updated failover blockers

- No independent coordination database has been selected or connected.
- Render service inventory remains inconclusive; Postgres and Key Value inventory results were empty.
- Supabase Free already has two active OAuth-named projects; neither is to be repurposed.
- Bot 005 has not been integrated with the supervisor and still contains a hard-coded Railway-internal coaching workflow URL.
- The Discord Manager's `OAUTH_DATABASE_URL` host remains unknown; do not infer it is hosted on Railway.
- No external hard-stop controller has been implemented or verified.
- No standby runtime has been deployed, and no Gateway takeover or failback test has been run.


## Control-plane candidate update — Cloudflare SQLite Durable Object

The preferred coordination-control-plane candidate is now a Cloudflare SQLite-backed Durable Object, rather than a separately hosted PostgreSQL database solely for one gateway lease. PostgreSQL lease module and SQL migration remain as an unselected alternative/reusable implementation and have not been connected to production.

The Cloudflare candidate uses:
- One fixed namespace ID/scope for Momentum Movement's Discord Gateway ownership only.
- Single Durable Object instance, SQLite-backed persistent storage and transactional UPSERT/UPDATE.
- Authenticated Worker API and a Node HTTPS client.
- One shared leaseStore interface, so the same Gateway owner supervisor can use either the Cloudflare client or the PostgreSQL module.
- Monotonically increasing fencing epoch, active-lease exclusion, owner/epoch-bound renewal/release, short lease TTL, and fail-closed behavior on network errors/timeouts.

Historical initial Cloudflare prototype tests: 19 passed, 0 failed. After hard-fence, Render integration, ownership guard, and deployment identity changes, the latest combined local Node.js v22.16.0 suite is 65 passed, 0 failed across isolated working directories.

This is a real SQLite execution through Node's node:sqlite and a simulated Durable Object context/Worker namespace, but it is not deployed Cloudflare edge verification. It does not verify real namespace provisioning, production secret setup, actual Cloudflare quota/plan, external network failures, or physical process fencing.

Cloudflare account plan and current usage are not yet confirmed. Documentation indicates SQLite Durable Objects are available on Workers Free and that the approximate single-community lease traffic is within published Free-tier daily request/write budgets, subject to retries and all other account usage. This only potentially removes the extra database fee; it does not provide the persistent Bot 005/standby process host. Do not change the Cloudflare plan or deploy the Worker without explicit approval for the account-resource change.

No Cloudflare Worker, Durable Object namespace, secret, route, DNS record, plan, or billing change has been created or modified.


## Bot 005 candidate egress fencing — source-only

Two new adapters prepare a future Bot 005 integration without changing the recovered production snapshot:

- implementation/discord-gateway-ownership-guards.mjs installs the guard immediately after Discord Client construction and before application listeners are registered. It wraps login, on/once listeners, the Discord REST request method, and global fetch. All outbound HTTP except the Cloudflare coordinator origin requires active ownership. Railway hostnames and rlwy.net endpoints are rejected unconditionally, even when a lease is held.
- implementation/fenced-discord-gateway-owner.mjs creates the Cloudflare lease client before the fetch guard is installed, then prepares the supervisor and guard. It refuses direct Gateway login unless the supervisor successfully acquires the fixed Momentum Movement lease. On denied acquisition it revokes the guard and leaves the client disconnected.

Local Node.js v22.16.0 combined simulation suite: **27 passed, 0 failed** (19 coordinator/control-plane tests, six egress guard tests, and two prepared-owner integration tests).

This is still not integrated into the recovered Bot 005 application. The guard must be installed before its listeners are registered. The recovered source uses Discord.js; the actual client.rest.request instance hook and writable method properties need a compatibility test against the precise runtime dependency/version before deploying a candidate. If setup cannot patch any required method, it fails before login.

The guard prevents new REST/fetch calls after lease loss, but cannot recall a request already sent. Production safety still requires handler-level fencing/idempotency and out-of-band hard-stop before any standby Gateway login.

The Bot 005 source still has a hard-coded http://coaching-workflow.railway.internal:3000/interaction endpoint. The new guard will reject that request even while ownership is active. That coaching workflow has to be migrated to a public HTTPS endpoint and configured via environment before coaching handlers can work on an independent host; there is no fallback to Railway.


## Verified hard-stop orchestration — source-only

Added implementation/standby-hard-stop-controller.mjs and eight unit tests. The controller does not trust lease expiry or health probes alone. Before it calls any standby start callback, it requires provider control to return exact positive proof that the expected primary process is stopped and its Discord Gateway is closed. It then releases only the matching old lease epoch, verifies that no active lease remains, and only then invokes the standby callback. An unexpected active owner, wrong process identity, failed/ambiguous stop result, or active lease after the stop all block takeover.

The process-control interface is intentionally provider-neutral; no Render/Railway/Fly.io API implementation exists yet. No real host process has been stopped. This controller remains source-only until a persistent runtime provider is selected and a provider-specific adapter can be reviewed and tested.

The prepared Bot 005 owner adapter now distinguishes:
- Gateway login completion (the login Promise resolved);
- application readiness (the expected bot identity and target guild have been verified).

The application must call markApplicationReady() only after its real Ready/guild verification path, call markApplicationNotReady() when that status is lost, and standby must waitUntilReady() before treating the service as healthy. A successful socket login alone cannot satisfy the hard-stop controller's ready gate.

Latest full local Node.js v22.16.0 suite: **35 passed, 0 failed** (19 Cloudflare coordinator tests, six ownership guard tests, two prepared owner adapter tests, eight hard-stop controller tests). This is local simulation only; no Cloudflare edge runtime, actual Discord.js client, or provider process-stop adapter has been exercised.

## Render-backed hard-stop control plane — updated boundary

The Worker now owns the Render API key and the deployment-to-service mapping. Bot runtimes send only a candidate owner ID and deployment ID to the Worker `/fence` route. The Worker authenticates the request using a per-deployment token selected from the secret `FENCE_REQUEST_TOKENS_JSON`, verifies that the owner ID is prefixed by the deployment ID, reads the current expired lease, verifies the candidate Render service is running, suspends the exact old Render service, and polls the service record until Render reports `suspended`. Only then does the Worker call the internal Durable Object fence-confirmation method. A primary deployment token cannot request a fence for the standby deployment; Bot processes never receive the Render API key or direct fence-confirmation credential.

Render's public API defines `POST /v1/services/{serviceId}/suspend` with HTTP 202 on accepted suspension and `GET /v1/services/{serviceId}` with `suspended` / `not_suspended` state values. The fencer correctly treats HTTP 202 only as acknowledgement; it requires the subsequent service-state readback before it records a hard fence. Sources: https://api-docs.render.com/reference/suspend-service-1 and https://api-docs.render.com/reference/retrieve-service.

**Important initial migration boundary:** production Bot 005 is still on Railway, so the Render API cannot stop the current primary today. The Render hard-stop adapter can only be used once primary and standby are both running as distinct Render services. The first migration from Railway still requires an operator-controlled, independently verified shutdown of the legacy Gateway followed by the one-time operator bootstrap. No automatic claim should be made for that first transition. Later transfers between the two Render services can use the Worker-managed suspend/readback flow.

Each Bot deployment receives only its own `FENCE_REQUEST_TOKENS_JSON` credential. The one-time bootstrap credential, Render API key, and Worker-to-DO confirmation path are not distributed to bot processes. The Worker stores the deployment map and Render key as secrets; never commit them or copy them into the Bot environment.

## Updated verification and blockers

Component-local Node.js 22.16.0 simulations during this cycle: Render suspension + Durable Object Worker 2/2; lease store/SQLite coordinator/Render fencer batch 18/18; ownership guard 7/7; prepared owner adapter 5/5; provider-neutral hard-stop and e2e supervisor batch 9/9. **41/41 component tests passed across separate local harnesses.** These use simulated Cloudflare storage, fake Discord clients, and mocked Render HTTP responses; they are not a clean repository checkout, real Render service action, or Cloudflare edge test.

Cloudflare Worker/DO remain undeployed; account plan and usage are unavailable due expired dashboard authentication. Render service inventory remains inconclusive. No paid resources, secrets, routes, or billing settings have changed. The current Railway primary, the Railway-internal coaching workflow dependency, unknown Discord Manager OAuth DB host, actual Bun/Discord.js method compatibility, production handler fencing/idempotency, and rollback remain outstanding.

## Render credential isolation correction

The unused helper that could combine a PostgreSQL/Cloudflare lease store with the Render API adapter inside a Bot process has been removed. The Render service fencer is now intentionally consumed only by cloudflare/worker.mjs. Bot-side code uses only cloudflare-fence-request-client.mjs, which sends candidate identity and a deployment-specific request token to the Worker; it never imports a Render API client or receives the Render API key. The current component suite no longer includes the two removed helper-wrapper tests. The Render fencer suite is 7/7, and the Worker-to-Render-to-Durable-Object flow remains separately simulated.


## Storage-level owner identity invariant

The lease coordinator itself now validates owner/deployment binding. Every owner ID must have the exact form `deployment-id:process-uuid`. The prefix is checked in the Durable Object during bootstrap, first acquire, and fence confirmation (for both the prior owner stored in the current row and the candidate identity). Worker checks are an additional outer layer, not the authority. Render fencer also checks both old and candidate owner/deployment pairs before any Render API request. Tests cover direct attempts to bypass the Worker with an unbound owner identity.

## Latest test run and Actions blocker

Latest combined Node.js v22.16.0 local result: **65 passed, 0 failed** across separately reconstructed component working directories:
- Durable Object + Render fencer: 14
- Worker controller + fence client + ownership guard: 15
- Prepared Gateway owner adapter: 5
- Provider-neutral hard-stop controller: 8
- Shared lease + Gateway supervisor + independent preflight: 23

This is local simulation using Node SQLite, mocked Discord clients, fake process-control evidence, and mocked Render API replies. It is not a clean repository checkout, deployed Cloudflare test, actual Render service suspend, or production Gateway test.

Latest GitHub Actions run `43556643815` (commit `3d06db570263be426a62a846ffac64a2e044673c`) ended `startup_failure`; its jobs endpoint returned an empty list. The two immediately preceding runs also returned startup failure and zero jobs. No hosted runner or job logs exist; the cause remains unknown.

## Durable Object identity hardening

The Durable Object now enforces the deployment-prefixed owner ID directly at storage boundary:
- `bootstrap` and `acquire` reject owner IDs without the requested deployment prefix.
- `confirmFence` verifies the existing owner ID is bound to the current row's deployment and the candidate owner ID is bound to the candidate deployment before recording any proof.
- A mismatched candidate or old owner is rejected before the fencing update.
This prevents bypassing the Worker-only owner-prefix check by calling the Durable Object or internal routes directly.


## Fence request timeout and source audit update

The bot-facing Cloudflare fence requester now has a 30-second default timeout. The Worker-side Render fencer allows 15 seconds for suspension-state polling, and each Render service GET/POST call has its own 5-second abort timeout. This avoids a caller timing out at 10 seconds before the control plane completes its verified stop-and-fence operation. A timeout still fails closed and no Bot login occurs.

A fresh full local Node.js 22.16.0 component run after this timeout change returned **65 passed, 0 failed**. It covered Durable Object/Render fencer, Worker, fence-request client, ownership guards, prepared owner, provider-neutral hard-stop controller, shared lease supervisor, and independent preflight tests. This remains multiple isolated/reconstructed local test directories, not a clean repository checkout or hosted/production integration.

A complete scan of the recovered Bot 005 source found 55 uses of global fetch but no direct Node http/https request, raw net/tls/dgram socket call, undici import, or WebSocket constructor. The only Bun server calls are its two local health/metrics listeners. The current ownership guard wraps global fetch and discord.js REST request entry points, plus event listeners and login. This narrows known outbound paths but does not replace the pending exact Bun/discord.js version compatibility test or review of third-party package internals.
