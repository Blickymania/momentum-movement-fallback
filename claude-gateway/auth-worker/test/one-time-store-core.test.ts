import { describe, expect, it, vi } from "vitest";
import { AtomicOneTimeStoreCore } from "../src/one-time-store-core";

class MemorySql {
  record: { value: string; expires_at: number } | null = null;
  statements: string[] = [];

  exec<T extends Record<string, string | number | null>>(query: string, ...bindings: (string | number)[]) {
    this.statements.push(query);
    if (query.includes("INSERT INTO oauth_one_time_record")) {
      this.record = { value: String(bindings[0]), expires_at: Number(bindings[1]) };
    } else if (query.includes("DELETE FROM oauth_one_time_record WHERE id = 1 RETURNING")) {
      const record = this.record;
      this.record = null;
      return { toArray: () => (record ? [record] : []) as unknown as T[] };
    } else if (query.includes("DELETE FROM oauth_one_time_record WHERE id = 1")) {
      this.record = null;
    }
    return { toArray: () => [] as T[] };
  }
}

describe("atomic OAuth one-time store core", () => {
  it("allows exactly one of two competing consumes to receive a value", async () => {
    const sql = new MemorySql();
    const store = new AtomicOneTimeStoreCore(sql as unknown as SqlStorage);
    store.put("encrypted-consent", 300);

    const results = await Promise.all([
      Promise.resolve().then(() => store.consume()),
      Promise.resolve().then(() => store.consume())
    ]);
    expect(results.filter((value) => value !== null)).toEqual(["encrypted-consent"]);
    expect(results.filter((value) => value === null)).toHaveLength(1);
    expect(sql.statements.some((statement) =>
      statement.includes("DELETE FROM oauth_one_time_record") && statement.includes("RETURNING")
    )).toBe(true);
  });

  it("deletes expired records and never returns them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T18:00:00.000Z"));
    try {
      const sql = new MemorySql();
      const store = new AtomicOneTimeStoreCore(sql as unknown as SqlStorage);
      store.put("expired-state", 1);
      vi.advanceTimersByTime(1001);
      expect(store.consume()).toBeNull();
      expect(sql.record).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a stored record for the alarm cleanup path", () => {
    const sql = new MemorySql();
    const store = new AtomicOneTimeStoreCore(sql as unknown as SqlStorage);
    store.put("abandoned", 60);
    store.clear();
    expect(sql.record).toBeNull();
    expect(store.consume()).toBeNull();
  });

  it("rejects invalid TTLs and oversized payloads", () => {
    const store = new AtomicOneTimeStoreCore(new MemorySql() as unknown as SqlStorage);
    expect(() => store.put("value", 0)).toThrow(/TTL/);
    expect(() => store.put("value", 601)).toThrow(/TTL/);
    expect(() => store.put("x".repeat(32_769), 60)).toThrow(/too large/);
  });
});
