# Momentum Movement — Rules Acceptance Checkpoint

Date: 2026-11-14 UTC
Project: Dawn Dotta / Momentum Movement
Repository: `Blickymania/momentum-movement-fallback`
Working branch: `codex/dawn-rules-acceptance`
Base branch: `hostless/dawn-dotta-bun-runtime`

## Objective

Add a real, persistent rules-acceptance workflow to the recovered Bot 005 candidate without changing the production Discord server or competing with the currently active Railway Gateway owner.

## Completed in this cycle

- Added `implementation/rules-acceptance.mjs`.
- Added 12 focused tests in `implementation/rules-acceptance.test.mjs`.
- Integrated a rules acceptance button handler into `candidate/bot-005/blickymania-bot-005.ts`.
- The handler accepts only the exact verified guild, application, rules channel, rules message, and custom ID.
- It acknowledges the component interaction with `deferUpdate` (no ephemeral response).
- It stores acceptance in the existing encrypted member record using the existing AES-GCM vault mechanism.
- The acceptance record stores the current policy version, timestamp, guild, channel, and source message; older policy acceptance remains in a bounded history.
- Repeated acceptance of the same policy version is idempotent. Concurrent clicks by the same member are serialized in-process.
- A receipt is sent by DM only after the encrypted write succeeds. A DM failure does not undo a successful acceptance record.
- No Discord role assignment, permission overwrite, channel access, or category change is performed.
- On candidate startup, the bot validates the existing private member vault and its encrypted-key configuration, then updates the existing rules dashboard in place to add the acceptance row. The original tabs and content are preserved and re-verified.
- The bot health endpoint now reports `rulesAcceptanceReady`.
- The existing member vault currently has zero records; its loader was hardened to paginate older records and keep the newest record per member, with a bounded scan limit that fails closed.
- Added `start:bot005` to `package.json`.
- Updated the Dockerfile to include the candidate, implementation, and Cloudflare runtime modules required by that start command. The default app command remains `start:listener` and continues to run `index.tsx`.

## Tests and verification

- Local Node.js v22.16.0 run: `node --test implementation/rules-acceptance.test.mjs` — 12 passed, 0 failed.
- Tests cover button upsert and idempotency, preservation of existing dashboard components, exact-source interaction validation, timestamp/version recording, prior-version history, sequential and simultaneous duplicate clicks, DM receipt behavior, and fail-closed storage errors.
- GitHub source inspection verified the Bot 005 candidate imports the new helper, validates the vault, upserts the button at startup, registers the interaction handler, and exposes readiness state.
- The live rules dashboard was inspected read-only: channel `1566060632384602132`, message `1566161923404341290`, authored by the expected Bot 005 application. The current message contains the existing four navigation tabs and rules text.
- The existing private member-record vault is `1570614206926033077`; its permissions already restrict it to the bot. It had no messages when inspected.
- Discord manager audit remains clean; no production write was made in this cycle.

## CI runner result

The repository's existing `.github/workflows/failover-tests.yml` is configured to run `npm test` when `implementation/**`, `candidate/**`, or `package.json` changes. Eleven push-triggered workflow runs were returned for this working branch. Each ended with GitHub Actions conclusion `startup_failure` before a job was created; the latest run's jobs endpoint returned `total_count: 0`. This is a runner/workflow-startup failure, not a failing test assertion. The focused 12-test local run remains the only executed test result for this feature. Do not claim remote CI success or repeatedly rerun the same failed workflow until the runner startup issue is resolved.

## Current production state

- Production Bot 005 remains the primary Gateway owner on Railway.
- The Bot 005 candidate is not deployed and has not connected to Discord.
- The existing Hostless app command remains `bun run start:listener`, which starts the separate LIVE & Events listener from `index.tsx`.
- Hostless configuration does not yet declare a Bot 005 worker.
- No Hostless app, worker, environment variable, secret, volume, domain, cron job, or deployment was created or changed.
- No Railway, Cloudflare, Render, Discord, or GitHub production deployment was changed.
- No bot role name, permission, position, hierarchy, or assignment was changed.
- No scheduled maintenance, cron, or reminder process was created.

