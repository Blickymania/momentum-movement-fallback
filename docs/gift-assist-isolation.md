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

## Cash App recipient assignment

- Gift Assist uses the native private Discord **Gift Assist Queue** for all recipient management; there is no external command-center website or DM workflow.
- The global Payment Operations dropdown sets a default/planning recipient for the dashboard. It must **not** automatically reassign any case.
- Each eligible case has its own **Assign Cash App** button and dropdown. A case assignment is stored separately in `gift_assist.case_cashapp_assignments`, linked to the case and selected destination. Changes are audited with the acting staff user ID.
- **Moderator or higher** may select an existing registered Cash App recipient for a case; **Administrator or owner** alone may enter new recipients into the registry.
- Every Cashtag must be normalized to a leading `$` and validated as a Cashtag, including `$ShamekaDDowell`. Existing recipients and other payment methods must be preserved.
- Case-specific assignment is **planning only**, never proof of Cash App ownership, payment authorization, funds received, or a payout. It creates no payment link and no ledger entry.
- The API refuses case recipient changes for closed/fulfilled cases or cases with a non-`Not Started` payment status. The Discord handler checks the same rules plus guild, private channel, staff role and case message identity.
- Both the global dropdown and case picker paginate lists beyond Discord's 25-option select limit.
- The `manual_payments_enabled` gate remains false, the new Cashtag remains unverified until ownership is established, and actual collection requires separate authorization and payment-safety verification.
- **Regression tests:** role-based mod/admin/owner selection; unauthorized-role rejection; wrong-channel/wrong-message rejection; closed/paid-case rejection; dropdown pagination; inline success/failure feedback; global selection not affecting other cases.
