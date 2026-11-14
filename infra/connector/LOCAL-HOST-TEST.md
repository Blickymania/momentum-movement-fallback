# Momentum Movement connector — local host qualification and safe test plan

Status: operator-run plan only. No host has been selected or tested. No secrets are included.

## Purpose

Qualify a trusted, continuously available host and validate the Cloudflare Workers VPC route before the Railway SSH tunnel is allowed to carry any production database traffic.

This plan intentionally separates:
1. host/network qualification,
2. a disposable local PostgreSQL-to-Cloudflare VPC smoke test, and
3. a later Railway SSH tunnel test against a non-production Railway database.

Do not skip directly to production credentials.

## Gate 0 — host trust and continuity

Proceed only if all are true:
- The machine is user-owned or explicitly approved, under the user's control, patched, and protected by a login/OS security policy.
- The machine can remain powered, connected, and awake for the required availability window. A laptop that sleeps or disconnects is not a production connector.
- The hosting provider or network owner permits a private, single-purpose SSH database tunnel and Cloudflare Tunnel. Obtain written approval where terms are ambiguous.
- The host has no public inbound database port. PostgreSQL stays bound to loopback/private networking.
- Outbound QUIC/UDP 7844 to Cloudflare is allowed.
- Secrets are stored in an OS/provider secret manager, not in source control, shell history, screenshots, or logs.
- The plan does not require a paid tier, card, trial upgrade, or unapproved billing.

If any item fails, stop and do not place Railway or Cloudflare credentials on the host.

## Gate 1 — install and verify tooling

Install current official Railway CLI and Cloudflare `cloudflared`. Workers VPC requires cloudflared 2025.7.0 or later; use 2026.5.2 or later when possible because it includes automatic tunnel connectivity pre-checks.

Run:

```sh
cloudflared version
railway --version
cloudflared tunnel diag
```

Run `cloudflared tunnel diag` from the exact host/network/firewall path that will run the connector. On versions before 2026.5.2, follow Cloudflare's manual DNS and UDP checks in the connectivity pre-check guide. A successful local TCP test alone does not prove UDP/QUIC reachability.

Expected minimum:
- cloudflared 2025.7.0+
- DNS resolves Cloudflare Tunnel endpoints
- UDP port 7844 succeeds
- Cloudflare management API connectivity succeeds

If diagnostics report UDP blocked, do not switch to HTTP/2: Workers VPC requires QUIC. Fix the network or reject the host.

## Gate 2 — disposable local database smoke test

Use a disposable PostgreSQL instance with dummy data and a test-only username/password. Do not use a production Railway connection string or copy production records.

1. Bind the test PostgreSQL listener to `127.0.0.1:15432` only.
2. Create a dedicated, remotely managed Cloudflare Tunnel for this test. Keep its token in the host secret manager.
3. Run the tunnel with QUIC:
   
   ```sh
   cloudflared tunnel --protocol quic --no-autoupdate run --token-file "$CLOUDFLARE_TOKEN_FILE"
   ```

4. Create a TCP VPC Service pointing at the loopback listener:

   ```sh
   npx wrangler vpc service create dawn-dotta-local-db-test \
     --type tcp \
     --tcp-port 15432 \
     --app-protocol postgresql \
     --tunnel-id <TEST_TUNNEL_ID> \
     --ipv4 127.0.0.1
   ```

5. Create a test Hyperdrive configuration attached to that VPC Service, using only the disposable database credentials. Prefer the Cloudflare dashboard or an interactive secret-safe method; never put production credentials in command arguments.
6. Bind that test Hyperdrive configuration to a disposable test Worker and run a harmless `SELECT 1` query.
7. Confirm the Worker reaches the local PostgreSQL instance through the VPC Service and Hyperdrive. Capture timestamps, tunnel state, and sanitized logs only.

Pass criteria:
- Cloudflare dashboard reports the test tunnel connected.
- Tunnel diagnostics show QUIC/UDP path working.
- Hyperdrive test Worker returns the expected result.
- No public TCP proxy or public PostgreSQL port exists.
- Test secrets and resources can be deleted/rotated after the test.

This proves Cloudflare VPC loopback connectivity only. It does not yet prove Railway SSH connectivity.

## Gate 3 — Railway SSH path test (non-production only)

A separate non-production Railway PostgreSQL service is required. The current production OAuth PostgreSQL service is not a test target.

When a non-production database exists and its use is authorized:
1. Verify the exact Railway project, environment, and database service IDs.
2. Use a project-scoped Railway token held in the host secret manager.
3. Start `railway connect <NONPROD_DB_SERVICE_ID> --environment <NONPROD_ENV_ID> --tunnel-only --port 15432`.
4. Verify the local listener is reachable on `127.0.0.1:15432`.
5. Point the Cloudflare VPC Service at `127.0.0.1:15432` and repeat the disposable Hyperdrive `SELECT 1` test.
6. Confirm no Railway TCP proxy was created and no public database endpoint was exposed.
7. Stop both tunnels and rotate/delete all test-only credentials.

Do not substitute the production OAuth PostgreSQL service for the missing non-production database. If no non-production Railway database is available under the existing plan, this gate remains blocked.

## Gate 4 — production readiness review

Only after all previous gates pass:
- Confirm a stable always-on host and its provider's written policy approval.
- Review least-privilege project-scoped Railway token permissions and Cloudflare tunnel token scope.
- Confirm resource limits, restart behavior, host reboot behavior, monitoring, and cost exposure.
- Prepare a documented rollback to the existing Railway Manager.
- Review production cutover separately. No production deployment, secrets, DNS, or DB route is authorized by this test plan.

## Official references

- Workers VPC requirements: https://developers.cloudflare.com/workers-vpc/configuration/tunnel/
- Private PostgreSQL via VPC and Hyperdrive: https://developers.cloudflare.com/workers-vpc/examples/private-database/
- Cloudflare connectivity diagnostics: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/connectivity-prechecks/
- Tunnel run parameters: https://developers.cloudflare.com/tunnel/reference/run-parameters/
- Railway SSH database tunnel: https://docs.railway.com/cli/connect
