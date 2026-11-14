# Dawn Dotta / Momentum Movement — Failover Checkpoint

Updated: 2026-11-13 (US Eastern) / 2026-11-14 UTC

## Current live state

> **Superseded inventory correction (2026-11-14):** The earlier statement that Bot 005 was the only active Gateway owner in this Railway project is incorrect and must not be used for migration planning. A later read-only audit identified six live Gateway-connected workloads in the Momentum Movement project. Bot 005's new lease scope covers only its own primary/standby pair; the other five workloads, including the Coaching Interaction Relay, remain independent. See `docs/MOMENTUM-MOVEMENT-GATEWAY-WORKLOAD-INVENTORY.md`.

- Bot 005 remains the current primary for its own command/interaction workload on Railway.
- Bot 005's latest Railway deployment is still the successful deployment from 2026-11-11.
- Runtime logs show Bot 005 resumed its Discord Gateway at 2026-11-14 02:49 UTC.
- The Dawn Dotta Discord Manager is connected; the latest read-only guild audit passed.
- PostgreSQL is deployed in the Dawn Dotta production project and its latest deployment succeeded.
- Core Shadow's currently running deployment remains the original read-only build from 2026-11-03.
- Core Shadow does not open a Discord Gateway and does not write Discord data.

## Source recovery

The following production source snapshots were recovered and committed:

- `recovered/railway/blickymania-bot-005.ts`
- `recovered/railway/momentum-movement-core-shadow.ts`

The new read-only preflight implementation is committed at:

- `implementation/momentum-movement-core-shadow-preflight.ts`

Recovery commits:
- Bot 005 source: `772f4cab136810e94c5d5748fd3729d2830b98b0`
- Core Shadow source: `fea653186ba3ff4638b0189e19c9b84fd49b3849`
- Core Shadow preflight source: `4de12c4a3155adfdb2cca84ab8e745b00f75a72f`

## Prepared Railway configuration

Core Shadow's service configuration now contains the preflight start command and `/readyz` healthcheck. Its variables include:

- `DATABASE_URL` → Railway reference to `Postgres.DATABASE_URL`
- `PRIMARY_HEALTH_URL` → Bot 005 private `/healthz` endpoint
- `CORE_MODE=shadow`
- `CORE_DISCORD_WRITES_ENABLED=false`
- `GATEWAY_TAKEOVER_ENABLED=false`

The variable update skipped deployment. The start-command and healthcheck configuration were saved, but the redeploy was rejected because the Railway trial has expired. The latest live deployment ID therefore remains `1eccafac-0f7e-468a-8f02-2a44c5200294`; the running container is still the original read-only Core Shadow.

## Safety constraints

- Do not start a second Gateway connection before both services use the same PostgreSQL ownership lock.
- Do not enable `GATEWAY_TAKEOVER_ENABLED` until the primary bot has lease acquisition, heartbeat, fail-closed disconnect, and standby behavior.
- Keep Core Shadow's Discord writes disabled until it has acquired the production lease and the full Bot 005 command handlers are installed.
- Never commit runtime secrets or retrieve plaintext credential values for this work.
- Do not claim failover is complete until forced failover and failback tests prove exactly one Gateway owner at a time.

## Next execution sequence

1. Restore Railway deployment access; the current blocker is the expired trial, not a code or Discord authorization failure.
2. Redeploy Core Shadow and verify PostgreSQL connectivity, two-session advisory-lock exclusivity, lock release/reacquisition, and Bot 005 health probing.
3. Implement one shared production advisory-lock protocol in Bot 005 and Core Shadow. Bot 005 must acquire the lock before `client.login`; Shadow must remain Gateway-idle until it acquires the same lock.
4. Add heartbeat failure handling that destroys the Gateway client before a process can continue without its lease.
5. Implement primary-priority failback so Bot 005 can reclaim ownership without overlapping Gateway sessions.
6. Run controlled failure tests: primary process stop, primary Gateway disconnect, PostgreSQL connection loss, standby takeover, primary recovery, failback, and duplicate-owner prevention.
7. Verify Discord command handling and health/readiness after each transition.

## Verified limitations

- The preflight implementation is prepared but has not been deployed or runtime-tested because Railway refused the redeploy.
- The PostgreSQL advisory lock test is diagnostic-only; it is not yet the production ownership lock.
- Automatic Gateway takeover and failback are not implemented yet.
