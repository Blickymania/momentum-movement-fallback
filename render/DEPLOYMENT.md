# Dawn Dotta Manager — Render cold fallback

This directory packages the recovered, unmodified Bun HTTP/MCP Manager for an independent Render Web Service. It is Dawn Dotta only.

## Build configuration

- Runtime: Docker
- Root build context: repository root
- Dockerfile path: render/Dockerfile
- Plan: Free
- Region: Ohio or Virginia
- Interim health check path: /healthz (process liveness only). Switch to /readyz only after Discord credentials and the intended OAuth database are configured and /readyz returns 200.
- Auto deploy: disabled until the migration branch is reviewed
- No database is embedded in the image. Confirm the intended Dawn-only PostgreSQL endpoint before configuring OAUTH_DATABASE_URL. The checked-in Cloudflare failover Worker in this repository only probes manager origins and contains no database binding or database URL; it does not identify an OAuth database. A separate Cloudflare Worker database source was not discoverable in the connected GitHub repositories. Do not use Railway's private-only `oauth-postgresql` hostname from Render; Render cannot join Railway's private network. Do not assume the Neon `staging` branch is production OAuth storage: it was empty at the last read-only count and must not be used until the intended data source is confirmed.

## Required environment values

Set these directly in Render's secret/environment manager. Do not place secret values in this repository or chat.

- DISCORD_BOT_TOKEN
- AUTHORIZED_GUILD_ID
- APPLICATION_ID
- WRITES_ENABLED (false until a verified controlled write test)
- MANAGER_SERVICE_KEY (preferred provider-neutral name; RAILWAY_SERVICE_KEY remains a legacy fallback)
- MCP_OAUTH_ENABLED
- OAUTH_DATABASE_URL (same Dawn-only database as the Worker)
- DISCORD_OAUTH_CLIENT_ID
- DISCORD_OAUTH_CLIENT_SECRET
- DISCORD_OAUTH_REDIRECT_URI
- OAUTH_ISSUER_URL
- OAUTH_RESOURCE_URL

The source uses Bun's native SQL client and can run unchanged in the Bun image. This avoids routing a Bun-specific database runtime through Node.

## Free-tier operating limits

Render Free Web Services have 750 instance-hours per workspace per month. Free instances spin down after 15 minutes without inbound traffic, and Render documents that Free services are intended for exploration/testing rather than production. A free instance may take around a minute to wake. There is no persistent disk on Free Web Services. Do not use Render's Free Postgres for the Manager's durable OAuth database; Render says free Postgres databases expire after 30 days.

Render's docs state that without a payment method, exceeding included bandwidth suspends services for the rest of the month, and exceeding included build-pipeline minutes pauses new builds. That avoids automatic overage billing but means the fallback may become unavailable when a free allowance is exhausted.

For these reasons, this is an emergency cold fallback, not an always-on production primary. No keep-alive cron or scheduled ping is configured.

## Cutover safety

- Do not change the existing Railway production service.
- Do not enable writes until identity, database, OAuth, and read tests pass.
- The interim `/healthz` check validates only that the HTTP process is responding. Once all required Discord credentials and the intended OAuth DB are set, verify `/readyz` returns 200 and then change Render's health check path to `/readyz`.
- The gateway/router must send an actual request to exactly one origin; never replay a timed-out POST.
- If Render is asleep, allow cold-start time before considering it ready. No scheduled keep-alive pings or cron jobs are configured.
- Keep the Cloudflare and Railway endpoints available for manual rollback. Keep Render out of production routing until it passes `/readyz`, OAuth, database, and manager read-only tests.
