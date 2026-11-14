# Dawn Dotta private database connector (prepared, not deployed)

This connector is a candidate path for the isolated Cloudflare failover Worker. It does **not** create a Railway TCP proxy or expose PostgreSQL publicly.

## Architecture

`Cloudflare Worker → Hyperdrive → Workers VPC TCP Service → cloudflared Tunnel → 127.0.0.1:15432 → Railway CLI SSH tunnel → private OAuth PostgreSQL`

Railway documents `railway connect --tunnel-only` as an SSH tunnel to a database when no public TCP proxy exists. The CLI prints database connection details, so the script suppresses all Railway CLI output. Cloudflare documents `cloudflared tunnel run --token-file`, so the tunnel token is written to a mode-600 temporary file rather than passed in process arguments.

## Requirements

- A trusted, continuously running Linux/macOS host with `railway`, `cloudflared`, and `nc` installed.
- A Railway **project-scoped** token in `RAILWAY_TOKEN` (do not use a workspace token unless the CLI proves project-token access is insufficient).
- The exact Dawn production project ID, production environment ID, and OAuth PostgreSQL service ID.
- A remotely managed Cloudflare Tunnel token, stored as `CLOUDFLARE_TUNNEL_TOKEN`.
- A Cloudflare Workers VPC TCP Service targeting `127.0.0.1:15432` on this tunnel connection.

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
- Waits up to 60 seconds for the local database tunnel before starting cloudflared.
- If either tunnel process exits, stops the connector with a non-zero status. A host/container supervisor may restart it; this script creates no cron or scheduled job.
- Does not read or write database credentials directly, migrate records, change production services, or change DNS.

## Deployment status

**Prepared only. Not deployed or runtime-verified.** The connector still needs a trusted always-on host, Cloudflare Tunnel/VPC resources, and a real end-to-end test. Render Free and other sleep/short-lived tiers are unsuitable for production. Do not place Railway or Cloudflare tokens on an untrusted free VPS, and do not use a host whose terms, security, and renewal guarantees have not been reviewed.
