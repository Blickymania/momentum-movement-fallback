# Dawn Dotta Cloudflare Worker migration checkpoint

**Scope:** Dawn Dotta / Momentum Movement only. Do not point this Worker at another guild or import other community credentials/data.

## Implementation created on isolated branch

- Branch: `infra/dawn-dotta-cloudflare-worker`
- Entry point: `src/index.ts`
- Runtime: Cloudflare Workers with `nodejs_compat`
- Database driver: `pg` (node-postgres)
- Database connection: Cloudflare Hyperdrive binding `HYPERDRIVE`
- Preserved MCP functions: `discord_manager_status`, `discord_guild_request`, `discord_manager_audit`
- Preserved the existing guild and bot-identity checks, write gate, route validation, silent message policy, and MCP authentication.
- PostgreSQL compatibility layer supports parameterized queries and BEGIN/COMMIT/ROLLBACK transactions.
- Request environment and connection are isolated with AsyncLocalStorage.
- The /readyz endpoint checks Discord identity and, when OAuth is enabled, validates PostgreSQL availability.
- Liveness endpoint returns the service name `cloudflare-workers`.

## Important design boundary

The production Railway service remains online and unchanged. The Worker is only a migration candidate. No deployment has been created, no origin URL changed, and no OAuth client redirect has been changed.

The production OAuth database has not been identified as a Dawn Dotta-owned database. Two unrelated Supabase projects were checked by their project/function scope and excluded. The new Worker must not use them.

## Free-tier selection

Cloudflare Workers Free is the strongest confirmed primary candidate:
- Cloudflare advertises Workers as free with no credit card required.
- 100,000 Worker requests/day, 10 ms CPU per invocation, and 128 MB memory.
- Hyperdrive is included on Free with up to 100,000 SQL statements/day.
- Limits reset each day; exceeding a limit results in errors, not automatic paid conversion.

Neon Free is a possible Dawn-specific Postgres provider. Its Free plan is published with monthly compute and storage allowances; historical Neon documentation says no credit card is required for signup. Verify current limits and the exact signup flow before depending on it.

Render is not selected as production primary: its own documentation says free instances are not for production, free Postgres expires after 30 days, and unused web services spin down. It can be considered as a separately selected cold fallback only if its terms satisfy the user's no-card rule.

## Required user-side setup

1. Confirm access to a Cloudflare account on the Free plan; do not add a card.
2. Create a separate Neon Free PostgreSQL project dedicated to Dawn Dotta. Do not use an existing unrelated Supabase project.
3. Determine the existing production `OAUTH_DATABASE_URL` ownership and export rights through the authorized current host. The secret itself must never be put into GitHub or ChatGPT.
4. Securely migrate only the five OAuth tables (clients, login requests, authorization codes, access tokens, refresh tokens), with row counts and schema/index checks performed privately.
5. Create Hyperdrive for the Dawn database and add the generated binding ID to `wrangler.jsonc`.
6. Set the Worker secrets in Cloudflare: `DISCORD_BOT_TOKEN`, `RAILWAY_SERVICE_KEY` (compatibility name), `DISCORD_OAUTH_CLIENT_SECRET`, plus the required public IDs/URLs and write flag.
7. Run `npm run check`, then live integration tests for OAuth PKCE, refresh rotation, revocation, MCP initialization/tools/list, bot/guild identity, read operations, and an explicitly authorized controlled write.
8. Only after all checks pass, make a reversible edge-routing cutover. Keep Railway unchanged as rollback until at least one full validation window passes.

Do not send credentials in chat. Use only each provider's secret manager.

## Scheduler policy

No scheduled jobs, cron triggers, pings, or recurring maintenance jobs have been added. Recovery should use request-time readiness and routing. Any future centralized monitoring must be separately reviewed and must not duplicate existing scheduled services.

## Build and test

`npm run check` runs typecheck, static regression tests, and a Wrangler dry-run. The workflow on this branch runs the same steps only on push/pull request; it is not a scheduled task.
