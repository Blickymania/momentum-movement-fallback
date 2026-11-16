# Claude MCP Gateway Checkpoint — 2026-11-16 — Dawn Local Auth Configs Verified

## Project and scope
- Repository: `Blickymania/momentum-movement-fallback`
- Branch: `infra/claude-five-server-gateway-staging`
- Scope: Dawn Dotta / Momentum Movement staging source, tests, and runbook only.
- The four other Discord manager projects remain locked and untouched. Do not inspect, modify, deploy, configure, or audit their independent projects without explicit authorization.
- Do not change any Dawn bot role, role permission, role hierarchy, role position, or assignment.
- No production deployment, production merge/cutover, live Discord writes, or bot-role changes are part of this checkpoint.

## Completed cycle — repair missing local Auth config preparation
- Identified a dangling package command in `claude-gateway/package.json`: `prepare:dawn:deploy-configs` referenced a script absent from the active branch.
- Added `claude-gateway/scripts/prepare-dawn-deploy-configs.mjs`.
- Added `claude-gateway/.gitignore` entries for the three account-specific local Auth configs.
- Added `claude-gateway/test/prepare-dawn-deploy-configs.test.ts` with five tests:
  1. Missing KV ID fails closed and creates no files.
  2. Valid 32-character ID produces all three Auth profile copies, keeps committed templates unchanged, checks owner-only file permissions, and does not print the ID.
  3. Existing destination is never overwritten and siblings are not created.
  4. All profiles are validated before any output is created.
  5. All generated local profiles are ignored by Git.
- The helper accepts only a nonzero 32-character hexadecimal ID, validates the Dawn Auth Worker identity, the intended Service Binding set per profile, disabled preview URLs, variable-preservation safeguards, blank template placeholder, and the OAuth Durable Object binding/migration. It validates all targets before writing, uses exclusive file creation with mode `0600`, refuses overwrites, cleans up partial output on failure, and does not print the namespace ID.
- Generated local profiles:
  - `auth-worker/wrangler.dawn-dotta-bootstrap.local.jsonc`
  - `auth-worker/wrangler.dawn-dotta.local.jsonc`
  - `auth-worker/wrangler.dawn-dotta-workers-dev.local.jsonc`
- Code commit: `01a927e79bf93decfa4f8e4fc915636f30b4c4e3`.