## Safe cutover requirements

The current Railway production Bot 005 is still the primary Gateway owner. The repository's failover checkpoint states that the current Render/Cloudflare fencer cannot stop the Railway primary and that the initial migration requires a separately verified shutdown of that primary followed by one-time candidate bootstrap. Starting the candidate before that stop is verified risks two Bot 005 processes handling the same interactions.

Hostless supports a separate long-running worker. The intended future worker command is:

```sh
bun run start:bot005
```

Recommended initial worker resources, alongside the existing 0.2 CPU / 512 MB app: one replica, 0.2 CPU, 512 MB. Combined allocation is approximately 0.4 CPU / 1 GB. Confirm current Hostless project quota and worker availability before provisioning. The standalone worker should receive its own Bot 005 environment configuration; do not change the existing LIVE & Events app's start command or token environment.

Required Bot 005 worker configuration includes:
- `DISCORD_BOT_TOKEN` (existing bot token; provision only in Hostless secret manager)
- `AUTHORIZED_GUILD_ID=1565048205970767992`
- `APPLICATION_ID=1565304619838742598`
- `PROFILE_DATA_VAULT_CHANNEL_ID=1570614206926033077`
- `PROFILE_DATA_ENCRYPTION_KEY` (a distinct, securely generated 64-character hex key; never commit it)
- `BOT005_DEPLOYMENT_ID`
- `GATEWAY_LEASE_URL`
- `LEASE_SERVICE_TOKEN`
- `FENCE_REQUEST_TOKEN`
- `COACHING_WORKFLOW_URL`
- `COACHING_WORKFLOW_SOURCE=bot005`
- `COACHING_WORKFLOW_AUTH_SECRET` (unique, securely provisioned secret)

Before worker activation: verify the exact Railway Bot 005 service, stop it through an authorized provider operation, confirm its process and Gateway session have stopped, then provision and test the candidate lease/standby ownership. Do not stop the other six Gateway-connected services; each has a separate workload scope. Coordinate the coaching relay/HTTPS workflow migration as specified by the gateway workload inventory.

## Blockers and exact next step

**External blocker:** no connected Hostless management action is available in this session to inspect the selected project, provision its standalone worker environment, or execute a deployment. The browser tab for Hostless could not be read because its browser session returned an RPC error. Railway is past due/expired and the current fencer cannot stop the Railway Bot 005 primary.

**Next execution step:** complete a read-only inspection of the candidate branch's CI/build configuration, validate the Docker image copy paths and Bot 005 module import graph, and keep the candidate isolated. Once the Railway primary stop and Hostless worker environment are verifiably available, provision the worker and run its health, lease, button-upsert, acceptance-write, duplicate-click, and rollback tests before declaring production complete.

 
## Continuation — base synchronization and combined focused tests

- Reconciled the candidate branch against the then-current Hostless base branch and preserved its newer LIVE NOW candidate source, adapter tests, deployment plan, workload inventory, and incident checkpoint files.
- The feature branch was rechecked against the Hostless base at commit `87252f31f3c6ad27b5c7fd9eea08d5ed8b7d52f1` before this final synchronization. New base commits may arrive independently; compare before any future rebase or merge.
- Combined focused local test result: **23 passed, 0 failed** (12 rules-acceptance tests and 11 LIVE NOW recovery tests) using Node.js v22.16.0.
- GitHub Actions on the feature branch has repeatedly returned `startup_failure` before creating a runner/job. The latest inspected run returned `total_count: 0` jobs. Remote CI remains unverified; no failing test assertion or runner log is available to diagnose.
- Live Discord verification after implementation: the original rules message remains pinned, Bot 005-authored, and retains its four navigation buttons; the candidate acceptance button is not live because the candidate worker is not deployed. Read-only guild audit passed with 111 channels, 12 roles, 13 forums, 36 commands, 14 categories, and zero warnings.
- Bot 005 remains the Railway primary. The rules acceptance code is candidate-only. No Hostless worker, deployment, secret, environment setting, cron, role, member permission, or production Discord message was changed.
- Exact next step: inspect the Hostless project and provision a separate Bot 005 worker only after the Railway Bot 005 primary has been independently and verifiably stopped. That provider-side action is not available in this session; do not start a second Gateway session.

 
## Final continuation — Hostless worker documentation review

