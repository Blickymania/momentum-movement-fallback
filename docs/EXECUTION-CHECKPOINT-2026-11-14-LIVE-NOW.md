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
- Retrieved-branch source inspection passed 15/15 structural checks for the candidate adapter wiring, panel-ID getter/setter, early active-mode guard, preserved single 30-minute passive-audit interval, preserved archive snapshot, correct ID regex, and absence of timers in the adapter. The six committed candidate static-test cases have not yet run in a clean checkout.
- The helper leaves a correct single panel alone; asks the existing guarded publisher to publish a missing panel or adopt a sole panel when the stored ID is stale; refuses duplicate V2 panels and any legacy-panel conflict; and requires a second scan to confirm exactly one V2 panel and no legacy panel.
- The helper is not yet wired into the recovered LIVE NOW V2 source or an active service. The production V2 passive audit remains read-only. This helper does not perform Discord I/O, connect a Gateway, read secrets, or schedule work.

### Documentation and PR

- Updated `docs/HOSTLESS-FREE-DEPLOYMENT-PLAN.md` with the incident evidence, the unsafe direct-post condition, the helper boundary, and the next integration step.
- Updated `docs/MOMENTUM-MOVEMENT-GATEWAY-WORKLOAD-INVENTORY.md` to seven confirmed Gateway-connected deployments.
- Updated PR #4 body to reflect seven deployments and current constraints. PR remains open, draft, unmerged.
- Latest verified branch commit at checkpoint start: `4ae598b2df234b6989fa070452d12271a57b306f` (this commit adds the plan appendix; checkpoint file is the next commit).

## Tests and verification

- Focused LIVE NOW helper tests: **11/11 passed** with local Node.js v22.16.0.
- Source readback confirms the panel deletion, empty channel and pins, and existing Upcoming Events panel.
- Full repository test suite has not been run in a clean checkout.
- GitHub Actions latest runs ended `startup_failure` before a runner/job was created (zero jobs). Run metadata showed `BuildFailed` / `Unknown event`; available connector endpoints did not expose workflow/check-suite runner diagnostics. Root cause remains unknown. No repeated rerun was started.

## Active blockers

1. **Current production LIVE NOW repair:** V2 process holds a stale deleted message ID. Safe direct post is not sufficient. Integration requires a controlled V2 runtime update/restart or replacement, which cannot be done while respecting the no-Railway-operation boundary and no-parallel-Gateway requirement.
2. **Independent Gateway ownership:** V2 needs its own workload-specific lease/fencing scope and physical-stop proof. It must not share Bot 005's existing lease scope. No provider-specific, independently verified stop path exists for the currently live Railway process.
3. **CI:** GitHub Actions pre-job failure has no runner logs or jobs; cause unknown.
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
- LIVE NOW panel recovery helper and 11 tests are committed; the live runtime remains unchanged.
- Railway, bot roles, and Hostless provisioning remain untouched.

**Next execution step:** use Bun 1.4.4 in an authorized build environment to generate and commit `candidate/live-now-v2/bun.lock` with `bun install --lockfile-only`, run `bun install --frozen-lockfile`, execute the nine static tests with `npm test` or the nested test script, and perform a true no-token Bun standby boot. Keep the activation guard in place. Then add a separate LIVE NOW V2 lease/fence scope and independently verify the old process is physically stopped before any Gateway session can start. Before any activation, implement the V2 workload's independent ownership fencing and prove the old process is physically stopped. Do not restart Railway or create another Gateway session in parallel.
