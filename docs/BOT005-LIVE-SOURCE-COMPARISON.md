# Bot 005 live source comparison

Audited: 2026-11-14 UTC

## Production deployment identity

- Railway project: `a1d6b0e4-3169-4c5d-add3-84a70f7dc525`
- Environment: `c72ea3d9-2c1c-4651-a265-79723e317fa5`
- Service: `Blickymania Bot 005` / `328ad9bb-7db8-4f9a-9a72-f91b73ef9fc9`
- Latest successful deployment: `56f53caa-6ca5-449b-91f5-dabe276a117f`
- Runtime: Railway Function / Bun `1.4.4`
- Service source is embedded in the Function start command. It is not configured as a normal GitHub repo deployment. A source replacement must use the Function-specific update path and is a live deployment unless first staged.

## Read-only decoded production-source findings

The deployed Function source wrapper was decoded in memory for inspection only. No source file or service configuration was changed.

- It imports discord.js 14.27.0, creates a Discord Client, starts the HTTP health server, then calls `client.login(token)`.
- The live source does not contain `prepareFencedDiscordGatewayOwner`, `GATEWAY_LEASE_URL`, or any lease integration. It is still an unfenced single primary.
- The live source does not require `DATABASE_URL`.
- The current coaching interaction path calls the internal Railway-only URL `http://coaching-workflow.railway.internal:3000/interaction`.
- The live command registry contains 36 command names.

## Candidate/recovered source comparison

Compared:
- Live decoded source from deployed Railway Function.
- `recovered/railway/blickymania-bot-005.ts`
- `candidate/bot-005/blickymania-bot-005.ts`

Findings:
- Live source and the recovered source each expose the same 36 command names.
- The candidate also exposes the same 36 command names.
- The candidate imports/uses `prepareFencedDiscordGatewayOwner` and the Bot 005 lease scope.
- The candidate replaces the hard-coded Railway-only coaching URL with `COACHING_WORKFLOW_URL` and deployment-specific authentication/source settings.
- All three source files do not require `DATABASE_URL`.

**Important limitation:** Matching 36 command names is not proof of handler-body parity, member interaction correctness, or feature parity. The candidate's own health/diagnostic surface flags `originalFeatureParity:false`; this must be treated as a real open test gate. Full interaction-by-interaction regression tests and a non-production gateway session are required before cutover.

## Migration requirements

- Do not call `update_function_source_code` against the live Bot 005 service as part of an untested migration. That function replaces the entire source file and applies live by default; a staged change and controlled deployment review are required.
- Before independent hosting, migrate the coaching workflow to a reachable HTTPS endpoint with its authenticated receiver, and account for both ingress paths: Bot 005 and the separate Coaching Interaction Relay. Preserve workflow semantics, HMAC validation, idempotency and retry/recovery behavior.
- The current Northflank fencer can pause only Northflank services. It cannot terminate the existing Railway Bot 005 deployment. The initial Railway-to-independent cutover requires a separate Railway-native stop/removal step with authoritative teardown verification, or a carefully controlled operator cutover. Never submit a Railway deployment ID to the Northflank API.
- After the primary/standby pair is on an independently hosted production-eligible platform, the matching provider adapter must map only the exact Bot 005 pair and keep the other five Gateway workloads out of scope.

## Exact next tests

1. Compare every live handler body with the recovered and candidate implementation, not just the command names.
2. Test all 36 command paths, button/select/modal interactions, event handling, permission checks, and health/READY behavior.
3. Exercise candidate Bot 005 with a dedicated test Discord application/guild before granting production credentials.
4. Test coaching receiver authentication and replay/idempotency, including process failure after claim but before dispatch.
5. Verify provider-specific old-owner hard-stop and the one-time Railway cutover procedure before production migration.
