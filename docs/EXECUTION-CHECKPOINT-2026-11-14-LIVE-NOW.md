# Execution checkpoint — Dawn Dotta LIVE NOW repair

Updated: 2026-11-14 UTC  
Project: Dawn Dotta / Momentum Movement  
Guild: `1565048205970767992`  
Repository: `Blickymania/momentum-movement-fallback`  
Branch: `hostless/dawn-dotta-bun-runtime`  
PR: [#4 — Prepare Dawn Dotta Bun runtime for Hostless](https://github.com/Blickymania/momentum-movement-fallback/pull/4)

## Scope and non-negotiable boundaries

- Continue only within Dawn Dotta / Momentum Movement.
- Do not operate Railway: no stop, restart, suspend, redeploy, service edit, variable edit, or other mutation.
- Do not change bot roles, permissions, hierarchy, assignments, or role names.
- Do not activate a replacement Gateway session or expose a token.
- Do not create a Hostless app/worker or any paid resource.
- Keep PR #4 open and draft-only; do not merge it.
- Do not create new schedulers, cron jobs, reminders, or recurring automations.

## Completed in this cycle

### Seven confirmed Gateway-connected deployments

The read-only production inventory and Hostless plan now document seven Gateway-connected deployments. The additional Dawn Dotta LIVE & Events Listener was verified from its last successful startup logs: `active=true`, `botMatches=true`, and `creator-widget-gateway-ready`. Exact functional overlap with LIVE NOW V2 remains to be reconciled.

### LIVE NOW panel incident diagnosis

- LIVE NOW V2 service `7b194622-a8db-4a43-9bfd-4d17a7ba360e`; latest successful deployment `9d72eb28-e6d2-4bef-9cd6-43eb569d160f`.
- Last logged V2 panel ID: `1566082077768814717`.
- V2 passive audit on 2026-11-14 22:43:44 UTC: `healthy=false`, `count=0`, `legacy=0`, `panel=null`.
- Discord readback: `#live-now` channel `1565643739353972846` has no messages and no pins. Direct GET for the last panel ID returned 404 `Unknown Message`.
- `#upcoming-events` remains intact; its panel ID `1569626020917805078` retains Submit Event, How It Works, and Archived Flyers controls.
- Source inspection confirms the running process stores the panel ID in memory and navigation handlers prefer that ID. A direct manual replacement message would not update the process's stored ID and could render controls that PATCH the deleted message. No manual panel post was made.

### Source-level repair component

- Added `implementation/live-now-panel-recovery.mjs`.
- Added `implementation/live-now-panel-recovery.test.mjs`, `implementation/live-now-panel-repair-adapter.mjs`, and `implementation/live-now-panel-repair-adapter.test.mjs`.
- The adapter filters the last 10 pages by the expected Bot 005 application ID, detects nested V2/legacy buttons, writes the process-local panel ID only after the existing guarded publisher returns a valid ID, and suppresses overlapping audit invocations.
- Focused local Node.js 22.16.0 run: **19 tests passed, 0 failed** (11 helper tests + 8 adapter tests).
- Retrieved-branch source inspection passed **17/17** package and safety checks for exact dependency pins, bare imports, nested package isolation, frozen-lock Docker requirement, early active-mode guard, preserved single 30-minute audit interval, unchanged root Hostless files, correct ID regex, and no timers in the adapter. The nine committed candidate static-test cases have not yet run in a clean checkout.
- The helper leaves a correct single panel alone; asks the existing guarded publisher to publish a missing panel or adopt a sole panel when the stored ID is stale; refuses duplicate V2 panels and any legacy-panel conflict; and requires a second scan to confirm exactly one V2 panel and no legacy panel.
- The helper/adapter are wired into a separate `candidate/live-now-v2/index.ts` candidate and are not wired into an active service. The production V2 passive audit remains read-only. The candidate still has an early activation guard and cannot connect a Gateway. No helper/adapter timer is created.

### Isolated LIVE NOW V2 package

- Candidate source: `candidate/live-now-v2/index.ts`; package manifest: `candidate/live-now-v2/package.json` pins `discord.js` 14.27.0, `tiktok-live-connector` 2.5.0 and `sharp` 0.34.5.
- Candidate Dockerfile uses `oven/bun:1.4.4` and `bun install --production --frozen-lockfile`. The existing root `package.json`, root `Dockerfile`, and `hostless.yaml` remain unchanged.
- No `candidate/live-now-v2/bun.lock` has been generated. Bun is not installed in this environment and `npm view bun@1.4.4` timed out. The candidate has not been built or executed; no unlocked install or fabricated lockfile was used.
- The npm listing for `tiktok-live-connector` 2.5.0 identifies it as an unofficial reverse-engineering package, lists modified AGPL-3.0-only licensing and documents Euler Stream signing. Review exact terms/provider service limits before public release.

### Documentation and PR

- Updated `docs/HOSTLESS-FREE-DEPLOYMENT-PLAN.md` with the incident evidence, the unsafe direct-post condition, the helper boundary, and the next integration step.
- Updated `docs/MOMENTUM-MOVEMENT-GATEWAY-WORKLOAD-INVENTORY.md` to seven confirmed Gateway-connected deployments.
- Updated PR #4 body to reflect seven deployments and current constraints. PR remains open, draft, unmerged.
- The checkpoint has been refreshed as work progressed; see the current PR #4 head SHA for the latest committed version.

## Tests and verification

- Focused LIVE NOW reconciliation-helper and audit-adapter tests: **19/19 passed** with local Node.js v22.16.0.
- Source readback confirms the panel deletion, empty channel and pins, and existing Upcoming Events panel.
- Full repository test suite has not been run in a clean checkout.
- Latest relevant branch Actions runs `43652766822` and `43652757502` both ended `startup_failure`; both Jobs API results were empty. Run metadata had previously shown `BuildFailed` / `Unknown event`. Available endpoints do not expose runner logs or a root cause. No blind retry was started.

## Active blockers

1. **Current production LIVE NOW repair:** V2 process holds a stale deleted message ID. Safe direct post is not sufficient. Integration requires a controlled V2 runtime update/restart or replacement, which cannot be done while respecting the no-Railway-operation boundary and no-parallel-Gateway requirement.
2. **Independent Gateway ownership:** V2 needs its own workload-specific lease/fencing scope and physical-stop proof. It must not share Bot 005's existing lease scope. No provider-specific, independently verified stop path exists for the currently live Railway process.
3. **CI:** GitHub Actions fails before job creation; the latest two run IDs and empty jobs results are recorded above. Cause unknown.
4. **Hostless:** app/worker has not been created. Current wizard is still Configure, shows $0.00, and no volume is selected. Resource fit and persistent storage for Engagement remain unverified.
5. **Other migrations:** coaching Relay/Workflow crash-recovery gap, Engagement persistent-storage dependency, Fan Club media resource requirements, and full seven-service ownership integration remain open.

## Existing scheduled processes

- No new scheduler, cron job, reminder, or automation was created.
- LIVE NOW V2 already has a 30-minute passive audit interval; in the recovered source it is read-only and is the intended existing hook for later repair integration.
- Existing LIVE NOW expiry/duration timers were not changed.
- No duplicate maintenance or retry loop was introduced.

## Production changes and dependencies

- No Railway service was changed, stopped, suspended, restarted or redeployed.
- No Discord message, channel, category, role, permission, hierarchy or assignment was changed in this cycle.
- No bot role was changed.
- No Hostless app/worker/database/volume was provisioned.
- No production secret was read, copied, modified, or committed.
- External prerequisite for eventual cutover: a separately verifiable physical stop of the legacy V2 Gateway process, plus an approved hosting/provider path and workload-specific fencing before a replacement Gateway session can start.

## Last verified state and exact next step

- PR #4 remains draft-only and unmerged.
- Seven Gateway-connected deployments are documented; their independent scopes remain.
- `#live-now` remains empty; `#upcoming-events` remains intact.
- LIVE NOW recovery helper and adapter are committed; 19 focused helper/adapter tests passed; nine candidate static tests are committed but not yet executed. The live runtime remains unchanged.
- Railway, bot roles, and Hostless provisioning remain untouched.

**Next execution step:** generate and commit `candidate/live-now-v2/bun.lock` using Bun 1.4.4 (`bun install --lockfile-only`) in an authorized build environment; then run `bun install --frozen-lockfile`, the nine static tests, and a no-token standby boot. Bun is not installed in this execution environment and the npm registry request timed out, so this lockfile and build have not been completed. Keep the activation guard in place. After package verification, add a dedicated V2 Durable Object lease scope/Worker route with separate credentials, test isolation from Bot 005, and independently prove the old Gateway process is physically stopped before activation. Do not restart Railway or create another Gateway session in parallel.

## Additional cutover blocker — V2 requires independent ownership scope

A read-only source inspection found the existing Cloudflare Gateway coordinator is Bot 005-only:

- `GATEWAY_LEASE_SCOPE` is hard-coded to `momentum-movement:bot-005-gateway`; coordinator methods reject any other scope.
- Worker uses a single `GATEWAY_LEASE_COORDINATOR` Durable Object and a fixed `idFromName(GATEWAY_LEASE_SCOPE)`.
- The current prepared Discord owner imports that constant and passes it directly; it has no per-workload scope override.
- Wrangler declares one Gateway lease class (Bot 005) plus the separate coaching idempotency class.

Reusing that lease for LIVE NOW V2 would be unsafe and is prohibited. A future source-only control-plane change needs a separate V2 Durable Object class/namespace and migration, dedicated `/live-now-v2/lease/*` and `/live-now-v2/fence` routes, separate service/bootstrap/fence credentials and deployment/service mapping, plus tests that prove lease isolation across scopes.

The existing Worker hard-stop adapter is Render-specific and cannot stop the current V2 primary while it remains on Railway. With Railway operations prohibited, no physical Gateway stop proof can be produced in this cycle. The V2 activation guard must remain. Do not connect a second V2 Gateway session until there is an independently verified hard stop and the dedicated scope is deployed and tested.

No Worker or Durable Object source was changed during this inspection; no lease was provisioned and no secret was created.