const MAX_VALUE_BYTES = 32_768;
const MAX_TTL_SECONDS = 600;

/**
 * SQLite-backed, single-record storage core. consume() is one DELETE ...
 * RETURNING statement, so only one concurrent caller can receive the value.
 */
export class AtomicOneTimeStoreCore {
  constructor(private readonly sql: SqlStorage) {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS oauth_one_time_record (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  put(value: string, ttlSeconds: number): number {
    const byteLength = new TextEncoder().encode(value).byteLength;
    if (!value || byteLength > MAX_VALUE_BYTES) {
      throw new Error("One-time record value is empty or too large.");
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
      throw new Error("One-time record TTL is outside the permitted range.");
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.sql.exec(
      `INSERT INTO oauth_one_time_record (id, value, expires_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      value,
      expiresAt
    );
    return expiresAt;
  }

  consume(): string | null {
    const row = this.sql.exec<{ value: string; expires_at: number }>(
      "DELETE FROM oauth_one_time_record WHERE id = 1 RETURNING value, expires_at"
    ).toArray()[0];
    if (!row || row.expires_at <= Date.now()) return null;
    return row.value;
  }

  clear(): void {
    this.sql.exec("DELETE FROM oauth_one_time_record WHERE id = 1");
  }
}
