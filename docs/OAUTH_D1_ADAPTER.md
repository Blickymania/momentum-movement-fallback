# Momentum Movement OAuth adapter — design and verification

**Scope:** Dawn Dotta / Momentum Movement only.  
**Status:** D1 persistence adapter, OAuth route handlers, and Worker wiring are implemented and covered by local SQLite/HTTP tests with mocked Discord responses. Cloudflare D1 runtime, the complete flow through the Worker endpoint, and production-data migration remain unverified.

## Existing OAuth behavior to preserve

The recovered Railway manager source uses PostgreSQL-backed OAuth with:

- Dynamic client registration and exact redirect URI allowlisting.
- Authorization state stored as a hash and single use.
- PKCE S256 challenge / verifier binding.
- Discord OAuth identify + guild membership lookup.
- Only the owner or an administrator of the authorized Momentum Movement guild is eligible.
- Authorization codes are single use and short lived (5 minutes).
- Access tokens are short lived (1 hour) and refresh tokens are 30 days.
- Refresh rotation revokes the old refresh token and records the replacement.
- Access-token authentication checks expiry, revocation, requested resource URI and authorized guild.
- MCP read/write scopes gate manager writes.
- Tokens, state, auth codes, and signing material must not be stored in plaintext or committed.

## D1 storage adapter

Implementation: `src/oauth-d1-store.mjs`  
Versioned schema: `migrations/0001_oauth_schema.sql`  
Tests: `test/oauth-d1-store.test.mjs`

The five tables preserve the logical OAuth records: clients, login requests, authorization codes, access tokens, refresh tokens. Time columns are stored as UTC Unix milliseconds. State/code/token fields are hashes only.

### Atomic state/code consumption

The original manager uses PostgreSQL transactions and row locks. D1 does not support the same `SELECT ... FOR UPDATE` pattern. The adapter instead uses a D1 batch containing:

1. A conditional `UPDATE ... WHERE consumed_at IS NULL ... RETURNING` with a one-time per-operation nonce.
2. An `INSERT ... SELECT` that creates the authorization code only from the row claimed by that exact nonce.

Both statements are in one D1 batch. If the state was already used, expired, or a second request wins, the conditional update returns no row and the insertion does not happen. If any statement errors, D1 rolls the batch back.

### Authorization-code exchange and refresh rotation

The same conditional-claim + nonce-matched insert pattern is used for code redemption and refresh rotation. Each batch inserts both access and refresh token records atomically. A failed or losing concurrent redemption cannot produce only one half of the token pair.

### Revocation and authentication

- The adapter stores only hashes; plaintext bearer tokens remain in the request/response boundary and are never written to D1.
- Authentication checks not-revoked, unexpired token, exact resource URI and authorized guild.
- Revoke updates both token tables and is safe for unknown hashes.
- Scope enforcement remains in the MCP HTTP layer, not merely in the store.

## Verification

Local Node SQLite adapter harness uses Node's built-in SQLite API to exercise the same SQL and transactional behavior without Cloudflare credentials.

**Latest candidate CI:** 218 tests passed, 0 failed. Adapter/schema checks use Node SQLite; Discord OAuth endpoints are mocked.

Tests cover:

- Five-table schema and expiry indexes.
- Client registration and deduplicated redirect URI list.
- Login state consumption and code creation.
- Duplicate state rejection.
- Authorization-code single-use semantics.
- Client, redirect, PKCE and resource binding.
- Concurrent code redemption; exactly one successful result.
- Access-token expiry, revocation, resource and guild checks.
- Refresh-token rotation and previous-token rejection.
- Refresh client/resource binding.
- Unknown-token revocation.

This is local SQLite verification only. It does not prove Cloudflare D1 deployment behavior, network behavior, account quotas, or end-to-end Discord OAuth. The D1 database binding has not been created.

## Remaining integration work

- Add a Worker HTTP integration test that exercises the complete OAuth code flow through `createMomentumManagerWorker`; current route tests call the OAuth router directly, while Worker tests cover its authentication and scope boundary.
- Verify Cloudflare's D1 runtime and no-card account eligibility before provisioning a database; no D1 binding or database exists yet.
- Apply the versioned Wrangler migration to an isolated D1 database and verify schema health, transactions, row counts, checksums, and backup/restore behavior before any data migration.
- Recover the OAuth backup archive and checksum, establish verified source/target coverage, and rehearse restore; no production OAuth data has been copied.
- Preserve the existing Railway OAuth database and service as rollback until the replacement passes functional tests and soak.
- Do not migrate ChatGPT/plugin MCP endpoint URLs or credentials without verifying the external connector configuration and its owner-authorized update path.

## Billing and scheduler rules

- No D1, Workers or other resource is provisioned yet; no billing method has been added.
- Free quotas must pause work at the published limit and allow it to resume on the quota reset; do not upgrade or bill.
- No scheduler or recurring automation is added by this adapter.
