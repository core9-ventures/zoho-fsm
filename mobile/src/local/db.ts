import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import { migrate } from "./migrations";
import type { Db } from "./types";

export type { Db, Statement } from "./types";

/**
 * The phone's own database (SQLite, through the Capacitor SQLite plugin). One database per signed-in user, deleted
 * when that user signs out. In the browser preview there is no SQLite: `getDb()` returns null and the app simply
 * talks to the server, as in Stage 1.
 */

export const isLocalDbAvailable = () => Capacitor.isNativePlatform();

const sqlite = new SQLiteConnection(CapacitorSQLite);

let current: { name: string; conn: SQLiteDBConnection; db: Db } | null = null;
/** The open (or opening) database, so a screen that loads while it is still opening waits for it. */
let opening: Promise<Db | null> | null = null;

/** The plugin keeps database names in lower case. */
const nameFor = (userId: string) => `fieldserve_${userId.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

function wrap(conn: SQLiteDBConnection): Db {
  return {
    exec: async (sql) => {
      await conn.execute(sql, false);
    },
    batch: async (statements) => {
      if (statements.length === 0) return;
      await conn.executeSet(
        statements.map((s) => ({ statement: s.sql, values: s.params ?? [] })),
        true,
      );
    },
    all: async <T,>(sql: string, params: (string | number | null)[] = []) => {
      const res = await conn.query(sql, params);
      return (res.values ?? []) as T[];
    },
  };
}

async function closeCurrent() {
  if (!current) return;
  const { name, conn } = current;
  current = null;
  try {
    await conn.close();
  } catch {
    /* already closed */
  }
  try {
    await sqlite.closeConnection(name, false);
  } catch {
    /* already closed */
  }
}

/** Opens (and, the first time, creates) the database of this user. Safe to call again for the same user. */
export function openUserDb(userId: string): Promise<Db | null> {
  if (!isLocalDbAvailable()) return Promise.resolve(null);
  const name = nameFor(userId);
  if (current?.name === name) return Promise.resolve(current.db);

  opening = (async () => {
    try {
      await closeCurrent();
      const consistent = (await sqlite.checkConnectionsConsistency()).result;
      const exists = (await sqlite.isConnection(name, false)).result;
      const conn =
        consistent && exists
          ? await sqlite.retrieveConnection(name, false)
          : await sqlite.createConnection(name, false, "no-encryption", 1, false);
      await conn.open();
      const db = wrap(conn);
      await migrate(db);
      current = { name, conn, db };
      return db;
    } catch (e) {
      // A broken local database must never stop the app: it falls back to the server.
      console.error("Phone database could not be opened", e);
      current = null;
      return null;
    }
  })();
  return opening;
}

/** The open database, or null in the browser or when it could not be opened. */
export async function getDb(): Promise<Db | null> {
  if (current) return current.db;
  return opening ? opening : null;
}

/** How many changes made on the phone are still waiting to reach the server. */
async function unsentChanges(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    return (await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM outbox"))[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Closes and deletes the phone database: used when the user signs out or the session ends.
 * With `keepUnsent`, nothing is deleted while changes are still waiting to be sent: they stay on the phone (in this
 * user's own database) and go out the next time the same user signs in with a signal.
 */
export async function wipeLocalData(opts: { keepUnsent?: boolean } = {}): Promise<void> {
  if (!isLocalDbAvailable()) return;
  if (opts.keepUnsent && (await unsentChanges()) > 0) return;
  const pending = opening;
  opening = null;
  try {
    await pending;
  } catch {
    /* ignore */
  }
  const name = current?.name;
  await closeCurrent();
  if (!name) return;
  try {
    await CapacitorSQLite.deleteDatabase({ database: name, readonly: false });
  } catch (e) {
    console.error("Phone database could not be deleted", e);
  }
}
