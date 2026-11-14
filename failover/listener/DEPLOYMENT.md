# Momentum Movement listener host deployment checklist

This is a Dawn Dotta-only deployment guide for the isolated listener. It does not authorize production cutover.

## Prerequisites

- The Cloudflare lease coordinator is deployed and its `GET /health` endpoint reports `ok: true`.
- The Worker HTTPS URL is known.
- A high-entropy `LEASE_CONTROL_TOKEN` has been generated and stored as a secret.
- The GitHub repository contains this branch and the private repo can be connected to the host.
- Do not add a payment method, choose a paid tier, or exceed a provider's free allocation. Stop if a provider requires payment to enable the needed free workload.

## Primary: Botkeep

1. Create or use one Botkeep account and select its Free tier. The currently published new-signup allocation is one workload slot, 512 MB RAM, 50% shared CPU, and 1 GB storage.
2. Connect the private repository `Blickymania/momentum-movement-fallback` using Botkeep's GitHub integration.
3. Set the project root/directory to `failover/listener`.
4. Select the Bun runtime and use the package start script: `bun run start`.
5. Configure the environment variables below in the provider's secret/environment settings, with `LISTENER_RUNTIME_ACTIVE=false` during preparation.
6. Deploy and verify the build plus the read-only `/preflight` endpoint without connecting to Discord. Do not enable runtime leadership while the existing Railway listener is online.

Botkeep describes its Free runtime as continuous without manual renewal, but its beta has no uptime SLA.

## Standby: Silly Development

1. Create or use one account and select the free server allocation. The provider publishes Bun support, 256 MB RAM, 25% CPU, 512 MB disk, no card, no trial, and no expiry/renewal.
2. Upload or connect the same private repository source; use `failover/listener` as the working directory.
3. Select Bun and start with `bun run start`.
4. Configure the same environment variable names below, using the same Dawn Dotta bot token and lease coordinator, with `LISTENER_RUNTIME_ACTIVE=false` during preparation.
5. Deploy and verify the build plus the read-only `/preflight` endpoint without connecting to Discord. After the old Railway listener is stopped, enable Botkeep first and wait until it logs `momentum-listener-lease-acquired` and `creator-widget-gateway-ready`. Only then enable Silly Development; it must log `momentum-listener-standby-waiting-for-lease` and must not open a Gateway connection.

Silly Development's acceptable-use policy prohibits file storage, media-server, and CDN workloads. Use it only for the small listener process, never for the original media vault or backup storage. Its free service has no uptime guarantee.

## Required environment variables on both hosts

| Variable | Value |
|---|---|
| `DISCORD_BOT_TOKEN` | Dawn Dotta bot token only; store as a secret |
| `LISTENER_RUNTIME_ACTIVE` | `false` during preparation; set `true` on Botkeep first after stopping Railway, then set `true` on Silly Development only after Botkeep holds the lease |
| `LISTENER_LEASE_URL` | HTTPS Worker origin, for example the deployed `workers.dev` URL |
| `LISTENER_LEASE_TOKEN` | Same high-entropy `LEASE_CONTROL_TOKEN` stored in Cloudflare; secret |
| `PORT` | Use provider-injected port if available; otherwise `8080` |
| `LIVE_V2_CUTOVER` | Keep `false` until separate end-to-end approval and validation |

The listener is hard-scoped to the verified Momentum Movement guild and Dawn Dotta bot application. Do not replace those IDs with another community's credentials.

## Cutover and rollback

- Keep the existing unleased Railway listener online while preparing and testing both new hosts.
- Never run the old Railway listener concurrently with a new lease-aware owner.
- For production cutover, stop/disable the old Railway listener first. Start Botkeep primary and verify it owns the lease and has one healthy Gateway connection. Then start Silly Development standby and verify it remains disconnected. Verify exactly one lease holder, one Gateway connection, and successful LIVE/event workflows.
- For rollback, stop both new hosts before restarting the old Railway listener.
- If the Railway service cannot be stopped safely or the new hosts cannot be verified, do not cut over.
