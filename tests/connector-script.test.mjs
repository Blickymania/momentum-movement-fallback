import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptUrl = new URL("../infra/connector/railway-cloudflare-tunnel.sh", import.meta.url);

test("Railway/Cloudflare connector shell syntax is valid", () => {
  execFileSync("sh", ["-n", fileURLToPath(scriptUrl)]);
});

test("connector rejects cloudflared versions below the Workers VPC minimum", async () => {
  const script = await readFile(scriptUrl, "utf8");
  assert.match(script, /cloudflared version/);
  assert.match(script, /2025\.7\.0 or later/);
  assert.match(script, /parts\[1\] > 2025/);
  assert.match(script, /parts\[2\] >= 7/);
});

test("connector keeps Railway and Cloudflare credentials out of logs and argv", async () => {
  const script = await readFile(scriptUrl, "utf8");
  assert.match(script, /railway connect[\s\S]*?>\/dev\/null 2>&1 &/);
  assert.match(script, /printf '%s' "\$CLOUDFLARE_TUNNEL_TOKEN" > "\$TOKEN_FILE"/);
  assert.match(script, /unset RAILWAY_TOKEN[\s\S]*cloudflared tunnel/);
  assert.match(script, /--token-file "\$TOKEN_FILE"/);
  assert.doesNotMatch(script, /cloudflared tunnel[^\n]*--token "\$CLOUDFLARE_TUNNEL_TOKEN"/);
});

test("connector never creates a public Railway TCP proxy", async () => {
  const script = await readFile(scriptUrl, "utf8");
  assert.match(script, /railway connect[\s\S]*--tunnel-only/);
  assert.doesNotMatch(script, /railway tcp-proxy create|create_tcp_proxy/i);
});
