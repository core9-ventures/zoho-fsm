import { ApiError } from "../api/http";
import { syncApi } from "../api/sync";
import { syncCache } from "./cache";
import { getDb, isLocalDbAvailable } from "./db";

/**
 * Keeps the phone database up to date with the server: jobs of the next 7 days plus the ones in progress, the
 * technician's installations and the companies to pick from. The first sync (and one every day) copies everything;
 * the others ask the server only for what changed since the last answer.
 */

const FULL_COPY_EVERY_MS = 24 * 3600_000;

export type SyncStatus = {
  /** False in the browser preview (no phone database): nothing to sync. */
  available: boolean;
  syncing: boolean;
  /** When (phone clock) the last sync finished; null if it never did. */
  lastSyncedAt: number | null;
  /** Why the last attempt failed; null when it worked. */
  error: string | null;
  /** True when the last attempt failed only because the server could not be reached. */
  offline: boolean;
};

let status: SyncStatus = { available: isLocalDbAvailable(), syncing: false, lastSyncedAt: null, error: null, offline: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn());
};

export const syncStatus = {
  get: () => status,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** Reads the time of the last sync from the phone database (used when the app opens). */
export async function loadSyncStatus(): Promise<void> {
  const state = await syncCache.state();
  set({ lastSyncedAt: state?.lastSyncedAt ?? null, error: null, offline: false });
}

let running: Promise<void> | null = null;

/** Runs one sync (a call while one is running joins it). Never throws: the result is in `syncStatus`. */
export function syncNow(opts: { full?: boolean } = {}): Promise<void> {
  if (!isLocalDbAvailable()) return Promise.resolve();
  running ??= (async () => {
    set({ syncing: true });
    try {
      if (!(await getDb())) return;
      const state = await syncCache.state();
      const full = opts.full || !state || Date.now() - state.lastFullAt > FULL_COPY_EVERY_MS;
      const res = await syncApi.get(full ? undefined : state.serverTime);
      const saved = await syncCache.apply(res);
      set({ lastSyncedAt: saved?.lastSyncedAt ?? Date.now(), error: null, offline: false });
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork) set({ error: "No connection. Showing the saved data.", offline: true });
      else if (e instanceof ApiError && e.status === 401) set({ error: null, offline: false }); // signed out: nothing to show
      else set({ error: e instanceof Error ? e.message : "Could not sync.", offline: false });
    } finally {
      set({ syncing: false });
      running = null;
    }
  })();
  return running;
}
