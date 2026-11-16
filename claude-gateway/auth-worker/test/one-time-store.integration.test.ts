/// <reference types="@cloudflare/vitest-plugin/types" />
import { env as cloudflareEnv } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { OAuthOneTimeStore } from "../src/one-time-store";

type TestEnv = { OAUTH_ONE_TIME_STORE: DurableObjectNamespace<OAuthOneTimeStore> };
const env = cloudflareEnv as unknown as TestEnv;

function newStore() {
  return env.OAUTH_ONE_TIME_STORE.getByName(`oauth-one-time-test-${crypto.randomUUID()}`);
}

describe("SQLite OAuth one-time Durable Object", () => {
  it("atomically returns a record to only one competing RPC consumer", async () => {
    const store = newStore();
    await store.put("one-use-secret", 60);
    const results = await Promise.all([store.consume(), store.consume()]);
    expect(results.filter((value) => value !== null)).toEqual(["one-use-secret"]);
    expect(results.filter((value) => value === null)).toHaveLength(1);
    await expect(store.consume()).resolves.toBeNull();
  });

  it("rejects expired records through the real SQLite-backed Durable Object", async () => {
    const store = newStore();
    await store.put("short-lived", 1);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(store.consume()).resolves.toBeNull();
  });

  it("runs the scheduled cleanup alarm and removes an abandoned record", async () => {
    const store = newStore();
    await store.put("abandoned-record", 60);
    await expect(runDurableObjectAlarm(store)).resolves.toBe(true);
    await expect(store.consume()).resolves.toBeNull();
  });
});
