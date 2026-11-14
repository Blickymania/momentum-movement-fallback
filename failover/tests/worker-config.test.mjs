import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../lease-control/worker.js", import.meta.url), "utf8");
const config = await readFile(new URL("../lease-control/wrangler.jsonc", import.meta.url), "utf8");

test("Durable Object initializes a SQLite lease table and exposes internal readiness", () => {
  assert.match(worker, /CREATE TABLE IF NOT EXISTS listener_lease/);
  assert.match(worker, /transactionSync\(\(\) =>/);
  assert.match(worker, /path === "\/health"/);
  assert.match(worker, /storage: "sqlite"/);
});

test("lease API rejects non-JSON and oversized request bodies", () => {
  assert.match(worker, /unsupported_media_type/);
  assert.match(worker, /declaredLength > 2048/);
  assert.match(worker, /byteLength > 2048/);
});

test("public health endpoint checks the Durable Object instead of returning a static success", () => {
  assert.match(worker, /LEASE_COORDINATOR\.idFromName\(SERVICE\)/);
  assert.match(worker, /coordinator_unhealthy/);
  assert.match(worker, /coordinator_unavailable/);
});

test("public lease mutations require the control token and use one fixed namespace", () => {
  assert.match(worker, /safeEqual\(supplied, `Bearer \$\{expected\}`\)/);
  assert.match(worker, /const SERVICE = "momentum-movement-live-events-listener"/);
  assert.match(config, /"name": "momentum-movement-lease-control"/);
  assert.match(config, /"new_sqlite_classes": \["MomentumMovementLease"\]/);
  assert.match(config, /"class_name": "MomentumMovementLease"/);
});