- Reviewed current Hostless worker docs: standalone workers have their own repository/branch, build/start command, runtime resources, and environment configuration; an embedded worker shares the parent app's image and environment. The standalone route is the appropriate candidate type for Bot 005 because it must have an isolated secret set and must not inherit the LIVE & Events listener's Gateway identity.
- Hostless's current shared allowance and legacy account rules depend on account billing-cycle eligibility. The published free allowance is not a per-worker extra pool; resource estimates must be checked in the user's actual Hostless account before creating anything.
- No available Hostless management action or reliable browser session exists in this session. No worker or deployment was created.
- The Hostless base branch added a separate LIVE NOW V2 candidate. It has been preserved in the synchronized feature branch but remains unrelated to Bot 005 rules acceptance; do not combine the two Gateway workloads or share Bot 005's lease.
- Current feature branch head: see GitHub branch `codex/dawn-rules-acceptance`. Latest source sync includes the then-current Hostless base plus all Bot 005 acceptance changes.

 
## Current base-branch update

- Preserved the latest independent LIVE NOW V2 candidate source and its newly added focused test file from the Hostless base branch.
- Those LIVE NOW V2 changes remain a distinct project component. They do not change Bot 005 rules acceptance ownership or its own lease scope.
- Rules acceptance remains an isolated Bot 005 candidate; production activation remains blocked on a verifiable old-primary stop and secure worker provisioning.

 
## Standalone worker packaging cycle — 2026-11-14

- Inspected the Bot 005 candidate and found that the recovered payload was not directly executable as a standalone Bun entrypoint: it included a Markdown recovery header and relied on five Discord.js symbols without importing them.
- Added executable `candidate/bot-005/index.ts` with explicit imports for `Client`, `Events`, `GatewayIntentBits`, `Partials`, and `PermissionFlagsBits`. The original recovered candidate is preserved unchanged as source material.
- Added isolated `package.json`, Dockerfile, README and package static tests. The Dockerfile copies the complete local import graph and the Bot 005-only Cloudflare lease coordinator module. It does not change the root app Dockerfile or root package/start command.
- The worker package is designed for a standalone Hostless worker with its own environment. This avoids inheriting the existing LIVE & Events app's environment.
- `bun.lock` has not been generated. This session has Node.js 22.16.0 but no Bun binary, and network access to the package registry is unavailable. The Dockerfile deliberately keeps `--frozen-lockfile` and includes the lockfile COPY; a build must fail closed until a real Bun 1.4.4 lockfile is generated, committed and a frozen install succeeds.
- Added package-static tests to verify executable wrapper equivalence, exact dependency pin, complete transitive module copying, frozen-lock enforcement, and absence of secret literals in the Dockerfile. Remote CI has not executed them; GitHub Actions continues to fail before job creation.
- No production Discord write, Hostless resource, secret, Railway action, Gateway login, bot role, permission, hierarchy, assignment, scheduler or cron was changed.
- Next step: execute `bun install --lockfile-only`, `bun install --frozen-lockfile`, `bun --check index.ts`, and both static/rules unit tests in a Bun 1.4.4 environment; then re-verify the exact Railway primary stop before worker creation or activation.

 
## No-token standby entrypoint — 2026-11-14

