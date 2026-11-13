# Recovered Railway source snapshots

All entries below are from the verified **Dawn Dotta / Momentum Movement** Railway production project only. These files are recovery snapshots, not Cloudflare-ready replacements.

| Service | Service ID | Deployment observed | Runtime | Source file |
|---|---|---|---|---|
| Dawn Dotta Discord Manager | `596b402b-936b-490e-97c7-d41d9ed87caf` | `f878c9c8-4513-4d44-9a80-d546096d074f` | Bun 1.4.4 | `dawn-dotta-discord-manager.ts` |
| Dawn Dotta LIVE & Events Listener | `75ec092b-7f53-465d-b46a-9f01a2b155a2` | `d7601fae-1cae-4da1-a7d7-688e8fb8340e` | Bun 1.4.4 | `../../index.tsx` |

## Recovery boundaries

- The manager source was recovered from the deployed Railway Function source.
- The LIVE & Events listener source was recovered from its deployed Railway Function and preserved in the repository root.
- The manager source references environment variables for Discord, OAuth, PostgreSQL, and Railway runtime configuration. Only variable names are present in source; secret values were not copied.
- No database contents, media objects, environment-variable values, or live runtime state are included in these source snapshots.
- The LIVE & Events listener source uses Bun APIs and discord.js 14.27.0. It must be ported and tested before deployment on Cloudflare.
- The manager source uses Bun's SQL client and PostgreSQL-specific SQL. Its OAuth persistence layer needs a deliberate database adapter migration.
