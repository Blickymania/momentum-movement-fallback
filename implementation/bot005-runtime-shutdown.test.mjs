import test from "node:test";
import assert from "node:assert/strict";
import { createBot005RuntimeShutdown } from "./bot005-runtime-shutdown.mjs";

test("runtime shutdown closes the Gateway owner and every HTTP listener once", async () => {
  const calls = [];
  let serverA = 0;
  let serverB = 0;
  const shutdown = createBot005RuntimeShutdown({
    gatewayOwner: {
      async shutdown(reason) {
        calls.push(["gateway", reason]);
        return { released: true };
      }
    },
    getServers: () => [
      { async stop(force) { serverA++; assert.equal(force, true); } },
      { async stop(force) { serverB++; assert.equal(force, true); } }
    ]
  });

  const results = await Promise.all([
    shutdown("sigterm"),
    shutdown("sigint")
  ]);

  assert.deepEqual(results, [{ released: true }, { released: true }]);
  assert.deepEqual(calls, [["gateway", "sigterm"]]);
  assert.equal(serverA, 1);
  assert.equal(serverB, 1);
});

test("HTTP listeners are still stopped when Gateway-owner shutdown fails", async () => {
  let stopped = 0;
  const shutdown = createBot005RuntimeShutdown({
    gatewayOwner: {
      async shutdown() { throw new Error("gateway_shutdown_failed"); }
    },
    getServers: () => [{ async stop(force) { assert.equal(force, true); stopped++; } }]
  });

  await assert.rejects(
    () => shutdown("identity_verification_failed"),
    error => error instanceof AggregateError &&
      error.message === "bot005_shutdown_incomplete" &&
      error.errors.some(item => item.message === "gateway_shutdown_failed")
  );
  assert.equal(stopped, 1);
});

test("shutdown rejects missing server handles instead of silently leaving listeners open", async () => {
  let ownerStopped = 0;
  const shutdown = createBot005RuntimeShutdown({
    gatewayOwner: { async shutdown() { ownerStopped++; return { released: true }; } },
    getServers: () => []
  });

  await assert.rejects(() => shutdown("sigterm"), /bot005_http_servers_unavailable/);
  assert.equal(ownerStopped, 1);
});

test("shutdown reports listener close failures after attempting every listener", async () => {
  const calls = [];
  const shutdown = createBot005RuntimeShutdown({
    gatewayOwner: { async shutdown() { return { released: true }; } },
    getServers: () => [
      { async stop() { calls.push("first"); throw new Error("first_stop_failed"); } },
      { async stop() { calls.push("second"); } }
    ]
  });

  await assert.rejects(
    () => shutdown("sigterm"),
    error => error instanceof AggregateError &&
      error.errors.some(item => item.message === "first_stop_failed")
  );
  assert.deepEqual(calls.sort(), ["first", "second"]);
});

test("invalid shutdown reasons are rejected before any shutdown operation", async () => {
  let calls = 0;
  const shutdown = createBot005RuntimeShutdown({
    gatewayOwner: { async shutdown() { calls++; return { released: true }; } },
    getServers: () => [{ async stop() {} }]
  });

  assert.throws(() => shutdown(""), /bot005_shutdown_reason_invalid/);
  assert.equal(calls, 0);
});
