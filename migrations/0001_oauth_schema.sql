-- Momentum Movement OAuth schema for Cloudflare D1 / SQLite.
-- Migration 0001. Apply with Wrangler D1 migrations before deploying the Worker.
-- Tokens and authorization codes are SHA-256 hashes, never plaintext.
-- All timestamps are UTC Unix milliseconds.

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_oauth_login_requests (
  state_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  client_state TEXT,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consume_nonce TEXT
);

CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consume_nonce TEXT
);

CREATE TABLE IF NOT EXISTS mcp_oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  replaced_by TEXT,
  consume_nonce TEXT
);

CREATE INDEX IF NOT EXISTS mcp_oauth_login_expiry_idx
  ON mcp_oauth_login_requests (expires_at);
CREATE INDEX IF NOT EXISTS mcp_oauth_code_expiry_idx
  ON mcp_oauth_authorization_codes (expires_at);
CREATE INDEX IF NOT EXISTS mcp_oauth_access_expiry_idx
  ON mcp_oauth_access_tokens (expires_at);
CREATE INDEX IF NOT EXISTS mcp_oauth_refresh_expiry_idx
  ON mcp_oauth_refresh_tokens (expires_at);
