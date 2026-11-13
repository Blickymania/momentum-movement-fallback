# Momentum Movement — Railway service inventory

**Project:** Dawn Dotta / Momentum Movement  
**Project ID:** `a1d6b0e4-3169-4c5d-add3-84a70f7dc525`  
**Environment:** production  
**Environment ID:** `c72ea3d9-2c1c-4651-a265-79723e317fa5`  
**Snapshot date:** 2026-11-13  
**Scope:** This inventory covers only the verified Dawn Dotta project.

## Services

| Service | Railway service ID | Schedule | State / latest deployment |
|---|---|---|---|
| Dawn Dotta Gallery Safety Preflight | `fbcdcb36-fe6e-4015-a01d-57ffea97a471` | 17 */6 * * * | live; SUCCESS |
| Momentum Movement Role Monitor | `c5b00488-3740-4d5e-bed7-96ac4b3526ac` | 39 */2 * * * | live; SUCCESS |
| Dawn Dotta Social Owner Console | `01588dd4-a338-4e73-a98c-e377e676efd7` | On demand / continuous | live; SUCCESS |
| LIVE NOW V2 - Shadow Engine | `7b194622-a8db-4a43-9bfd-4d17a7ba360e` | On demand / continuous | live; SUCCESS |
| Uniform 36 Command Extension | `b39aa59b-f6f7-4217-a28c-26393e0aab71` | On demand / continuous | live; SUCCESS |
| Dawn Dotta Superseded Post Cleaner | `2a8f2838-e96b-44b9-bb1a-ffdcd028671b` | 7,37 * * * * | live; SUCCESS |
| Dawn Dotta Discord Manager | `596b402b-936b-490e-97c7-d41d9ed87caf` | On demand / continuous | live; SUCCESS |
| Dawn Dotta TikTok LIVE Status Monitor | `8f8d52a2-6ea5-4285-b639-b5886cf5301d` | */5 * * * * | live; SUCCESS |
| OAuth Database Diagnostic Function - Temp | `60e31b8d-92fb-4cbe-9ec9-90d62816d03c` | On demand / continuous | live; SUCCESS |
| Social Link Health Audit | `b7064b4e-7fef-45d3-befa-bf0f0284212a` | 41 8 * * * | live; SUCCESS |
| Dawn Dotta News Forum 24h Retention Cleanup | `23249d7e-6ced-438d-aae2-a82947aa23bd` | On demand / continuous | live-with-staged-changes; CRASHED |
| 1-on-1 Coaching Reminder Worker | `3e5af330-fa21-4fd9-a49e-657fa686e167` | */5 * * * * | live; SUCCESS |
| Momentum Movement Logo Gateway | `0c8e2bf9-f1c7-47ba-bbd2-30585050cdc5` | On demand / continuous | live; SUCCESS |
| Dawn Dotta Official Social Directory Sync | `69f0ae3c-7315-498a-90bd-ce3a4e3a422a` | 19 * * * * | live; SUCCESS |
| Member Lifecycle Management | `d0c40f95-8c0b-4bc8-b78c-1d6fbde1358a` | */5 * * * * | live; SUCCESS |
| Dawn Dotta Gallery Discovery Engine | `9942bed7-01d4-4beb-80a6-d0909ec3684b` | 32 3 * * * | live; SUCCESS |
| Blickymania Bot 005 | `328ad9bb-7db8-4f9a-9a72-f91b73ef9fc9` | On demand / continuous | live; SUCCESS |
| TikTok Campaign Intelligence & Publisher | `04bd487f-803f-4103-9710-324c2840b6f0` | 7,37 * * * * | live; SUCCESS |
| Coaching Activity Frontend | `791709e7-c650-45c1-8a35-f3ae9205bb72` | On demand / continuous | live; SUCCESS |
| Momentum Movement Discord Engagement Engine | `15d5ceb0-0a23-4481-a186-ad00d3fb7075` | On demand / continuous | live; SUCCESS |
| Momentum Movement Core Shadow | `f4839b88-e3c2-4094-af7d-3089bb8f291d` | On demand / continuous | live; SUCCESS |
| Postgres Daily Backup | `302748a7-73e7-4e64-9cdd-762c25aee2c3` | 5 9 * * * | live; SUCCESS |
| Dawn Dotta TikTok Fan Club Level-Up Management | `db604954-5b7c-4f66-adbc-37a4c3387e97` | On demand / continuous | live; SUCCESS |
| Dawn Dotta Community Stats Sync | `b8ca66e8-98fd-45e8-9927-52304b06a659` | */5 * * * * | live; SUCCESS |
| Dawn Dotta LIVE & Events Listener | `75ec092b-7f53-465d-b46a-9f01a2b155a2` | On demand / continuous | live; SUCCESS |
| Dawn Dotta Original Media Vault Backup | `8d84ed48-fef9-44c3-950d-6915c2b3a618` | 17,47 * * * * | live; SUCCESS |
| OAuth PostgreSQL | `3e71f6b5-a248-40b6-b185-a748a5f5b436` | On demand / continuous | live; SUCCESS |
| Dawn Dotta Event Media Publisher | `1a38abca-7b17-4c16-89e3-426d33adb4a8` | 42 * * * * | live; SUCCESS |
| Dawn Dotta Content & Dashboard Parity | `5ed5b1ce-bcb2-4371-bf14-fe8c34431314` | 22 * * * * | live; SUCCESS |
| Postgres | `d5518d22-50d0-455e-b2f0-6cc67caaa9fe` | On demand / continuous | live; SUCCESS |
| Coaching Platform API | `9c5eec22-f7c6-45dc-8404-425fb749afff` | On demand / continuous | live; SUCCESS |
| 1-on-1 Coaching Workflow | `018a08a9-d6ed-4de5-987d-b2eacb2633cb` | On demand / continuous | live; SUCCESS |
| Momentum Movement Gift Assist | `b52e3e21-8cc5-45f9-8fe2-f943074f30ba` | On demand / continuous | live; SUCCESS |
| 1-on-1 Coaching Interaction Relay | `aa366b1c-60fc-468e-b694-dceaf7d90580` | On demand / continuous | live; SUCCESS |

## Persistent volumes

| Volume | Capacity | Mounted on |
|---|---:|---|
| OAuth PostgreSQL Data | 1024 MB | OAuth PostgreSQL |
| Member Lifecycle History | 1024 MB | Member Lifecycle Management |
| dawn-tiktok-campaign-ledger | 100 MB | TikTok Campaign Intelligence & Publisher |
| momentum-discord-engagement-ledger | 100 MB | Momentum Movement Discord Engagement Engine |
| postgres-volume | 5000 MB | Postgres |

## Object storage

- dawn-dotta-photo-originals (live)

## Summary and migration notes

- Total services: 34.
- Persistent volumes: 5.
- Object storage buckets: 1.
- The project contains two PostgreSQL services: `Postgres` and `OAuth PostgreSQL`.
- The service `Dawn Dotta News Forum 24h Retention Cleanup` is observed as `live-with-staged-changes` with a crashed latest deployment. It has three staged changes. Do not overwrite, accept, or discard its staged patch as part of this migration.
- Shared environment variable names include `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; their values were not read and their account ownership/validity have not been verified.
- Service environment variable names were inventoried without reading secret values.
- This is a point-in-time inventory, not proof that every service's application source or database contents have been backed up.
- Before cutover, separately export each database, enumerate media objects and checksums, capture service source, and verify all backups.
- No Railway resource or Discord resource was modified during this inventory.
