# Dawn Dotta / Momentum Movement — Railway-Independent Failover Architecture

Updated: 2026-11-13 US Eastern

## Governing decision

Railway is not a deployment dependency for recovery or future operations. Existing Railway resources may remain as the current production footprint and source of historical state, but no new deploy, recovery, cutover, or failover step may require Railway access or billing to become available.

## Verified production baseline

- Discord guild: `1565048205970767992`
- Bot application: `1565304619838742598`
- Bot 005 is the only currently verified Discord Gateway owner.
- Recovered Bot 005 source starts the Discord client with `await client.login(token)`; no shared ownership lease is present in the recovered source.
- Core Shadow is currently a read-only HTTP process; it does not connect to the Discord Gateway and does not write Discord data.
- A PostgreSQL service exists in the old Railway project, but it is not an independent coordination dependency and must not be treated as the failover control plane.
- A read-only Core Shadow preflight implementation was prepared for Railway, but was never deployed. It must be treated as source-only, not a running health check.
- Railway deployment is unavailable because the trial expired. This is not a task to repair or wait on.

## Target architecture

1. **Primary:** Keep the existing Bot 005 runtime untouched until a reviewed replacement path exists. It remains the sole Gateway owner.
2. **Independent standby runtime:** Host the Core Shadow successor on a persistent process platform independent of Railway. It must support long-lived outbound Discord Gateway WebSocket connections, persistent process execution, health endpoints, graceful shutdown, and an authorized secret store. A sleeping/free web tier is not suitable for automatic Gateway standby.
3. **Independent coordination store:** Use a separately hosted PostgreSQL-compatible database or equivalent strongly consistent lease store. Do not rely on Railway PostgreSQL for takeover availability.
4. **Lease and fencing protocol:** Both primary and standby must participate in one shared ownership protocol before either can own the Gateway. Lease rows include owner ID, monotonically increasing fencing epoch, lease expiry, heartbeat, and deployment identity. Ownership acquisition is atomic. A stale owner must stop processing and close its Gateway session when it cannot renew. All writes and event side effects must be guarded by current lease epoch and idempotency receipts.
5. **Fail-closed behavior:** A standby must not infer primary death from one failed health probe. Require multiple independent signals and lease expiry. If coordination is unavailable, the standby remains disconnected. Availability is sacrificed rather than risking split-brain.
6. **Failback:** Primary recovery must not automatically open a second Gateway. It may request priority reacquisition only after standby relinquishes the lease and closes its Gateway, followed by lease epoch increment and verification.
7. **Cloudflare:** Use only for independent HTTP health routing/control-plane visibility where useful. Do not run the persistent Discord Gateway inside a standard Cloudflare Worker.
8. **Observability:** Expose separate liveness, readiness, lease owner/epoch, last heartbeat, Gateway state, and failover transition logs. Never expose tokens or database credentials.

## Hard safety gates

- Do not connect standby to Discord Gateway until the primary participates in the exact same lease/fencing protocol.
- Do not deploy or create paid infrastructure until workspace/account scope and any billable plan are explicitly confirmed.
- Never use a free sleeping service as a claimed always-on failover node.
- Never retrieve, print, commit, or copy plaintext secrets.
- Never stop, restart, redeploy, or alter the live Bot 005 process for a test.
- Never treat an HTTP health endpoint alone as proof that a Gateway owner is dead.
- Do not enable Discord writes on standby before full command/handler parity, lease fencing, idempotency, and controlled failover tests pass.

## Current independent-hosting inspection

Render's connected account exposes exactly one workspace:
- Name: `My Workspace`
- Workspace ID: `tea-dbcqe7ss728c73fthlug`

Render's own tool contract requires the user to confirm the workspace before any workspace-scoped service listing or mutation. No Render resources have been created or modified. No billing plan has been selected.

The Cloudflare browser tab is currently on an account member policy page, not a Worker deployment or service configuration. No Cloudflare resource has been created or modified.

## Scheduler audit

The automation inventory contains 25 tasks. Relevant five-server/Dawn/Momentum maintenance and failover tasks discovered in the inventory are disabled. No scheduler, cron, reminder, or recurring repair was created or changed during this cycle. Do not create duplicate monitoring; keep the user's explicit maximum of one centralized scheduled maintenance/recovery process per project.

## Next implementation sequence

1. Confirm the Render workspace scope before any workspace-scoped reads or writes.
2. Inspect existing Render services and account region/plan options. Prefer persistent worker support; determine actual always-on price/limits before provisioning.
3. Prepare a portable Docker/Bun deployment artifact and health/diagnostic endpoints without connecting to Discord Gateway.
4. Prepare independent coordination-store schema and lease/fencing module with deterministic unit tests.
5. Design the Bot 005 primary adapter and standby adapter against the same protocol; do not activate either until both can be deployed safely.
6. Test atomic acquisition, competing owners, lease expiry, heartbeat loss, stale fencing epoch, DB outage, process termination, controlled takeover, primary recovery, and failback.
7. Only after verified tests and safe deployment/rollback readiness, perform a controlled cutover with a hard single-owner guarantee.

## Last verified state

- Bot 005 remains the only active Gateway owner.
- Standby is not deployed independently and does not connect to Discord.
- Production source has no shared lease protocol.
- No infrastructure resources were created in this cycle.
- Exact external action needed to proceed with Render inspection: user confirmation to use Render workspace `My Workspace` (`tea-dbcqe7ss728c73fthlug`).
