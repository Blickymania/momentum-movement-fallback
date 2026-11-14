# Momentum Movement failover — QUIC and host-screen checkpoint

Updated: 2026-11-13
Scope: Dawn Dotta / Momentum Movement only. No other community may be changed.

## Cloudflare Workers VPC requirements rechecked

Official Cloudflare documentation confirms:
- `cloudflared` must be version 2025.7.0 or later for Workers VPC.
- Workers VPC requires QUIC transport (`auto` or `quic`) and outbound UDP port 7844.
- Cloudflare's private PostgreSQL example creates a TCP VPC Service with an explicit IPv4 destination, then attaches Hyperdrive to the VPC Service ID.
- Cloudflare's VPC get-started guide describes the tunnel as running on a VM, container, or local desktop in the private network. The service target must be reachable from that host.
- Workers VPC is beta and currently free on all Workers plans.

References:
- https://developers.cloudflare.com/workers-vpc/configuration/tunnel/
- https://developers.cloudflare.com/workers-vpc/get-started/
- https://developers.cloudflare.com/workers-vpc/examples/private-database/
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/connectivity-prechecks/

## Connector changes committed

Updated files on `infra/dawn-dotta-cloudflare-worker`:
- `infra/connector/railway-cloudflare-tunnel.sh`: explicitly starts `cloudflared tunnel --protocol quic`, preventing fallback to HTTP/2 that Workers VPC does not support.
- `tests/connector-script.test.mjs`: added a test asserting QUIC is explicitly forced.
- `infra/connector/README.md`: updated TCP VPC Service example to use `--ipv4 127.0.0.1`, documents UDP 7844 egress, QUIC transport, and the VPC-compatible cloudflared version floor.

Latest relevant commits:
- QUIC connector: `ea6138ca4ade4e558286391bb851952d0d619420`
- QUIC regression test: `979f7cfa62b8ebb063e2f9ada6fa5eb0c8213ace`
- README alignment: `1d0cf51ea1a4ef075e9504b2bbbdc4bfc6f5f858`

Files fetched back from GitHub:
- connector script blob: `34145cd9a485c15d181aacac1a288856308a8b81`
- connector test blob: `5c9a0a541f94d952c86e09bce40b30ee17f60a08`
- README blob: `3137cfb293bde5883ddc57cac727e7ae8ce66518`

## Validation

- Exact fetched connector script and test reconstructed in an isolated temporary directory and executed with native Node.js 22 `node --test`: **5/5 passed**.
- `sh -n`: passed.
- Tests cover shell syntax, minimum cloudflared version guard, secret/log handling, explicit QUIC, and no public Railway TCP proxy.
- These are connector-script tests only; they do not prove real UDP egress, tunnel connection, VPC route, Hyperdrive, or DB integration.

## Additional host assessment

Cloudflare Containers are not a viable no-cost persistent connector host:
- Official docs say Containers are available only on the Workers Paid plan, starting at $5/month.
- Free plan container CPU, memory, and disk allotments are listed as unavailable.
- Containers can sleep after inactivity and the platform can stop an active instance during host events; no guaranteed continuous runtime is provided.
- No paid plan or billing change is authorized.

References:
- https://developers.cloudflare.com/containers/
- https://developers.cloudflare.com/containers/platform/pricing/
- https://developers.cloudflare.com/containers/faq/

Other no-card candidates screened earlier remain rejected or blocked: Hostless needs written provider approval for the tunnel workload and stronger security/billing review; Deplexo's terms prohibit relevant tunneling; dockxo and Kubeara require customer-owned compute; SnapDeploy sleeps on free tier. No production credentials were placed on any of them.

## Current production read-only recheck

Railway production environment was rechecked on 2026-11-13:
- 34 services; no pending work.
- Dawn Dotta Discord Manager is Online, deployment `f878c9c8-4513-4d44-9a80-d546096d074f`, 1/1 replicas, no active warnings or criticals.
- OAuth PostgreSQL is Online, deployment `c231847f-46aa-4808-a026-106062f2f860`, 1/1 replicas, no active warnings or criticals.
- Dawn Dotta Community Stats Sync most recent run succeeded.
- Dawn Dotta Gallery Discovery Engine most recent run succeeded.
- The only reported issue remains Dawn Dotta News Forum 24h Retention Cleanup: crashed old deployment `582277d8-108d-4d22-b214-0286be447404`, 0/1 replicas, one critical issue. Its known cause remains the retired forum target returning Discord 404. No redeploy or config change was made.
- GitHub Actions run `43543501851` still reports an empty job list; no CI pass is claimed.

## Safety and deployment status

- No Cloudflare Tunnel, VPC Service, Hyperdrive, Worker, DNS, or production cutover was created.
- No Railway service, variable, secret, database, deployment, or schedule was changed.
- No public database TCP proxy was created.
- No new cron, monitor, reminder, or scheduled automation was created.
- Production Manager and OAuth PostgreSQL remain authoritative.

## Next execution

1. Continue evaluating trusted, policy-compliant persistent compute. Do not use paid or card-required infrastructure.
2. If no approved host is available, prepare an operator-run local-host test package with no secrets embedded; do not claim it was executed.
3. Continue complete project typecheck, Node suite, and Wrangler dry-runs when dependency access becomes available.
4. Keep the CI pre-runner failure and retired cleanup deployment documented; do not change production to mask either.
5. Do not cut over until a non-production end-to-end VPC/Hyperdrive/PostgreSQL test and rollback plan pass.
