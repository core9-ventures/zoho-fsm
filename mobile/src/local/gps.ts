import { ApiError, request } from "../api/http";
import type { LocationInput } from "../api/jobTypes";
import { getDb, isLocalDbAvailable } from "./db";

/**
 * GPS readings taken without a signal. A reading that cannot be sent is kept on the phone with the time it was
 * taken; when the signal returns the readings go to the server in batches of 100, so the dispatcher's history shows
 * where the technician really was.
 */

const BATCH = 100;
/** The phone keeps at most this many unsent readings (about three days at one a minute); the oldest go first. */
const KEEP_AT_MOST = 5000;

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const retryable = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 429);

let flushing: Promise<number> | null = null;
let backlog = 0;

async function store(input: LocationInput) {
  const db = await getDb();
  if (!db) return;
  await db.batch([
    {
      sql: "INSERT INTO gps_points (data, recorded_at) VALUES (?, ?)",
      params: [JSON.stringify(input), new Date().toISOString()],
    },
    { sql: "DELETE FROM gps_points WHERE id <= (SELECT MAX(id) FROM gps_points) - ?", params: [KEEP_AT_MOST] },
  ]);
  backlog++;
}

/** How many readings wait on the phone. */
export async function gpsBacklog(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  backlog = (await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM gps_points"))[0]?.n ?? 0;
  return backlog;
}

/** Sends the waiting readings, oldest first. Returns how many were saved by the server. Never throws. */
export function flushGps(): Promise<number> {
  if (!isLocalDbAvailable()) return Promise.resolve(0);
  flushing ??= (async () => {
    let saved = 0;
    try {
      const db = await getDb();
      if (!db) return 0;
      for (;;) {
        const rows = await db.all<{ id: number; data: string; recorded_at: string }>(
          "SELECT id, data, recorded_at FROM gps_points ORDER BY id LIMIT ?",
          [BATCH],
        );
        if (rows.length === 0) break;
        const points = rows.map((r) => ({ ...(JSON.parse(r.data) as LocationInput), recordedAt: r.recorded_at }));
        const ids = rows.map((r) => r.id);
        try {
          // The same readings always make the same key, so a batch whose answer got lost is not saved twice.
          await request("POST", "/field/location/batch", {
            body: { points },
            idempotencyKey: `gps-${ids[0]}-${ids[ids.length - 1]}-${ids.length}`,
          });
          saved += rows.length;
        } catch (e) {
          if (retryable(e) || (e instanceof ApiError && e.status === 401)) break;
          // The server refused these readings (invalid): they can never be accepted, so they are dropped.
        }
        await db.batch([{ sql: `DELETE FROM gps_points WHERE id IN (${ids.map(() => "?").join(",")})`, params: ids }]);
      }
      return saved;
    } catch (e) {
      console.error("GPS queue error", e);
      return saved;
    } finally {
      flushing = null;
      await gpsBacklog().catch(() => undefined);
    }
  })();
  return flushing;
}

/**
 * One reading: sent at once when there is a signal, kept on the phone otherwise. Earlier readings go first, so the
 * history stays in order.
 */
export async function recordReading(input: LocationInput): Promise<void> {
  const db = isLocalDbAvailable() ? await getDb() : null;
  if (!db) {
    await request("POST", "/field/location", { body: input });
    return;
  }
  if (backlog === 0 && !offline()) {
    try {
      await request("POST", "/field/location", { body: input });
      return;
    } catch (e) {
      if (!retryable(e)) throw e;
    }
  }
  await store(input);
  if (!offline()) void flushGps();
}
