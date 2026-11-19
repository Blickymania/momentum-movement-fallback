# Gift Assist Runtime Isolation

Gift Assist is an independent, inline Discord workflow. It must not use or depend on the Coaching API, Coaching frontend, or any Coaching database.

## Production topology

- **Discord bot service:** Momentum Movement Gift Assist
- **Private API service:** Momentum Movement Gift Assist API
- **Private API endpoint:** `http://gift-assist-api.railway.internal:8080`
- **Dedicated database service:** Momentum Movement Gift Assist Database
- **Private database endpoint:** `gift-assist-db.railway.internal:5432`
- **Database name:** `giftassist`
- **Persistent storage:** dedicated Railway volume mounted at `/var/lib/postgresql/data`

## Runtime invariants

1. The bot must require `GIFT_ASSIST_API_BASE_URL` to use the dedicated private API endpoint.
2. The API must refuse readiness unless its connected PostgreSQL database is named `giftassist`.
3. Gift Assist owns its own `gift_assist` schema, cases, settings, ledger, payment records, and notification outbox.
4. No public web dashboard, Discord Activity frontend, or Coaching API route is part of the Gift Assist runtime.
5. No OAuth or payment UI website is required for the inline Components V2 workflow.
6. Payment collection remains disabled until separately approved and fully configured.
7. Preserve the existing single Gateway owner: Blickymania Bot 005.
8. Keep the private Moderator Queue and public Gift Assist dashboard in their existing Discord channels.

Do not restore the legacy shared API/database configuration or add Coaching as a fallback. Any future changes must preserve this service and database boundary.
