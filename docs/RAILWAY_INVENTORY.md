# Momentum Movement — Railway service inventory

**Project:** Dawn Dotta / Momentum Movement  
**Project ID:** `a1d6b0e4-3169-4c5d-add3-84a70f7dc525`  
**Environment:** production  
**Environment ID:** `c72ea3d9-2c1c-4651-a265-79723e317fa5`  
**Snapshot date:** 2026-11-13  
**Scope:** This inventory covers only the verified Dawn Dotta project.

| Service | Railway service ID | Schedule | Latest deployment |
|---|---|---:|---|
| Dawn Dotta Social Owner Console | `01588dd4-a338-4e73-a98c-e377e676efd7` | On demand | SUCCESS |
| Member Lifecycle Management | `d0c40f95-8c0b-4bc8-b78c-1d6fbde1358a` | Every 5 min | SUCCESS |
| Dawn Dotta Superseded Post Cleaner | `2a8f2838-e96b-44b9-bb1a-ffdcd028671b` | Minutes 7, 37 hourly | SUCCESS |
| LIVE NOW V2 - Shadow Engine | `7b194622-a8db-4a43-9bfd-4d17a7ba360e` | On demand | SUCCESS |
| Momentum Movement Discord Engagement Engine | `15d5ceb0-0a23-4481-a186-ad00d3fb7075` | On demand | SUCCESS |
| OAuth Database Diagnostic Function - Temp | `60e31b8d-92fb-4cbe-9ec9-90d62816d03c` | On demand | SUCCESS |
| Momentum Movement Logo Gateway | `0c8e2bf9-f1c7-47ba-bbd2-30585050cdc5` | On demand | SUCCESS |
| Dawn Dotta Official Social Directory Sync | `69f0ae3c-7315-498a-90bd-ce3a4e3a422a` | Minute 19 hourly | SUCCESS |
| Dawn Dotta Discord Manager | `596b402b-936b-490e-97c7-d41d9ed87caf` | On demand | SUCCESS |
| Coaching Activity Frontend | `791709e7-c650-45c1-8a35-f3ae9205bb72` | On demand | SUCCESS |
| Social Link Health Audit | `b7064b4e-7f45-4c5d-? ` | Daily 08:41 UTC | SUCCESS |
| Uniform 36 Command Extension | `b39aa59b-f6f7-4217-a28c-26393e0aab71` | On demand | SUCCESS |
| 1-on-1 Coaching Reminder Worker | `3e5af330-fa21-4fd9-a49e-657fa686e167` | Every 5 min | SUCCESS |
| Momentum Movement Role Monitor | `c5b00488-3740-4d5e-bed7-96ac4b3526ac` | Every 2 hours at :39 | SUCCESS |
| Blickymania Bot 005 | `328ad9bb-7db8-4f9a-9a72-f91b73ef9fc9` | On demand | SUCCESS |
| Dawn Dotta Gallery Safety Preflight | `fbcdcb36-fe6e-4015-a01d-57ffea97a471` | Every 6 hours at :17 | SUCCESS |
| Dawn Dotta News Forum 24h Retention Cleanup | `23249d7e-6ced-438d-aae2-a82947aa23bd` | On demand | CRASHED; 3 staged changes |
| Dawn Dotta TikTok LIVE Status Monitor | `8f8d52a2-6ea5-4285-b639-b5886cf5301d` | Every 5 min | SUCCESS |
| Dawn Dotta Gallery Discovery Engine | `9942bed7-01d4-4beb-80a6-d0909ec3684b` | Daily 03:32 UTC | SUCCESS |
| TikTok Campaign Intelligence & Publisher | `04bd487f-803f-4103-9710-324c2840b6f0` | Minutes 7, 37 hourly | SUCCESS |
| Postgres Daily Backup | `302748a7-73e7-4e64-9cdd-762c25aee2c3` | Daily 09:05 UTC | SUCCESS |
| Postgres | `d5518d22-50d0-455e-b2f0-6cc67caaa9fe` | Continuous | SUCCESS |
| Dawn Dotta Event Media Publisher | `1a38abca-7b17-4c16-89e3-426d33adb4a8` | Minute 42 hourly | SUCCESS |
| Momentum Movement Gift Assist | `b52e3e21-8cc5-45f9-8fe2-f943074f30ba` | On demand | SUCCESS |
| Dawn Dotta TikTok Fan Club Level-Up Management | `db604954-5b7c-4f66-adbc-37a4c3387e97` | On demand | SUCCESS |
| Dawn Dotta Community Stats Sync | `b8ca66e8-98fd-45c5-a1c7-4b3d3a2c2f4f` | Every 5 min | SUCCESS |
| Dawn Dotta Original Media Vault Backup | `8d84ed48-fef9-44c3-950d-6915c2b3a618` | Minutes 17, 47 hourly | SUCCESS |
| Dawn Dotta LIVE & Events Listener | `75ec092b-7f53-465d-b46a-9f01a2b155a2` | Continuous | SUCCESS |
| Momentum Movement Core Shadow | `f4839b88-e3c2-4094-af7d-3089bb8f291d` | On demand | SUCCESS |
| 1-on-1 Coaching Workflow | `018a08a9-d6ed-4de5-987d-b2eacb2633cb` | On demand | SUCCESS |
| Coaching Platform API | `9c5eec22-bcb7-4e64-9cdd-762c25aee2c3` | On demand | SUCCESS |
| OAuth PostgreSQL | `3e71f6b5-a248-40b6-b185-a748a5f5b436` | Continuous | SUCCESS |
| 1-on-1 Coaching Interaction Relay | `aa366b1c-60fc-4681-85a8-d22bf1e41d1e` | On demand | SUCCESS |
| Dawn Dotta Content & Dashboard Parity | `5ed5b1ce-afcd-4cd8-82f8-f763fc6e40a3` | Hourly at :22 | SUCCESS |

## Persistent data resources

| Resource | Name | Capacity / mount |
|---|---|---|
| PostgreSQL volume | `postgres-volume` | 5,000 MB; mounted to Postgres |
| OAuth PostgreSQL volume | `OAuth PostgreSQL Data` | 1,024 MB; mounted to OAuth PostgreSQL |
| Member lifecycle volume | `Member Lifecycle History` | 1,024 MB; mounted at `/data` |
| Engagement ledger volume | `momentum-discord-engagement-ledger` | 100 MB; mounted at `/data` |
| TikTok campaign ledger | `dawn-tiktok-campaign-ledger` | 100 MB; mounted at `/data` |
| Media bucket | `dawn-dotta-photo-originals` | Object count and byte size not yet measured |

## Migration notes

- Total: 34 services, 5 persistent volumes, 2 PostgreSQL services, and 1 object-storage bucket.
- All services were observed in the Dawn Dotta / Momentum Movement production project. The inventory does not include any other Discord community.
- The news forum retention cleanup service is the only service observed with a crashed latest deployment and staged changes. Do not overwrite or accept its staged patch as part of this migration.
- Service environment variable names and shared variable names were inventoried, but secret values were not read.
- This is a point-in-time inventory, not proof that every service's application source or database contents have been backed up.
- Before any cutover, separately export each database, enumerate media objects and checksums, capture service source, and verify all backups.
