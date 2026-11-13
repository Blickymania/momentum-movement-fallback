# Momentum Movement — Cloudflare migration workspace

**Owner project:** Dawn Dotta / Momentum Movement  
**Migration branch:** `infra/cloudflare-free-migration`  
**Current phase:** source recovery, isolated implementation and local regression testing  
**Production cutover:** not started

This branch contains the recovered Railway sources and the isolated code being prepared for a no-card Cloudflare Free migration. It is not a live Cloudflare deployment. No Cloudflare account, D1 database, Worker, Durable Object namespace, or billing method has been provisioned.

## Verified implementation in this branch

- `src/worker.mjs` — Worker entry point for the Discord manager's HTTP/MCP surface.
- `src/manager-core.mjs` — isolated manager logic using Discord REST and strict Momentum Movement guild/application checks.
- `src/oauth-routes.mjs` — OAuth 2.1 authorization-code routes with S256 PKCE, Discord owner/admin verification, single-use state, refresh rotation, scoped authentication and revocation.
- `src/oauth-d1-store.mjs` — D1 persistence adapter. Authorization code consumption and refresh-token rotation use conditional updates and nonce-bound inserts inside atomic D1 batches.
- `src/gateway-protocol.mjs` — Discord Gateway v10 frame, heartbeat, resume, close-code and deduplication helpers.
- `src/durable-gateway-inbox.mjs` — bounded durable event inbox with persistent ordering, sequence replay protection, transactional enqueue/ack and paginated reads.
- `migrations/0001_oauth_schema.sql` — initial SQLite/D1 OAuth schema.
- `wrangler.toml.example` — no-secret example binding and deployment configuration. It intentionally contains an unfilled D1 ID and no Cron Triggers.
- `recovered/railway/` — recovered production source snapshots and backup scripts for migration analysis.

## Test and development requirements

Node.js 22 or later is required for the local SQLite test harness.

```bash
npm test
npm run check
npm run test:oauth
npm run test:gateway
npm run test:worker
```

Latest combined regression result: **62 tests passed, 0 failed** across the OAuth D1 store, OAuth HTTP routes, Worker/MCP boundary, Gateway protocol and durable inbox suites. The D1 adapter is exercised against local SQLite using D1-compatible prepared-statement and batch wrappers. This is local/runtime-independent verification, not an actual Cloudflare D1 account deployment.

## No-card and production safety gates

- The Cloudflare dashboard browser session was verified signed out; no account or plan could be verified. The owner must sign in at https://dash.cloudflare.com/login and confirm that Free products are available without adding a payment method.
- Provision no resource until Workers Free, SQLite Durable Objects and D1 are confirmed available under that no-card account.
- Never enable a paid plan, payment method, paid add-on, or metered overage. At quota exhaustion, queue or stop safely until reset.
- OAuth remains disabled by default in `wrangler.toml.example`. Secrets are not committed.
- The Discord Gateway supervisor is not yet implemented or deployed. The six recovered Gateway-based Railway components must be reconciled by bot identity, intents and side effects before any consolidation.
- Cloudflare outbound WebSockets do not use hibernation and only prevent eviction for up to 15 minutes per active outbound connection. A persistent Discord Gateway requires a separate 24-hour runtime, reconnect/resume and object-lifecycle acceptance test before cutover.
- The existing Railway manager, gateways, databases, volumes and media bucket remain the production rollback. They were not changed during this migration work.
- The previously staged three-change Railway patch for the retired News Forum cleanup remains untouched.
- No new scheduler, Cron Trigger, recurring repair, keepalive, or health-ping loop was created. The example Wrangler file has no `[triggers]` block.

## Exact next objectives

1. Finish Gateway client identity/intent/handler mapping and implement the Durable Object lease + outbound Gateway transport only after the no-card Cloudflare account is available.
2. Measure both PostgreSQL domains and the original-media bucket; prove full backup coverage and an isolated restore before migrating any production data.
3. Deploy the Worker and D1 adapter to isolated Cloudflare Free test resources, then validate OAuth end-to-end with the real Discord test application.
4. Prove Gateway heartbeat/ACK, sequence persistence, reconnect/resume, object eviction/recreation, event de-duplication and quota-exhaustion recovery for at least 24 hours.
5. Shadow-run and compare functionality, rehearse rollback, then cut over one component family at a time. No production changes before these gates pass.

## Scope and recovery boundary

Only Dawn Dotta / Momentum Movement and its verified Railway project are in scope. No other Discord community is to be inspected or modified. No Discord channels, roles, messages, commands, bot settings, production service configurations, environment variables, databases, volumes or buckets have been modified by this migration branch.
