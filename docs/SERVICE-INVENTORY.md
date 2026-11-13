# Dawn Dotta — production backend inventory

**Snapshot:** 2026-11-13  
**Railway project:** Dawn Dotta / Momentum Movement  
**Project ID:** `a1d6b0e4-3169-4c5d-add3-84a70f7dc525`  
**Production environment ID:** `c72ea3d9-2c1c-4651-a265-79723e317fa5`  
**Guild ID:** `1565048205970767992`  
**Bot/application ID:** `1565304619838742598`

The live Railway environment contained 34 services, 5 persistent volumes, and 1 object-storage bucket. Most service code is embedded in Railway's Bun start command rather than deployed from a GitHub-linked source. Export and verify each runtime before decommissioning the source platform.

## Verified service list

| # | Railway service | Service ID | Runtime role | Current notes |
|---:|---|---|---|---|
| 1 | OAuth Database Diagnostic Function - Temp | `60e31b8d-92fb-4cbe-9ec9-90d62816d03c` | Temporary OAuth DB diagnostic | Retain only until OAuth DB migration and parity are proven |
| 2 | OAuth PostgreSQL | `3e71f6b5-a248-40b6-b185-a748a5f5b436` | OAuth persistence | Persistent volume; must export/verify schema and rows |
| 3 | Postgres Daily Backup | `302748a7-73e7-4e64-9cdd-762c25aee2c3` | Database backup job | Confirm backup artifacts are readable and restorable |
| 4 | Coaching Activity Frontend | `791709e7-c650-45c1-8a35-f3ae9205bb72` | Coaching UI | Merge routes/UI into unified web/API layer or retain static assets |
| 5 | Coaching Platform API | `9c5eec22-f7c6-45dc-8404-425fb749afff` | Coaching API | Bun HTTP API; PostgreSQL-backed |
| 6 | Postgres | `d5518d22-50d0-455e-b2f0-6cc67caaa9fe` | Main application database | 5 GB persistent volume; requires dump and validation |
| 7 | 1-on-1 Coaching Reminder Worker | `3e5af330-fa21-4fd9-a49e-657fa686e167` | Coaching reminders | 5-minute schedule |
| 8 | 1-on-1 Coaching Interaction Relay | `aa366b1c-60fc-468e-b694-dceaf7d90580` | Discord interaction relay | Persistent Discord Gateway websocket; forwards to coaching workflow |
| 9 | 1-on-1 Coaching Workflow | `018a08a9-d6ed-4de5-987d-b2eacb2633cb` | Coaching forms/state transitions | Bun HTTP API; Discord REST integration |
| 10 | Dawn Dotta Gallery Safety Preflight | `fbcdcb36-fe6e-4015-a01d-57ffea97a471` | Gallery safety checks | 6-hour schedule |
| 11 | Momentum Movement Gift Assist | `b52e3e21-8cc5-45f9-8fe2-f943074f30ba` | Gift Assist bot + HTTP/payment endpoints | Discord.js Gateway plus HTTP routes; payment integration must be audited separately |
| 12 | Dawn Dotta News Forum 24h Retention Cleanup | `23249d7e-6ced-438d-aae2-a82947aa23bd` | News retention cleanup | Latest deployment was CRASHED at inspection; preserve workflow/listener intent even if forum channel has been removed |
| 13 | TikTok Campaign Intelligence & Publisher | `04bd487f-803f-4103-9710-324c2840b6f0` | TikTok campaign scheduling/publishing | Persistent campaign ledger volume; 30-minute schedule |
| 14 | Momentum Movement Discord Engagement Engine | `15d5ceb0-0a23-4481-a186-ad00d3fb7075` | Engagement/XP ledger | Persistent Discord Gateway client and mounted volume |
| 15 | Member Lifecycle Management | `d0c40f95-8c0b-4bc8-b78c-1d6fbde1358a` | Member lifecycle/history | 5-minute schedule and mounted volume |
| 16 | LIVE NOW V2 - Shadow Engine | `7b194622-a8db-4a43-9bfd-4d17a7ba360e` | LIVE NOW shadow/verification | Keep shadow mode until new runtime parity tests pass |
| 17 | Dawn Dotta Original Media Vault Backup | `8d84ed48-fef9-44c3-950d-6915c2b3a618` | Original media backup | 30-minute schedule; verify full object coverage and checksums |
| 18 | Dawn Dotta Event Media Publisher | `1a38abca-7b17-4c16-89e3-426d33adb4a8` | Event/media publisher | Hourly schedule |
| 19 | Dawn Dotta TikTok Fan Club Level-Up Management | `db604954-5b7c-4f66-adbc-37a4c3387e97` | Fan Club level-up workflow | Interaction/workflow API |
| 20 | Dawn Dotta Discord Manager | `596b402b-936b-490e-97c7-d41d9ed87caf` | Discord Manager HTTP API | Public API domain; OAuth PostgreSQL dependencies and manager bridge |
| 21 | Dawn Dotta TikTok LIVE Status Monitor | `8f8d52a2-6ea5-4285-b639-b5886cf5301d` | TikTok LIVE detector | 5-minute schedule; uses TikTok LIVE connector |
| 22 | Momentum Movement Logo Gateway | `0c8e2bf9-f1c7-47ba-bbd2-30585050cdc5` | Logo/media gateway | HTTP endpoint |
| 23 | Blickymania Bot 005 | `328ad9bb-7db8-4f9a-9a72-f91b73ef9fc9` | Main Discord bot | Persistent Discord.js Gateway process; largest command/feature surface |
| 24 | Dawn Dotta Superseded Post Cleaner | `2a8f2838-e96b-44b9-bb1a-ffdcd028671b` | Superseded dashboard cleanup | Runs twice hourly |
| 25 | Dawn Dotta Social Owner Console | `01588dd4-a338-4e73-a98c-e377e676efd7` | Owner console/dashboard | HTTP/API routes |
| 26 | Dawn Dotta Official Social Directory Sync | `69f0ae3c-7315-498a-90bd-ce3a4e3a422a` | Social directory sync | Hourly schedule |
| 27 | Momentum Movement Role Monitor | `c5b00488-3740-4d5e-bed7-96ac4b3526ac` | Role/access monitoring | Every 2 hours |
| 28 | Dawn Dotta Content & Dashboard Parity | `5ed5b1ce-bcb2-4371-bf14-fe8c34431314` | Dashboard content/parity validation | Hourly schedule |
| 29 | Dawn Dotta Community Stats Sync | `b8ca66e8-98fd-45e8-9927-52304b06a659` | Community stats and greeting updater | 5-minute schedule |
| 30 | Social Link Health Audit | `b7064b4e-7fef-45d3-befa-bf0f0284212a` | Social link checks | Daily schedule |
| 31 | Momentum Movement Core Shadow | `f4839b88-e3c2-4094-af7d-3089bb8f291d` | Core shadow checks | Keep shadow-only until verified |
| 32 | Dawn Dotta Gallery Discovery Engine | `9942bed7-01d4-4beb-80a6-d0909ec3684b` | Gallery discovery | Daily schedule |
| 33 | Dawn Dotta LIVE & Events Listener | `75ec092b-7f53-465d-b46a-9f01a2b155a2` | Persistent LIVE/event listener | Separate Discord.js Gateway client plus health/preflight HTTP endpoint |
| 34 | Uniform 36 Command Extension | `b39aa59b-f6f7-4217-a28c-26393e0aab71` | Slash-command extension | Verify registration and handler ownership against all 36 live commands |

