# Dawn Dotta private database connector (prepared, not deployed)

This connector is a candidate path for the isolated Cloudflare failover Worker. It does **not** create a Railway TCP proxy or expose PostgreSQL publicly.

## Architecture

`Cloudflare Worker → Hyperdrive → Workers VPC TCP Service → cloudflared Tunnel → localhost:15432 → Railway CLI SSH tunnel → private OAuth PostgreSQL`

Railway documents `railway connect --tunnel-only` as an SSH tunnel that binds a local listener at `127.0.0.1:<port>` when no public TCP proxy exists. Cloudflare's private PostgreSQL example creates a TCP VPC Service with an explicit IPv4 target. For this same-host loopback design, the intended target is `127.0.0.1:15432` on the machine running `cloudflared`. This loopback route still requires an end-to-end TCP test before production use.

Cloudflare Workers VPC requires `cloudflared` version **2025.7.0 or later**, QUIC transport (`auto` or `quic`), and outbound UDP port `7844`. This connector explicitly forces `--protocol quic` so it cannot silently fall back to unsupported HTTP/2. The connector checks the minimum version before creating temporary files or starting either tunnel process. Cloudflare also documents `cloudflared tunnel run --token-file`, so the tunnel token is written to a mode-600 temporary file rather than passed in process arguments.

Example VPC Service creation (replace the tunnel ID with the newly created Dawn-specific tunnel):

```sh
npx wrangler vpc service create dawn-dotta-oauth-postgres \
  --type tcp \
  --tcp-port 15432 \
  --app-protocol postgresql \
  --tunnel-id <DAWN_TUNNEL_ID> \
  --ipv4 127.0.0.1
```

The resulting VPC Service ID is then used by the Hyperdrive configuration. Do not create these resources until the isolated end-to-end test plan and account permissions are confirmed.

## Requirements

- A trusted, continuously running Linux/macOS host with `railway`, `cloudflared` 2025.7.0 or later, and `nc` installed.
- A Railway **project-scoped** token in `RAILWAY_TOKEN` (do not use a workspace token unless the CLI proves project-token access is insufficient).
- The exact Dawn production project ID, production environment ID, and OAuth PostgreSQL service ID.
- A remotely managed Cloudflare Tunnel token, stored as `CLOUDFLARE_TUNNEL_TOKEN`.
- A Cloudflare Workers VPC TCP Service targeting `127.0.0.1:15432` on this tunnel connection, with outbound UDP port `7844` permitted to Cloudflare.

## Runtime variables

- `RAILWAY_TOKEN`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_ENVIRONMENT_ID`
- `RAILWAY_DATABASE_SERVICE_ID`
- `CLOUDFLARE_TUNNEL_TOKEN`
- Optional `LOCAL_FORWARD_PORT` (default `15432`)

Run `sh infra/connector/railway-cloudflare-tunnel.sh` after installing the required binaries and injecting secrets through the host's secret manager.

## Safety behavior

- Uses Railway's SSH tunnel path; never creates a public TCP proxy.
- Runs from a temporary working directory, so Railway link metadata is not written into the repository.
- Suppresses Railway CLI stdout/stderr because `--tunnel-only` prints database connection credentials.
- Writes the Cloudflare tunnel token to a temporary file with restrictive permissions and removes it on exit.
- Waits up to 60 seconds for the Railway SSH database tunnel before starting cloudflared.
- Forces QUIC transport for Workers VPC and requires outbound UDP port 7844; does not allow a silent HTTP/2 fallback.
- If either tunnel process exits, stops the connector with a non-zero status. A host/container supervisor may restart it; this script creates no cron or scheduled job.
- Does not read or write database credentials directly, migrate records, change production services, or change DNS.

## Deployment status

**Prepared only. Not deployed or runtime-verified.** The connector still needs a trusted always-on host, Cloudflare Tunnel/VPC resources, and a real end-to-end test. Render Free and other sleep/short-lived tiers are unsuitable for production. Do not place Railway or Cloudflare tokens on an untrusted free VPS, and do not use a host whose terms, security, and renewal guarantees have not been reviewed.