- Added `candidate/bot-005/standby.ts` and `start:standby` package script. It starts only a minimal HTTP `/healthz` responder, emits a structured standby-ready log, and explicitly reports `gatewayConnected: false`.
- The standby entrypoint has no Discord.js import, does not read `DISCORD_BOT_TOKEN`, and does not create a Discord client. The Bot 005 production start command remains `bun run start`.
- Updated the package Dockerfile to include the standby entrypoint and added a sixth static assertion verifying the no-token/no-Gateway standby boundary.
- When a Hostless worker can be provisioned, the initial start command should be `bun run standby` with no production secrets. Do not change to production start or add the Bot token until the legacy Railway Bot 005 process is independently stopped and the stop is verified.
- Docker build is still blocked pending a real Bun 1.4.4 lockfile. No Hostless worker has been created and no Gateway session has been started.

 
## Hostless resource and no-token deployment checkpoint — 2026-11-14

- Current Hostless documentation describes a shared account-wide pool of 0.5 vCPU and 1 GiB RAM across apps, workers, cron, databases and marketplace resources; it is not a separate free allowance for each worker. Existing billing cycles can retain legacy terms, and usage above the eligible pool can be billed. Check the account's own Cost Breakdown before provisioning.
- Bot 005's member state is persisted in the existing encrypted Discord vault, so the candidate does not need a local durable volume. The initial standby worker should use one replica and no volume.
- Added `standby.ts` and `start:standby`. Static source checks confirm it binds to `0.0.0.0`, serves only `/healthz`, emits a structured ready log, and does not read the Discord token, instantiate a Discord client, or log into a Gateway.
- The executable `index.ts` syntax-parses and exactly matches the preserved recovered Bot 005 body after the explicit Discord.js import prelude. The Dockerfile includes all 10 local runtime modules in the transitive import graph and retains frozen lockfile enforcement.
- The new six-case package-static suite has been syntax-parsed but not executed. The earlier rules acceptance + LIVE NOW focused unit run was 23/23 passed. Full hosted CI remains blocked: latest run `43657936968` returned `startup_failure` with zero jobs.
- Root `Dockerfile`, root `package.json`, and `hostless.yaml` have SHA-identical contents to the Hostless base branch, so the existing LIVE & Events app configuration was not changed.
- No `bun.lock` has been generated; no Docker build has run; no Hostless worker, volume, secrets, app settings, or deployment was created.
- Production Bot 005 remains the Railway primary; no old-process stop proof exists. Use the no-token `bun run standby` command for the first Hostless process verification only after an actual frozen build is possible. Do not switch to `bun run start` or provision a bot token until the exact Railway primary is independently stopped and the stop is verified.

 
## Readiness and encrypted vault fail-closed repair — 2026-11-14

- Source audit found that the previous ClientReady handler caught rules-button/vault failures but still set `ready=true` and called `markApplicationReady()`. This could expose a healthy-looking deployment while the acceptance feature was unavailable.
- Repaired the startup gate: `ensureRulesAcceptanceButton()` must complete with a verified button; otherwise the application shuts down and never marks itself ready. The `/healthz` output now explicitly includes `rulesAcceptanceReady`.
- Source audit also found the member-vault loader silently ignored encrypted-record decryption failures. Added `decodeEncryptedMemberVaultPage()` to the reusable rules-acceptance module. It filters to the expected bot's `MRV1.` records, keeps the newest record per member on paginated reads, and throws a generic fail-closed error for a corrupt/authentication-failed record or missing member ID.
- Bot 005 now calls `await load()` during startup before the rules dashboard update and before application readiness. Wrong encryption key/corrupt data therefore blocks readiness rather than treating the vault as empty and creating duplicate records.
- Added three unit tests for newest-record selection, ignoring other authors/unrelated messages, corrupt/decrypt-failure rejection, and invalid record IDs. The rules acceptance unit suite now contains 15 tests. Added two package-static readiness assertions; package static suite now contains 9 tests.
- These tests have not yet been executed in this runtime: GitHub Actions still fails before job creation, and Bun is unavailable. Source syntax and branch readback checks will be run after the entrypoint regeneration.
- No live Discord message, role, permission, Gateway session, Hostless resource, token, Railway service, scheduler, or cron was changed.

 
## Latest readiness and encrypted-vault verification — 2026-11-14

