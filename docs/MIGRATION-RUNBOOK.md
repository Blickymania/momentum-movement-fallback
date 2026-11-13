# Three-day no-card migration runbook

## Safety rule

**Preparation is not cutover.** Keep Railway production, its volumes, databases, object storage, Discord bot/application, Discord guild, and all 36 live commands intact until the full destination passes verification. Do not run two copies of the same Gateway handler concurrently.

## Day 1 — Secure source and destination

### A. Preserve current state

- [ ] Capture the 34-service inventory and all exact service configurations.
- [ ] Export the decoded Bun runtime source from every service start command into private source files.
- [ ] Record service-specific environment variable *names*; move secret values only through secure provider dashboards.
- [ ] Back up PostgreSQL databases and prove that the dumps can be restored.
- [ ] Export all five Railway volumes and calculate SHA-256 checksums.
- [ ] Export the `dawn-dotta-photo-originals` bucket; record object counts, sizes and hashes.
- [ ] Capture bot/guild IDs, 36 command schemas, event intents, cron schedules, API routes, dashboard message IDs, and integration dependencies.
- [ ] Preserve the read-only Discord audit output and deployment IDs.

### B. Verify no-card accounts

- [ ] Create a Botkeep account at https://botkeep.cloud/ using a no-card signup path.
- [ ] Stop immediately if signup asks for a card or paid upgrade.
- [ ] Verify one available Free workload and the currently displayed RAM/CPU/storage allocation.
- [ ] Confirm Bun runtime is enabled and a GitHub private repository can be connected.
- [ ] Create/sign in to a Cloudflare Free account without adding a payment card.
- [ ] Verify Workers, D1 and R2 can be provisioned on the Free plan without a card.
- [ ] Never select a paid plan or paid trial.

### C. Establish staging

- [ ] Upload only non-secret source and configuration to this private repository.
- [ ] Create a Botkeep staging workload using a health-check-only app first.
- [ ] Create Cloudflare D1/R2 staging resources only after their no-card setup has been verified.
- [ ] Add secrets directly in each destination service's encrypted environment UI.
- [ ] Do not point Discord's bot token at the new runtime yet.

## Day 2 — Consolidate and port

- [ ] Consolidate Discord Gateway listeners into a shared client only after comparing all intents, event handlers, rate-limit behaviour and listener-specific write guards.
- [ ] Consolidate HTTP APIs behind one Bun router while retaining route names and response formats.
- [ ] Replace separate Railway Cron services with a durable scheduler/dispatcher; persist next-run state externally to survive restarts.
- [ ] Port PostgreSQL data and SQL deliberately to D1 or select a genuinely free no-card hosted PostgreSQL alternative only after checking that it will not consume the only Botkeep workload.
- [ ] Move image/media objects to R2 with object count + checksum reconciliation.
- [ ] Reconcile engagement, lifecycle and campaign ledger files with destination tables/objects.
- [ ] Preserve time-zone behaviour (America/New_York for community greetings; schedules must not drift at DST).
- [ ] Keep LIVE NOW and community stats in shadow/read-only mode during first parity tests.
- [ ] Remove all required paid AI/search/API dependencies from the core critical path or implement transparent disabled/fallback states.
- [ ] Add health/readiness endpoints, structured logs, memory caps, graceful shutdown and restart recovery.

## Day 3 — Verification and controlled cutover

- [ ] Run unit/integration tests and compare 36 slash command definitions against the current guild.
- [ ] Verify each slash command, component/button, modal, dashboard, and API route.
- [ ] Verify exactly one event handler processes each gateway event.
- [ ] Verify Community Stats: 12 Eastern Time two-hour periods, holiday emoji changes, default greeting, all statistics and zero-count rows.
- [ ] Verify LIVE NOW: exact channel, creator card, link conversion, no routine @everyone, authorized SOS only.
- [ ] Verify engagement: persistent ledger, daily/weekly/monthly/yearly/lifetime totals, staff view, public view.
- [ ] Verify Gift Assist with test/sandbox flow only; never process a real payment during migration testing.
- [ ] Verify Coaching request, approval, scheduling, reminder, cancellation and retention paths.
- [ ] Verify Creator Gallery safety, event media publishing, original media retrieval and duplicate prevention.
- [ ] Verify forum Gallery View / 24h archive settings are unchanged and no layout auto-repair runs.
- [ ] Verify roles/permissions and member privacy; no unwanted role assignment, message mutation or @everyone.
- [ ] Verify a backup can be restored from Botkeep/Cloudflare independent copies.
- [ ] Measure Botkeep RAM/CPU under expected peak concurrent use; hold cutover if memory headroom is not adequate.
- [ ] Switch Gateway token to new runtime only after the previous handler is stopped and rollback point recorded.
- [ ] Verify the manager API and guild are reachable through the new runtime.
- [ ] Leave Railway databases/volumes/buckets intact and idle until a separate recovery window confirms the destination.
- [ ] After cutover, monitor for at least 24 hours before requesting decommission approval.

## Cutover blockers

Do not cut over if any of the following remain:

- No verified copy of PostgreSQL data or mounted-volume files.
- R2 copy incomplete or media hashes differ.
- Missing/undocumented embedded runtime source.
- Cloudflare D1 schema/query parity not demonstrated.
- Botkeep capacity unavailable or memory/CPU use exceeds free limits.
- Required Botkeep/Cloudflare setup asks for a payment card.
- Any of the 36 commands or core member-facing workflows is missing.
- Gateway events are handled twice or not at all.
- Bot identity, guild identity or OAuth redirect does not match.
- LIVE NOW, stats, SOS, private channels, coaching or payment behavior has not passed the checks.

## Rollback

- Keep the old Railway deployment/configuration/backups and volume data until the new system is proven.
- If the new runtime fails, stop it, restore the old Discord token/runtime from the saved deployment, and verify a single Gateway session.
- Never delete the old services as part of migration. Decommission each legacy resource separately only after data restore, feature parity, and owner approval.

## Work completed in this branch

- [x] Inspected the production Railway inventory.
- [x] Verified current Discord Manager connection and read-only guild audit.
- [x] Identified the current Botkeep and Cloudflare free-plan constraints.
- [x] Created a Dawn-only migration branch and documented the target plan.
- [ ] Exported all runtime source and state.
- [ ] Provisioned destination accounts/resources.
- [ ] Built and tested the unified runtime.
- [ ] Cut over production.

No production service or Discord resource has been modified by this preparation branch.
