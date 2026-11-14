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
