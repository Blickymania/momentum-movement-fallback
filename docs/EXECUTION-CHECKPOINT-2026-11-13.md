# Execution Checkpoint — Dawn Dotta / Momentum Movement Failover

Updated: 2026-11-13 US Eastern

## Project and component
Dawn Dotta / Momentum Movement — Railway-independent Core Shadow / Bot 005 failover.

## Governing architecture
Railway is not a deployment dependency. Bot 005 remains the sole production Gateway owner. Core Shadow must move to an independent persistent host. Coordination must be independent of Railway. Exactly one Gateway owner is allowed. Cloudflare is HTTP control plane/monitoring only, not the persistent Gateway host.

## Completed this cycle
- Re-read the prior checkpoint and all four recovered/preflight source artifacts in GitHub.
- Confirmed recovered Bot 005 source calls `client.login(token)` directly and has no shared lease acquisition/heartbeat/fencing protocol.
- Confirmed current Core Shadow source is read-only and does not connect to Gateway or write Discord data.
- Confirmed the preflight source exists in GitHub but is not deployed; previous Railway redeploy was rejected after the trial expired.
- Listed Render workspaces. Exactly one is available: `My Workspace`, ID `tea-dbcqe7ss728c73fthlug`.
- Render requires explicit user confirmation of the workspace before workspace-scoped service listing or mutation. No resources were created or changed.
- Inspected current automation inventory (25 tasks). Relevant five-server/Dawn/Momentum tasks found are disabled. No automation or scheduler was created or changed.
- Inspected Cloudflare browser tab metadata: current tab is an account member-policy page, not a Worker deployment page. No Cloudflare changes were made.
- Added a durable architecture decision document at `docs/INDEPENDENT-HOSTING-ARCHITECTURE.md` (commit recorded below).

## Tests and verification
- GitHub readback succeeded for:
  - `docs/DAWN-DOTTA-FAILOVER-CHECKPOINT.md`
  - `implementation/momentum-movement-core-shadow-preflight.ts`
  - `recovered/railway/blickymania-bot-005.ts`
  - `recovered/railway/momentum-movement-core-shadow.ts`
- Static inspection verified absence of a lease gate in the recovered Bot 005 startup path and confirmed standby's current read-only/no-Gateway state.
- No live failover test was attempted because it would be unsafe before both processes share a lease protocol.
- No deployment was attempted. No Gateway session was opened. No production service was changed.

## Remaining objectives
1. Confirm Render workspace scope: `My Workspace` (`tea-dbcqe7ss728c73fthlug`).
2. Inspect existing Render services and determine persistent-worker availability and real pricing/limits.
3. Prepare portable independent-host deployment artifacts.
4. Implement and unit-test an independent lease/fencing coordination module.
5. Prepare matching primary and standby adapters; preserve Bot 005 live runtime until a safe replacement/cutover is possible.
6. Verify failover/failback, DB outage, heartbeat expiry, fencing, and duplicate-owner prevention.
7. Complete deployment and end-to-end verification only after safe prerequisites are met.

## Active blockers / exact user action
Render's tool requires workspace confirmation before workspace-scoped service reads/writes. Confirm: **Use the Render workspace “My Workspace” (ID tea-dbcqe7ss728c73fthlug) for this Dawn Dotta failover project.**

No billing approval is being requested yet. A persistent always-on worker may require a paid plan; inspect actual options after workspace confirmation and do not provision paid resources without explicit cost approval.

## Existing scheduled processes
Relevant automation inventory entries found (all disabled):
- Daily five-server maintenance and repair
- Continue five-Discord listener failover project
- Check Dawn Dotta production health
- Continue five-server dashboard repair cycle
- Five Discord repair cycle
- Momentum Movement Final Verification
No scheduler changes made. Do not create a duplicate. User's max-one-centralized-scheduler rule remains in force.

## Last verified state
Bot 005 remains the only active Gateway owner. No independent standby deployment exists. No lease/fencing protocol exists in production. Railway-independent architecture is documented, not deployed.

## Exact next execution step
After workspace confirmation, call Render `list_services` using the confirmed workspace ID, inspect any existing candidate service, and determine whether it can host a persistent Bun process without Railway. Do not create a service until plan cost and persistence behavior are known.