- Repaired a fail-open startup path: the earlier ClientReady callback could catch a vault/button verification error and still set the overall application ready. It now requires a successful vault load and a read-back-verified acceptance button before marking the application ready. On failure it shuts down; `/healthz` reports `rulesAcceptanceReady` and only returns HTTP 200 when gateway, guild and rules acceptance are all ready.
- Added `decodeEncryptedMemberVaultPage()` to the rules acceptance module. It only accepts bot-authored `MRV1.` records, requires every record to decrypt and contain a nonempty member ID, and selects the newest record per member across newest-first pagination. Corrupt ciphertext, an invalid AES-GCM key, or a malformed record now fails closed instead of being ignored as an empty vault.
- Bot 005's startup calls the existing vault loader before attempting the dashboard update. The candidate must therefore decrypt existing records before it can publish/enable the acceptance button or report ready.
- Added three unit tests for newest-first record selection, ignored non-bot/unrelated messages, decryption failure and invalid record IDs. Rules acceptance unit tests now total **15**. Package-static source tests now total **8**. LIVE NOW recovery tests remain **11**.
- Current local checks executed in this turn: executable wrapper exactly matches the preserved candidate source plus import prelude; entrypoint, standby and static-test scripts syntax-parse; the extracted vault decoder was behavior-checked for newest-record selection, unrelated-message filtering, decrypt failure and invalid member IDs; readiness/health/Docker lockfile/standby source conditions all passed **18 source/behavior assertions**. This is not a full Node `node --test` run or a Bun build.
- Previous local unit run before these latest vault-decoder additions passed 23 tests (12 rules acceptance + 11 LIVE NOW). The expanded 15-unit/8-static suite has not been executed yet. GitHub Actions run `43658295573` ended `startup_failure`; Jobs API returned zero jobs. Hosted CI remains unverified.
- The candidate branch is still ahead of `hostless/dawn-dotta-bun-runtime` and not behind it. The root `Dockerfile`, root `package.json`, and `hostless.yaml` remain unchanged (SHA comparison below).
- The live rules dashboard is still pinned and retains exactly its four original navigation buttons. The acceptance button is not live. Discord manager read-only audit passed again: 111 channels, 12 roles, 13 forums, 36 commands, 14 categories, zero warnings.
- No bot roles, role permissions, hierarchy, assignments, Discord channel permissions, messages, Railway services, Hostless resources, secrets, schedules or cron jobs were changed. Production Bot 005 remains the Railway primary.
- Remaining blockers: Bun 1.4.4 is unavailable here, no `bun.lock` exists, Docker image build has not run, there is no Hostless management connector/browser session to create a standalone worker, and no independently verifiable stop/fence for the exact Railway Bot 005 primary exists. The no-token standby command is ready in source but cannot yet be built or deployed. Do not provide a Bot token or start a Gateway until those gates are met.

### Protected root app configuration hash check

- `Dockerfile`: unchanged — feature `96673819d01df5555118738828d86485a920301b`, base `96673819d01df5555118738828d86485a920301b`
- `package.json`: unchanged — feature `b49232a9df8db9117d0ab14ed5ae09f79d443bfc`, base `b49232a9df8db9117d0ab14ed5ae09f79d443bfc`
- `hostless.yaml`: unchanged — feature `0bf8225d6d2f4fe7defabb75ae01ab75d646db10`, base `0bf8225d6d2f4fe7defabb75ae01ab75d646db10`
