import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const render = await readFile(new URL("../render/manager.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const expectedProductionDdl = [
  "CREATE TABLE IF NOT EXISTS mcp_oauth_clients (client_id text PRIMARY KEY, client_name text NOT NULL, redirect_uris text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
  "CREATE TABLE IF NOT EXISTS mcp_oauth_login_requests (state_hash text PRIMARY KEY, client_id text NOT NULL, redirect_uri text NOT NULL, client_state text, code_challenge text NOT NULL, scope text NOT NULL, resource text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, consumed_at timestamptz)",
  "CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_codes (code_hash text PRIMARY KEY, client_id text NOT NULL, redirect_uri text NOT NULL, code_challenge text NOT NULL, user_id text NOT NULL, guild_id text NOT NULL, scope text NOT NULL, resource text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, consumed_at timestamptz)",
  "CREATE TABLE IF NOT EXISTS mcp_oauth_access_tokens (token_hash text PRIMARY KEY, client_id text NOT NULL, user_id text NOT NULL, guild_id text NOT NULL, scope text NOT NULL, resource text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz)",
  "CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (token_hash text PRIMARY KEY, client_id text NOT NULL, user_id text NOT NULL, guild_id text NOT NULL, scope text NOT NULL, resource text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz, replaced_by text)"
];

const normalize = value => value.replace(/\\s+/g, " ").trim();
const createTables = source => [...source.matchAll(/["'](CREATE TABLE IF NOT EXISTS [^"']+)["']/g)]
  .map(match => normalize(match[1]))
  .sort();

test("Northflank/Render Manager preserves the audited production OAuth table definitions", () => {
  assert.deepEqual(createTables(render), [...expectedProductionDdl].sort());
});

test("Cloudflare Worker Manager preserves the audited production OAuth table definitions", () => {
  assert.deepEqual(createTables(worker), [...expectedProductionDdl].sort());
});

test("all candidate Managers preserve OAuth transaction and refresh-token rotation safeguards", () => {
  for (const [name, source] of [["Render/Northflank", render], ["Cloudflare Worker", worker]]) {
    assert.equal((source.match(/FOR UPDATE/g) || []).length, 3, name + " must retain row locks for single-use code and refresh-token flows");
    assert.equal((source.match(/\\.begin\\(async tx/g) || []).length, 4, name + " must retain the four transactional OAuth operations");
    assert.match(source, /replaced_by=\\$1 WHERE token_hash=\\$2/, name + " must retain refresh-token rotation linkage");
    assert.equal((source.match(/revoked_at=now\\(\\)/g) || []).length, 3, name + " must retain token/client revocation paths");
  }
});
