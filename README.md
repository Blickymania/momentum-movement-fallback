# Momentum Movement — Cloudflare migration workspace

**Owner project:** Dawn Dotta / Momentum Movement  
**Migration branch:** `infra/cloudflare-free-migration`  
**Current phase:** recovered source, isolated HTTP/OAuth and Gateway-coordinator implementation, local regression tests  
**Production cutover:** not started

This branch contains recovered Railway sources and a no-card Cloudflare Free migration candidate. It is not a live Cloudflare deployment. No Cloudflare account, D1 database, Worker, Durable Object namespace, or billing method has been provisioned.

## Verified implementation

- `src/worker.mjs` — Worker entry point for the Discord manager HTTP/MCP surface, health/readiness and protected internal Gateway control routes.
- `src/manager-core.mjs` — extracted manager behavior with fixed Momentum Movement guild/application identity.
- `src/oauth-routes.mjs` — OAuth 2.1 authorization-code routes with S256 PKCE, Discord owner/admin verification, single-use state, refresh rotation, scoped authentication and revocation.
- `src/oauth-d1-store.mjs` — D1 persistence adapter using conditional claims and atomic D1 batches for authorization-code consumption and refresh rotation.
- `src/gateway-protocol.mjs` — Discord Gateway v10 parsing, Identify/Resume/Heartbeat decisions, close codes and bounded reconnect backoff.
- `src/durable-gateway-inbox.mjs` — namespaced, bounded durable queues with monotonic FIFO order, replay protection, atomic sequence persistence, paginated reads and idempotent acknowledgements.
- `src/gateway-coordinator-core.mjs` — isolated multi-identity Gateway core with one shared alarm, separate per-identity session/inbox state, heartbeat ACK tracking, safe resume, bounded reconnect, terminal configuration failures, in-memory token fingerprint deduplication and stale-socket generation fencing.
- `src/gateway-coordinator-do.mjs` — SQLite-backed Durable Object adapter with internal bearer controls, Discord bot/application/guild identity checks, durable alarm recovery, disabled-by-default activation and no token logging/persistence.
- `migrations/0001_oauth_schema.sql` — initial SQLite/D1 OAuth schema.
- `wrangler.toml.example` — no-secret deployment example with placeholder D1 ID, SQLite Durable Object binding, migration declaration, OAuth disabled, Gateway coordinator disabled and no Cron Triggers.
- `recovered/railway/` — recovered production source snapshots and backup scripts for migration analysis.

The core currently persists events into per-identity inboxes. The seven source clients' downstream handler ownership, ordering and side-effect routing still need full parity implementation and review before cutover. The coordinator is not connected to Discord production and no bot session has been started.

## Tests and development

Node.js 22 or later is required for the local SQLite test harness.

```bash
npm test
npm run check
npm run test:oauth
npm run test:gateway
npm run test:worker
```

The isolated suites cover D1-compatible SQLite storage, OAuth HTTP routes, Worker/MCP authentication, Gateway protocol, per-client durable inboxes, the multi-session coordinator and the Durable Object control adapter. The D1 adapter uses local SQLite wrappers; the Durable Object uses fake SQLite-compatible storage and fake sockets. These are code-level tests, not a real Cloudflare account deployment, live Discord OAuth test, or 24-hour platform acceptance test. Run the test scripts with direct Node commands if npm is not present in the execution environment.

## No-card and production safety gates

- Cloudflare's dashboard session was verified signed out at https://dash.cloudflare.com/login. The owner must sign in and confirm the Free account/plan is available without entering a payment method before resources are provisioned.
- Workers Free includes SQLite-backed Durable Objects; KV-backed Durable Objects are not available on Free. D1's Free limits include 5 million row reads/day, 100,000 row writes/day and 5 GB total storage. Free-limit exhaustion causes operations to fail until reset; do not enable paid services or overages.
- Durable Object Free includes 13,000 GB-s/day, 100,000 requests/day and 5 GB SQLite storage. Duration is charged for the 128 MB allocation, even if actual memory use is lower.
- Outbound WebSockets cannot use Durable Object WebSocket Hibernation. Each outbound connection prevents eviction for up to 15 minutes; events/alarms keep the object active, which can consume most of the daily Free duration quota during a continuous Gateway workload. A single central coordinator is deliberate, but a 24-hour quota/lifecycle soak is mandatory before production. No claim of sustainable Free-tier operation has been made.
- Every Gateway definition must identify one unique Discord application and one unique token reference. Token hashes are computed in memory only to reject duplicate credentials; no token or fingerprint is persisted or logged. The Durable Object verifies the bot user ID and guild before connecting.
- The Gateway coordinator and OAuth remain disabled by default. Required definitions and secret values have not been configured.
- Never enable a paid plan, payment method, paid add-on or metered overage. At quota exhaustion, fail closed, preserve durable queues and wait for free reset.
- The existing Railway manager, gateways, databases, volumes and media bucket remain the production rollback. They were not changed during this migration work.
- The previously staged three-change Railway patch for the retired News Forum cleanup remains untouched.
- No additional scheduler, Cron Trigger, repair loop, keepalive, or health-ping loop was created. Gateway heartbeats/reconnects share one Durable Object alarm; the Wrangler example has no `[triggers]` block.

## Remaining objectives

1. Complete event/interaction handler ownership and durable dispatch/ack idempotency across the seven recovered Gateway implementations.
2. Confirm application/token identities, runtime flags and privileged intents securely. Do not activate multiple sessions for the same Discord application.
3. Sign in to Cloudflare and verify the actual no-card Free plan. Only then provision isolated test D1/SQLite Durable Object resources.
4. Validate Worker deployment, OAuth with a non-production Discord test application and Gateway lifecycle/quota behavior for at least 24 hours.
5. Measure both PostgreSQL domains and inventory/restore the full original-media bucket; the latest verified batch is not a complete archive proof.
6. Complete feature parity, shadow-run, permission/side-effect checks and rollback rehearsal before staged production cutover.

## Scope and recovery boundary

Only Dawn Dotta / Momentum Movement and its verified Railway project are in scope. No other Discord community is to be inspected or modified. No Discord channels, roles, messages, commands, bot settings, production services, environment variables, databases, volumes or buckets have been modified by this migration branch.
