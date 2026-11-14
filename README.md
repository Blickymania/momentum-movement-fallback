# Momentum Movement — Cloudflare migration workspace

**Owner project:** Dawn Dotta / Momentum Movement  
**Migration branch:** infra/cloudflare-free-migration  
**Current phase:** recovered source, isolated Worker/OAuth code, Gateway coordinator, registry and durable dispatch framework  
**Production cutover:** not started

This branch contains recovered Railway sources and a no-card Cloudflare Free migration candidate. It is not a live Cloudflare deployment. No Cloudflare account, D1 database, Worker, Durable Object namespace or billing method has been provisioned.

## Verified implementation

- `src/worker.mjs` — Worker entry for HTTP/MCP, health/readiness and protected internal Gateway controls.
- `src/manager-core.mjs` — extracted manager behavior with fixed Momentum Movement guild/application identity.
- `src/oauth-routes.mjs` and `src/oauth-d1-store.mjs` — OAuth 2.1 registration, S256 PKCE, Discord owner/admin check, single-use authorization-code claims, refresh rotation, revocation, scopes and D1 persistence.
- `src/gateway-protocol.mjs` — Gateway v10 frame parsing, Identify/Resume/Heartbeat decisions, ACK handling, close codes and bounded reconnect backoff.
- `src/durable-gateway-inbox.mjs` — per-client durable queues, ordered FIFO, replay protection, atomic sequence persistence, bounded capacity, paginated reads and idempotent acknowledgements.
- `src/gateway-coordinator-core.mjs` — one shared alarm, namespaced client sessions, resume recovery, heartbeat ACK accounting, token/app deduplication, identity checks, generation fencing and safe fatal-state handling.
- `src/gateway-coordinator-do.mjs` — SQLite Durable Object adapter with internal bearer controls, Discord bot/application/guild identity verification, durable start/stop and disabled-by-default activation.
- `src/gateway-handler-registry.mjs` — source-specific event and interaction ownership, exact `uniprof:`/`mompass:` collision resolution, guild/application fencing, and mutually exclusive LIVE publisher selection.
- `src/durable-gateway-dispatcher.mjs` — per-event/per-handler durable leases, bounded retries, receipt tracking, quarantine and acknowledgement only after every selected handler completes.
- `src/interaction-token-vault.mjs` — AES-256-GCM encryption for short-lived Discord interaction webhook tokens. Plaintext tokens are not written into durable event payloads.
- `docs/GATEWAY_AUDIT.md` and `docs/GATEWAY_DISPATCH_MATRIX.md` — seven-client source audit, exact feature ownership and known selector collisions.
- `migrations/0001_oauth_schema.sql` — initial SQLite/D1 OAuth schema.
- `wrangler.toml.example` — SQLite Durable Object binding and migration; placeholder D1 database ID; OAuth and Gateway flags false; no Cron Trigger.
- `recovered/railway/` — source snapshots and existing backup scripts.

**Important implementation boundary:** the protocol, coordinator, registry, encrypted token storage, and standalone delivery ledger/dispatcher have deterministic local tests. The original seven feature-handler implementations have not all been ported to Workers/DO adapters, the dispatcher is not yet wired into the DO runtime, and immediate Discord interaction acknowledgements have not been verified against the live Discord API deadline. The Gateway coordinator must remain disabled and must not start production sockets until those feature adapters are implemented and proven. Passing the core tests does not establish feature parity.

## Tests and development

Node.js 22 or later is required for the local SQLite test harness.

```bash
npm test
npm run check
npm run test:oauth
npm run test:gateway
npm run test:worker
```

Latest complete repository regression: **139 tests passed, 0 failed, 0 skipped** across 11 test files. All 11 source modules and 11 test files passed Node `--check`. These tests use local SQLite/D1-compatible wrappers, fake Durable Object storage, fake WebSockets and mocked Discord REST. They do not prove a real Cloudflare deployment, real D1/DO service behavior, live Discord OAuth, live interactions, a 24-hour socket lifecycle or production cutover. The hosted runner has Node but not npm; commands were executed directly with `node --test` and `node --check`.

## No-card and production safety gates

- Cloudflare dashboard was verified signed out at https://dash.cloudflare.com/login. The owner must sign in and verify the actual Free plan and required product availability without entering a payment method before any resource is provisioned.
- D1 Free limits include 5 million row reads/day, 100,000 row writes/day and 5 GB total storage. Durable Objects Free includes SQLite-backed objects, 100,000 requests/day, 5 GB SQLite and 13,000 GB-s/day.
- Outbound WebSockets cannot use Durable Object WebSocket Hibernation. Continuous active Gateway traffic and alarm work can use substantial billed duration. A continuously active 128 MB coordinator for 24 hours is approximately 11,059 GB-s/day, around 85% of the 13,000 GB-s Free allowance before other activity. This is an estimate, not measured use or proof that the seven-client workload fits. A 24-hour quota/lifecycle soak is mandatory.
- Do not enable paid plans, payment methods, paid add-ons or metered overage. At quota exhaustion, fail closed and retain durable events until reset.
- Every active Gateway definition must have a unique, verified application identity and token reference. Duplicate token fingerprints are checked in memory and not persisted/logged. The handler manifest must match the configured guild/application.
- Required test configuration (not populated): `GATEWAY_CLIENT_DEFINITIONS`, `GATEWAY_HANDLER_MANIFEST`, `GATEWAY_INTERACTION_ENCRYPTION_KEY` (64 hex characters), one secret binding per configured token reference, and `MCP_INTERNAL_BEARER_TOKEN`.
- OAuth and Gateway flags remain disabled by default. No credentials or real Gateway client definitions have been committed.
- Existing Railway manager, Gateway clients, databases, volumes and media bucket remain the production rollback; none were modified.
- The previously staged three-change Railway patch for the retired News Forum cleanup remains untouched.
- No new scheduler, Cron Trigger, keepalive, recurring repair or health-ping loop was created. Gateway deadlines share one Durable Object alarm. The Wrangler example contains no `[triggers]` block.

## Remaining objectives

1. Port each of the seven feature handlers behind the registry, beginning with durable idempotent receipts and the appropriate interaction ACK/defer/modal behavior.
2. Wire the dispatcher into the Durable Object and prove event delivery, handler retries, interaction acknowledgement within Discord deadlines and no duplicate side effects.
3. Verify actual bot/token identities, runtime flags and privileged intents using a secure non-disclosing check; keep distinct identities isolated.
4. Obtain owner Cloudflare sign-in and verify a no-card Free plan. Deploy only isolated test D1/DO resources after that.
5. Run a 24-hour Gateway lifecycle and quota soak; verify heartbeat/ACK, restart/resume, eviction/recreation, queues and quota exhaustion.
6. Export and restore both PostgreSQL domains independently; inventory all original media objects and validate a complete checksummed restore.
7. Complete feature parity, shadow comparisons, permissions/side-effect checks and rollback rehearsal before any production cutover.

## Scope and recovery boundary

Only Dawn Dotta / Momentum Movement and its verified Railway project are in scope. No other Discord community is to be inspected or modified. No Discord channels, roles, messages, commands, bot settings, production services, environment variables, databases, volumes or buckets have been modified by this migration branch.