## Persistent storage that must be exported

| Storage object | ID | Mount / size | Required action |
|---|---|---|---|
| OAuth PostgreSQL Data | `4a306e20-7b9d-4e3a-9875-92f498ce6784` | OAuth PostgreSQL / 1 GB | PostgreSQL dump + restore validation |
| Member Lifecycle History | `e30e2db4-6fe9-42b2-834e-7bf1e52f63e6` | `/data` / 1 GB | Copy files, validate hashes and schema |
| dawn-tiktok-campaign-ledger | `f6f7d7c1-9432-4105-ab05-05fdb3fb180f` | `/data` / 100 MB | Copy files, validate hashes and schema |
| momentum-discord-engagement-ledger | `96a2d785-7d3f-4d0e-ab4a-d5665fbf029b` | `/data` / 100 MB | Copy files, validate hashes and schema |
| postgres-volume | `a6d37bed-5612-4c38-8fad-a63b501e6bd0` | PostgreSQL / 5 GB | PostgreSQL dump + restore validation |

The environment also has object storage bucket `dawn-dotta-photo-originals` (`7b9ab39d-be66-481a-a1b0-78647f1bbfdb`, region `sjc`). Verify all objects and metadata before considering a move to R2.

## Secrets — names only, never commit values

Observed variable names include Discord bot credentials, application and guild IDs, OAuth client/signing keys, PostgreSQL connection variables, TikTok connector credentials, Cloudflare credentials, media discovery API keys, social profile URLs, and workflow-specific flags. Do not place values in GitHub, issue descriptions, logs, or ChatGPT. Re-enter secrets directly in the destination host's encrypted secret UI.

## Verification observations

- Discord Manager reports connected, exact bot/guild identity match, and Discord HTTP identity/guild status 200.
- Read-only guild audit passed: 108 channels, 12 roles, 13 forums, 36 commands, 13 categories; no reported warnings.
- Production environment had no staged Railway patch at the time of inspection.
- Latest deployment of News Forum 24h Retention Cleanup was CRASHED; investigate its logs/source before migration.
- Railway source code is mostly embedded in each service's Bun start command, not a linked GitHub branch. Each embedded start command and its environment variable *names* need a source snapshot before cutover.
