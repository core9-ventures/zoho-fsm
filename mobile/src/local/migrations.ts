/**
 * The tables of the phone database. Each entry runs once, in order, and the number is kept in the `meta` table, so a
 * later app version adds an entry here (never edits an old one) and the phone updates itself without losing data.
 *
 * Every table has the server id, a `data` column with the server's own JSON, the time it was saved on the phone and a
 * `deleted` flag. Sync (Phase 2) updates these rows; the columns next to `data` are only there to filter and sort.
 */
import type { Db } from "./types";

export type Migration = { version: number; statements: string[] };

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      // The technician's visits (rows of "My jobs"). `position` keeps the order the server sent them in.
      `CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        work_order_id TEXT NOT NULL,
        day TEXT NOT NULL,
        status TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS jobs_day ON jobs (day)`,
      // One job with its checklist, notes, address and photos.
      `CREATE TABLE IF NOT EXISTS job_details (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      )`,
      // Rows of "My installations".
      `CREATE TABLE IF NOT EXISTS installations (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        search_text TEXT NOT NULL,
        data TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS installations_status ON installations (status, created_at)`,
      // One installation record in full (form values, photos, checklist).
      `CREATE TABLE IF NOT EXISTS installation_details (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      )`,
      // The companies and saved sites offered on the new-installation form.
      `CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      )`,
    ],
  },
  {
    version: 2,
    statements: [
      // Changes made on the phone that the server has not received yet, oldest first (Phase 3, the outbox).
      // `status` is pending (will be sent) or failed (the server refused it; the technician decides what to do).
      // `key` is the Idempotency-Key: every send of one change uses the same key, so the server applies it once.
      `CREATE TABLE IF NOT EXISTS outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        body TEXT,
        label TEXT NOT NULL,
        local_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
      // A record created on the phone gets a temporary id; once the server saved it, this says which real id it got.
      `CREATE TABLE IF NOT EXISTS id_map (
        local_id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 3,
    statements: [
      // Photos and videos waiting to be uploaded (Phase 4): the file itself is kept in the phone's file storage,
      // under the change's `local_id`; here only what is needed to send it.
      `ALTER TABLE outbox ADD COLUMN file_name TEXT`,
      `ALTER TABLE outbox ADD COLUMN file_type TEXT`,
      `ALTER TABLE outbox ADD COLUMN file_fields TEXT`,
      // GPS readings taken without a signal, sent in batches when it returns.
      `CREATE TABLE IF NOT EXISTS gps_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      )`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Creates the `meta` table and runs every migration the database has not seen yet. */
export async function migrate(db: Db) {
  await db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const row = (await db.all<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0];
  const have = row ? Number(row.value) : 0;
  for (const m of MIGRATIONS) {
    if (m.version <= have) continue;
    await db.batch([
      ...m.statements.map((sql) => ({ sql })),
      { sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", params: [String(m.version)] },
    ]);
  }
}
