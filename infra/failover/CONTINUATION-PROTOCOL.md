# Autonomous continuation protocol — Momentum Movement failover

Status: ACTIVE
Scope: Dawn Dotta / Momentum Movement only.
Owner instruction: continue execution without requiring a separate "NEXT" message.

## Operating rule
Treat this repository as the durable source of truth for continuation. On every resumption, read this file and the newest dated checkpoint before taking action. Resume from the last verified state; never repeat a completed step unless fresh evidence shows it has regressed.

For every work unit use:
INSPECT → IMPLEMENT → TEST → REPAIR → VERIFY → CHECKPOINT → NEXT CYCLE.

After a unit is complete, immediately select the next independent unfinished objective and continue while execution capacity and permissions allow. Do not send progress-only messages instead of doing available work. If a tool/session limit, auth boundary, external dependency, or user-only action stops execution, save a recovery-ready checkpoint with exact evidence and the next executable action.

## Checkpoint requirements
Every checkpoint must record:
- Project/component and scope.
- Current branch and commit.
- Completed objectives and concrete changes.
- Tests run, exact outcomes, and what was not tested.
- Production state and whether anything was changed.
- Failures, evidence, root cause confidence, repairs attempted, and retry limits.
- Existing scheduler inventory; explicitly state whether any scheduler changed.
- External blockers and exact user-only action, if any.
- Last verified state and one precise next execution step.

A successful API write or commit is not proof of runtime success. Read back written files and inspect deployed/runtime evidence before marking an objective verified.

## Continuation and communication
- Do not ask the user to say "NEXT" or re-authorize routine non-destructive inspection, code review, tests, or repairs.
- Keep the user informed at meaningful verified milestones, not with filler status updates.
- Do not imply work continues in the background after the current execution session ends. A checkpoint is the handoff mechanism; resume from it in the next available session.
- A genuine user-only action must be stated precisely. Continue all unrelated safe work rather than pausing the whole project.

## Scheduler control
- Do not create reminders, recurring automations, cron jobs, duplicate monitors, or scheduled recovery processes.
- Preserve and audit existing project schedulers.
- Maximum: one centralized scheduled maintenance/recovery process per project, only if later explicitly required and an existing process can be reused.

## Production and security guardrails
- Keep Railway production as the authoritative live Manager until a replacement has passed real build, integration, readiness, failover, and rollback verification.
- Never expose the private OAuth database through a public TCP proxy.
- Do not repurpose production services or shared databases for connector hosting.
- Do not modify another community's Cloudflare Worker or Discord server.
- No paid upgrade, payment card, or billing change.
- Do not write production secrets, alter DNS, migrate OAuth records, or cut over traffic without a verified plan and the required user authorization.
- Never replay a timed-out Discord write.
- Do not claim tests, deployments, integrations, or completion without inspecting their actual results.

## Objective queue
1. Continue source review and repair isolated migration code; run local or CI checks when a real executable environment is available.
2. Resolve GitHub Actions startup failure using evidence; do not repeatedly rerun empty jobs.
3. Find an officially supported, persistent private-network connector path that does not require public DB exposure or paid infrastructure.
4. Verify Cloudflare VPC permissions and create only Dawn-specific resources when the connector path is viable.
5. Validate Worker, Hyperdrive, OAuth database, Discord identity, health/readiness, and router failover in isolation.
6. Resolve the retired News Forum cleanup deployment failure when a permitted deployment path exists.
7. Preserve production and document rollback until all replacement checks pass.

The queue is ordered but not blocking: if one item depends on external access, continue other independent work.

## Current execution state
See the newest file named `CHECKPOINT-*.md` in this directory. The newest checkpoint overrides older notes when they conflict, while older checkpoints remain historical evidence.
