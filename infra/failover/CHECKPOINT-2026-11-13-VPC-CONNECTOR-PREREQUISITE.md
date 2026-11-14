# Momentum Movement failover — connector prerequisite checkpoint

Updated: 2026-11-13
Scope: Dawn Dotta / Momentum Movement only. No other community may be changed.

## Current cycle

Reviewed the prepared Railway SSH + Cloudflare Workers VPC connector against current official provider documentation. The architecture's loopback hop is supported in principle:
- Railway documents that `railway connect --tunnel-only` opens a local SSH forward bound to `127.0.0.1:<port>` when using its SSH tunnel path.
- Cloudflare Workers VPC's getting-started guide explicitly allows `localhost` as the VPC Service host.
- Cloudflare's private PostgreSQL guide documents a TCP VPC Service, Hyperdrive `--service-id`, the `HYPERDRIVE` binding, and node-postgres `pg` as the database client.

This is a documentation-backed design check, **not** a live connectivity test. The tunnel, VPC Service, Hyperdrive, and Worker are still not provisioned.

Official references:
- https://docs.railway.com/cli/connect
- https://developers.cloudflare.com/workers-vpc/get-started/
- https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/
- https://developers.cloudflare.com/workers-vpc/configuration/tunnel/

## Implemented

Committed to branch `infra/dawn-dotta-cloudflare-worker`:
- `infra/connector/railway-cloudflare-tunnel.sh`: now checks `cloudflared` version before creating temporary files or starting processes. Workers VPC requires cloudflared 2025.7.0 or later; older or unparseable versions fail closed.
- `tests/connector-script.test.mjs`: added a regression assertion for the Workers VPC version prerequisite.
- `infra/connector/README.md`: documents the loopback target, correct minimum cloudflared version, and a sample TCP VPC Service command using `localhost:15432`.

Latest commit: `64727c4a9f2a034bfcd28a84f406cf05be3c1eed`.
The three updated files were fetched back from GitHub and their blob SHAs verified:
- connector script: `4899e590b0b98e037f3891453b0bbd1b12c2d2d3`
- connector test: `9f936c52d7051f9abeb72da44feb6e4f246b00b8`
- connector README: `2256e57d0a85931256c3d403a6030f2988553a4e`

## Validation

- Native Node.js 22 `node --test tests/connector-script.test.mjs`: **4/4 passed** against the exact fetched connector script and test file content reconstructed in an isolated temporary test directory.
- `sh -n` shell syntax check: passed as part of that native test.
- Version comparison boundary checks: 2025.6.x rejected; 2025.7.0, 2025.7.1, and 2026.0.0 accepted.
- Five additional exact-blob source assertions: 5/5 passed for version guard, Railway output suppression, token-file handling, no public Railway TCP proxy, and version regression test presence.
- These checks cover the connector script only. They do not validate the complete project TypeScript dependency graph, Wrangler bundling, Cloudflare deployment, live Railway SSH connectivity, VPC routing, Hyperdrive connectivity, OAuth database operations, or Discord manager behavior.

## Remaining blockers

- No trusted always-on connector host has passed policy, security, and billing review. Hostless remains blocked pending written approval for this exact tunnel use; no secrets were placed there.
- GitHub Actions previously failed before job creation with zero jobs. No CI success is claimed.
- Project-level TypeScript/Wrangler checks remain blocked by unavailable npm registry DNS in the local execution environment.
- No Cloudflare Tunnel, VPC Service, Hyperdrive binding, Worker, DNS, or production cutover has been created.
- Railway production Manager and OAuth PostgreSQL remain authoritative and untouched.
- No public PostgreSQL TCP proxy, new cron, scheduler, or recurring automation was created.

## Next execution

1. Continue searching for a trusted, compliant persistent host or a provider-approved alternative; no production secrets until approved.
2. Establish a non-production loopback TCP test proving Cloudflare VPC can reach the Railway SSH-forwarded listener.
3. Obtain a functioning project dependency install and run the complete Node test suite, TypeScript typecheck, and Wrangler dry-runs.
4. Investigate the GitHub Actions pre-runner startup failure through an available diagnostics path.
5. Keep production unchanged until end-to-end verification and rollback are ready.
