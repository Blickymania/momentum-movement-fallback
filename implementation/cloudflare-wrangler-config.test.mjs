import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Wrangler binds the Gateway lease and coaching idempotency to separate SQLite Durable Object classes", async () => {
  const raw = await readFile(new URL("../cloudflare/wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(raw);
  const bindings = new Map(config.durable_objects.bindings.map(binding => [binding.name, binding.class_name]));
  assert.equal(bindings.get("GATEWAY_LEASE_COORDINATOR"), "GatewayLeaseCoordinator");
  assert.equal(bindings.get("COACHING_IDEMPOTENCY_STORE"), "CoachingInteractionIdempotency");
  assert.equal(bindings.get("GATEWAY_LEASE_COORDINATOR") === bindings.get("COACHING_IDEMPOTENCY_STORE"), false);
});

test("Wrangler SQLite migrations have unique tags and provision both classes exactly once", async () => {
  const raw = await readFile(new URL("../cloudflare/wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(raw);
  const tags = config.migrations.map(migration => migration.tag);
  assert.equal(new Set(tags).size, tags.length);
  const created = config.migrations.flatMap(migration => migration.new_sqlite_classes || []);
  assert.deepEqual(created.sort(), ["CoachingInteractionIdempotency", "GatewayLeaseCoordinator"].sort());
  assert.equal(created.length, 2);
  assert.ok(config.migrations.some(m => m.tag === "v1" &&
    m.new_sqlite_classes?.includes("GatewayLeaseCoordinator")));
  assert.ok(config.migrations.some(m => m.tag === "v2" &&
    m.new_sqlite_classes?.includes("CoachingInteractionIdempotency")));
});

test("Durable Object classes are exported by the configured Worker entry point", async () => {
  const worker = await readFile(new URL("../cloudflare/worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /export \{ GatewayLeaseCoordinator, CoachingInteractionIdempotency \}/);
  assert.match(worker, /COACHING_IDEMPOTENCY_STORE/);
  assert.match(worker, /GATEWAY_LEASE_COORDINATOR/);
});
