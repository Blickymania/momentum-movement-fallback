# Northflank service hard-stop candidate

Updated: 2026-11-14 UTC

## Decision boundary

Northflank is evaluated here as an additional provider-specific hard-stop adapter candidate for the Bot 005 workload only:

- Lease scope: `momentum-movement:bot-005-gateway`.
- The other five live Momentum Movement Gateway workloads are outside this adapter and must not be mapped or fenced through it.
- The adapter is not deployed and is not connected to a Northflank account, API token, project, service, Discord Gateway, or production Worker.
- The free Sandbox is not approved as a production hosting target. Northflank's pricing page currently advertises a no-card Sandbox with up to $20/month of Northflank Cloud resource usage, two services, and always-on compute. However, Northflank's billing documentation separately says users must add a payment method to create resources and explicitly says the free tier should not be used for production applications. Treat no-card eligibility and production suitability as unresolved until confirmed in the actual account and applicable plan terms.
- The Northflank adapter is therefore a staging/test candidate only unless an appropriate production plan, service level, billing arrangement, and account eligibility are independently verified and approved.

Official references:
- Pricing: https://northflank.com/pricing
- Billing/pricing docs: https://northflank.com/docs/v1/application/billing/pricing-on-northflank
- Pause service API: https://northflank.com/docs/v1/api/project/services/pause-service
- Get current service instance health: https://northflank.com/docs/v1/api/project/services/get-service-instance-health

## Provider API evidence

The documented service pause endpoint is:

`POST /v1/projects/{projectId}/services/{serviceId}/pause`

A 200 response confirms the pause operation was accepted/performed by the API. It is not used by itself as physical stop proof.

The adapter then reads:

`GET /v1/projects/{projectId}/services/{serviceId}/health`

It requires a complete `data.current.containers` list (`hasMore !== true`) with each container carrying an explicit boolean `terminated` and string `status`. A service is considered stopped only if every current container has `terminated === true`. Missing, paginated, malformed, or contradictory evidence fails closed. The standby candidate must have at least one current `TASK_RUNNING` container before the old service is paused.

## Source implementation in this branch

- `implementation/northflank-service-fencer.mjs` provides credential/config validation, unique primary/standby service mapping, bounded request timeouts, pause requests, live-container polling, deployment-bound owner validation, and deterministic fence-proof IDs.
- `implementation/northflank-service-fencer.test.mjs` contains eight mocked API tests for config rejection, verified stop, idempotent repeated fencing, pause acceptance without termination evidence, API failure, candidate readiness, incomplete health payload, and owner/lease binding.
- `cloudflare/worker.mjs` now supports an explicit `FENCE_PROVIDER=northflank` mode. The default remains `render`; there is no automatic provider fallback. Northflank mode requires separate `NORTHFLANK_API_TOKEN`, `NORTHFLANK_PROJECT_ID`, and `NORTHFLANK_SERVICE_IDS_JSON` settings. The existing deployment-specific `FENCE_REQUEST_TOKENS_JSON` authorization is still required.
- `implementation/cloudflare-worker-northflank-fence.test.mjs` covers the Worker route integration, per-deployment token enforcement, provider selection, missing config, pause rejection, and proof confirmation.

## Verification state and limitations

- Local Node.js v22.16.0 focused adapter test run: 8 passed, 0 failed.
- Worker route integration tests have been authored but have not yet been executed in a clean checkout. They must be run together with the full repository `npm test` and Wrangler dry-run.
- The repository's GitHub Actions workflow currently terminates with `startup_failure` before creating any jobs; this prevents hosted CI validation. The cause is not known.
- No actual Northflank API call, service deployment, service pause, container-stop verification, or cloud failover has been performed.
- A successful test against mocked provider responses does not establish the correctness of actual provider credentials, permissions, project/service IDs, quota, billing, or runtime semantics.

## Candidate Worker configuration

Only in a dedicated test Worker after account authorization:

- `FENCE_PROVIDER=northflank`
- `NORTHFLANK_API_TOKEN` — Worker secret only
- `NORTHFLANK_PROJECT_ID` — provider project ID
- `NORTHFLANK_SERVICE_IDS_JSON` — JSON map containing exactly the Bot 005 primary and standby deployment IDs/service IDs
- `FENCE_REQUEST_TOKENS_JSON` — existing unique deployment-scoped request tokens

Do not set these in the live production Worker until the provider account, hosting eligibility, plan, service mappings, secret controls, and end-to-end test are approved. Do not reuse or broaden Bot 005's lease mapping for the other five Gateway workloads.

## Exact next validation steps

1. Run the complete `npm test` in a clean Node.js 22 checkout, including the new Worker route tests.
2. Run `npx wrangler@4.161.0 deploy --dry-run --config cloudflare/wrangler.jsonc`.
3. Review this draft branch and PR; do not merge until tests and the CI runner issue are resolved.
4. Verify whether the user's Northflank account can create a test project without a payment method and under what terms; do not provision a resource as part of this source-only change.
5. If a permitted test project is available, run an isolated service-level pause/health-readback exercise using non-production processes only.
6. For production, select a suitable non-sleeping host plan with appropriate operational terms. The free Sandbox is not assumed to be production eligible.
7. Preserve Bot 005 as the sole live primary until an independently hosted primary/standby, provider hard-stop, coaching workflow/relay parity, rollback, and the one-time Railway-to-independent cutover procedure are verified.

## Initial Railway-to-Northflank cutover is a separate gate

The current live Bot 005 primary is a Railway Function deployment, not a Northflank service. This Northflank adapter can only pause and inspect services that belong to the configured Northflank project. It cannot stop the current Railway deployment, and a Railway deployment ID must never be submitted to the Northflank API.

The first Railway-to-independent move therefore requires a separate Railway-native teardown mechanism or an operator-controlled cutover. Any Railway removal adapter must target the exact active deployment, verify the associated project/service/environment, and wait for Railway's authoritative terminal `REMOVED` state before allowing the new Gateway owner to connect. Do not use a simple HTTP 200 pause/stop response as proof. Railway documents that removal proceeds through teardown and reaches `REMOVED` only after all replicas have been terminated; this removes the deployment from history and must be treated as a deliberate operational action.

The live Bot 005 source currently calls the Railway-private coaching URL. The candidate uses a configurable external HTTPS workflow URL. Both Bot 005 and the separate Coaching Interaction Relay must be accounted for when migrating this workflow. Also, the live and candidate source expose the same 36 command names, but the candidate itself reports `originalFeatureParity:false`; command-name equality is not proof of full behavior parity.