## Test and verification evidence
- GitHub Actions run: [43962359403](https://github.com/Blickymania/momentum-movement-fallback/actions/runs/43962359403)
- Run conclusion: `success`; tested head: `01a927e79bf93decfa4f8e4fc915636f30b4c4e3`.
- Node.js 22 setup and `npm ci --no-audit --no-fund`: completed successfully.
- Strict TypeScript check: completed successfully.
- Unit/configuration suite: 94 tests passed across 11 files, including all five new local-config helper tests.
- Auth Worker integration suite: 12 tests passed across 3 files.
- Proposal / owner-approval / MCP / resource Worker integration suite: 24 tests passed across 4 files.
- Total: 130 passing tests.
- All six offline Wrangler dry-runs passed:
  - Dawn manager.
  - Dawn Auth bootstrap.
  - Dawn Auth private.
  - Dawn Gateway private.
  - Dawn Auth `workers.dev`.
  - Dawn Gateway `workers.dev`.
- Dry-runs bundled and exited without upload. This is source/config validation, not deployment or live Service Binding verification.

## Runbook repair
- Updated `docs/CLAUDE-MCP-GATEWAY-STAGING-DEPLOYMENT-RUNBOOK.md` to use the tested local-config preparation command and the generated `.local.jsonc` filenames.
- The committed Auth templates must remain blank for `OAUTH_KV`; the actual namespace ID is entered only through a hidden terminal prompt and used to generate ignored local files.
- Verified the runbook now uses:
  - `npm run prepare:dawn:deploy-configs`
  - The generated bootstrap, private-final, and public Auth `.local.jsonc` paths.
- Documentation commits:
  - `db423b426dd945a0f3dbfe15f9c8595137e6772b` — align deployment sequence with local generated configs.
  - `9d980376ba101bd07601f7cd87ccafcd9d5e632f` — correct the shell prompt newline.
- These documentation-only commits followed the successful code CI run and do not change tested application source/configuration.

## Scheduler and automation audit
- `.github/workflows/claude-gateway-checks.yml`: push/PR/manual trigger only; test and offline validation; no deployment step and no schedule.
- `.github/workflows/oauth-db-migration.yml`: manual workflow dispatch only; no schedule. Not executed.
- `.github/workflows/validate-worker.yml`: push/PR triggers for its separate existing branch; no schedule. Not executed in this cycle.
- No cron, scheduled maintenance task, reminder, recurring recovery, or duplicate monitoring process was created or changed.
- Durable Object expiry alarms remain data-lifecycle cleanup for individual one-time/proposal records, not a centralized project maintenance scheduler.

## Last verified state
- Code test commit: `01a927e79bf93decfa4f8e4fc915636f30b4c4e3`.
- Current branch head immediately before this checkpoint: `9d980376ba101bd07601f7cd87ccafcd9d5e632f`.
- CI run `43962359403`: success, 130 tests passed, six offline Wrangler dry-runs passed.
- Local-config helper exists, is included in unit tests, and is exposed by the existing package script.
- Runbook points to generated local Auth configs rather than editing tracked placeholders.
- No secret values or account identifiers were read or written.
- No Cloudflare Worker, KV namespace, route, custom domain, Service Binding, or secret was created or deployed.
- No live OAuth / Claude client acceptance or live Discord read/write was performed.
- No production or Discord resources changed.

## External blockers and required inputs
- A writable Cloudflare staging account/session or authorized account-owner execution is required to create/verify the dedicated Dawn staging KV namespace, configure the account `workers.dev` subdomain or approved hostnames, enter dashboard-managed variables, and configure secrets. No writable Cloudflare connector/session is available in this execution.
- Required Dawn staging inputs remain unverified/unconfigured:
  - Dedicated staging `OAUTH_KV` namespace ID.
  - Account `workers.dev` subdomain or approved HTTPS hostnames.
  - Dawn Discord guild/application IDs.
  - Discord OAuth application client ID, client secret, and exact redirect URI.
  - Auth session-encryption key and owner-approval internal secret.
  - Dawn manager bot token and matching unique manager write secret, plus the matching Gateway secret.
- Secret values must be entered only via Cloudflare's encrypted secret controls, not source files, command-line arguments, GitHub, logs, or chat. Do not reuse production secrets.
- The local preparation helper was not run with an actual account namespace ID. CI unit tests use synthetic fixture values only; the offline Wrangler dry-run uses a temporary dummy namespace ID in a temporary config and cleans it up.
- No deployment should begin until the actual staging namespace and all other account-owned inputs are available and verified.

## Exact next execution step
1. Obtain writable access to the authorized Cloudflare staging account or have its owner create the dedicated Dawn-only staging KV namespace and provide the namespace ID securely through their local terminal.
2. From `claude-gateway`, run the hidden-prompt `npm run prepare:dawn:deploy-configs` sequence in the deployment runbook; verify the three ignored files exist and match the dedicated Dawn namespace without printing the ID.
3. Complete the remaining Dawn staging variables/secrets and the account `workers.dev` subdomain/approved HTTPS hostnames using Cloudflare controls.
4. Follow the Dawn-only private bootstrap order in the runbook, verifying private Service Bindings before enabling the Auth and Gateway public endpoints.
5. Complete real Claude OAuth/reconnect and read-only acceptance. Do not perform live message/channel writes absent separate explicit approval. Preserve all Dawn bot roles unchanged.
6. Keep the four locked manager projects and production completely untouched.
