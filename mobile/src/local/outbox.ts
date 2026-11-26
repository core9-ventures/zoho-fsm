import { ApiError, request } from "../api/http";
import { getDb, isLocalDbAvailable } from "./db";
import { fileStore } from "./fileStore";
import { flushGps } from "./gps";

/**
 * The outbox: every change a technician makes is first saved on the phone, then sent to the server in the order it was
 * made. With a signal it goes out at once; without one it waits and is sent when the signal returns.
 *
 * - Every change has an Idempotency-Key. The same key is used for every attempt, so when an answer gets lost on the
 *   way the server recognises the repeat and does not apply the change twice.
 * - A change the server refuses (job no longer yours, status already changed, invalid data) is marked `failed` and
 *   stays visible, instead of blocking the changes behind it forever. A missing signal or a server error is not a
 *   refusal: the change stays `pending` and is tried again.
 * - A record created on the phone has a temporary id (`local-...`). Once the server has saved it, `id_map` says which
 *   real id it got, and later changes that mention the temporary id are rewritten before they are sent.
 */

export type OutboxItem = {
  seq: number;
  label: string;
  status: "pending" | "failed";
  error: string | null;
  attempts: number;
  createdAt: number;
};

type Row = {
  seq: number;
  key: string;
  method: string;
  path: string;
  body: string | null;
  label: string;
  local_id: string | null;
  status: "pending" | "failed";
  error: string | null;
  attempts: number;
  created_at: number;
  file_name: string | null;
  file_type: string | null;
  file_fields: string | null;
};

export const LOCAL_ID_PREFIX = "local-";
const LOCAL_ID = /local-[0-9a-zA-Z-]{8,}/g;

export const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export const newLocalId = () => `${LOCAL_ID_PREFIX}${newKey()}`;
export const isLocalId = (id: string) => id.startsWith(LOCAL_ID_PREFIX);

// ---- What the screens show: how many changes wait, and whether the last attempt is running ----

export type OutboxStatus = { pending: number; failed: number; sending: boolean };
let status: OutboxStatus = { pending: 0, failed: 0, sending: false };
const listeners = new Set<() => void>();
const setStatus = (patch: Partial<OutboxStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn());
};
export const outboxStatus = {
  get: () => status,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** Counts what is in the outbox (call when the app opens and after every change to the queue). */
export async function refreshOutboxStatus(): Promise<void> {
  const db = await getDb();
  if (!db) return setStatus({ pending: 0, failed: 0 });
  const rows = await db.all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM outbox GROUP BY status");
  setStatus({
    pending: rows.find((r) => r.status === "pending")?.n ?? 0,
    failed: rows.find((r) => r.status === "failed")?.n ?? 0,
  });
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.all<Row>("SELECT * FROM outbox ORDER BY seq");
  return rows.map((r) => ({
    seq: r.seq,
    label: r.label,
    status: r.status,
    error: r.error,
    attempts: r.attempts,
    createdAt: r.created_at,
  }));
}

/** The real id of a record that was created on the phone (or the same id when it is not a temporary one). */
export async function resolveId(id: string): Promise<string> {
  if (!isLocalId(id)) return id;
  const db = await getDb();
  const row = db ? (await db.all<{ server_id: string }>("SELECT server_id FROM id_map WHERE local_id = ?", [id]))[0] : null;
  return row?.server_id ?? id;
}

// ---- Putting a change in the queue ----

export type Change = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Relative to /api/v1, as for `request`. May contain a temporary id. */
  path: string;
  body?: unknown;
  /** Shown to the technician when the change is waiting or was refused, e.g. "Start job WO-1024". */
  label: string;
  /** For a change that creates a record on the phone: its temporary id. */
  localId?: string;
  /** Shows the change on the phone straight away (the saved copy of the job or record). */
  optimistic?: () => Promise<void>;
  /**
   * A photo or video to upload (sent as multipart, `body` is not used). Needs `localId`: the file is kept on the
   * phone under it until the server has it, and the screens show it from there in the meantime.
   */
  file?: { blob: Blob; name: string; fields: Record<string, string> };
};

function formOf(file: NonNullable<Change["file"]>) {
  const form = new FormData();
  form.set("file", file.blob, file.name);
  for (const [k, v] of Object.entries(file.fields)) form.set(k, v);
  return form;
}

export type WriteResult<T> = { queued: false; data: T } | { queued: true; data?: undefined };

/** The server was not reached and may or may not have seen the call: worth sending again with the same key. */
const isRetryable = (e: unknown) =>
  e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 429 || e.status === 408);

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

let sending = false;
let running: Promise<FlushResult> | null = null;

/**
 * Makes one change. With a phone database (technicians in the app) the change is queued whenever it cannot be sent
 * right now: there is no signal, or earlier changes are still waiting (order must be kept). Otherwise it is sent
 * straight away and a refusal by the server reaches the screen as an error, as before.
 */
export async function write<T>(change: Change): Promise<WriteResult<T>> {
  const db = isLocalDbAvailable() ? await getDb() : null;
  const key = newKey();
  const opts = change.file
    ? { form: formOf(change.file), idempotencyKey: key }
    : { body: change.body, idempotencyKey: key };
  if (!db) return { queued: false, data: await request<T>(change.method, change.path, opts) };

  if (status.pending === 0 && !sending && !offline()) {
    try {
      return { queued: false, data: await request<T>(change.method, change.path, opts) };
    } catch (e) {
      if (!isRetryable(e)) throw e;
    }
  }

  if (change.file) {
    if (!change.localId) throw new Error("A file change needs a temporary id.");
    // The file goes to the phone's storage first: if that fails, nothing is queued and the screen shows the error.
    await fileStore.save(change.localId, change.file.blob);
  }
  await db.batch([
    {
      sql: "INSERT INTO outbox (key, method, path, body, label, local_id, status, attempts, created_at, file_name, file_type, file_fields) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)",
      params: [
        key,
        change.method,
        change.path,
        change.body === undefined ? null : JSON.stringify(change.body),
        change.label,
        change.localId ?? null,
        Date.now(),
        change.file?.name ?? null,
        change.file?.blob.type ?? null,
        change.file ? JSON.stringify(change.file.fields) : null,
      ],
    },
  ]);
  try {
    await change.optimistic?.();
  } catch (e) {
    console.error("Could not show the queued change on the phone", e);
  }
  await refreshOutboxStatus();
  if (!offline()) await flushOutbox();
  return { queued: true };
}

// ---- Sending the queue ----

export type FlushResult = {
  /** Changes that reached the server in this run. */
  sent: number;
  /** True when the run stopped because the server could not be reached (the rest stays pending). */
  stopped: boolean;
};

/** Replaces temporary ids by the real ones. Returns null when one of them never got a real id. */
async function withRealIds(row: Row): Promise<{ path: string; body: unknown } | null> {
  const db = await getDb();
  const text = `${row.path}\n${row.body ?? ""}`;
  const found = new Set(text.match(LOCAL_ID) ?? []);
  let path = row.path;
  let body = row.body;
  for (const id of found) {
    // The temporary id of the record this very change creates is not an id to replace.
    if (id === row.local_id) continue;
    const m = db ? (await db.all<{ server_id: string }>("SELECT server_id FROM id_map WHERE local_id = ?", [id]))[0] : null;
    if (!m) return null;
    path = path.split(id).join(m.server_id);
    if (body) body = body.split(id).join(m.server_id);
  }
  return { path, body: body ? JSON.parse(body) : undefined };
}

/** Sends the waiting changes, oldest first. Never throws; a run that is already going is joined. */
export function flushOutbox(): Promise<FlushResult> {
  if (!isLocalDbAvailable()) return Promise.resolve({ sent: 0, stopped: false });
  running ??= (async () => {
    sending = true;
    setStatus({ sending: true });
    let sent = 0;
    let stopped = false;
    try {
      const db = await getDb();
      if (!db) return { sent, stopped };
      for (;;) {
        const row = (await db.all<Row>("SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT 1"))[0];
        if (!row) break;
        const ready = await withRealIds(row);
        if (!ready) {
          await db.batch([
            {
              sql: "UPDATE outbox SET status = 'failed', error = ? WHERE seq = ?",
              params: ["It depends on an earlier change that was not saved.", row.seq],
            },
          ]);
          continue;
        }
        let form: FormData | undefined;
        if (row.file_name && row.local_id) {
          const blob = await fileStore.read(row.local_id);
          if (!blob) {
            await db.batch([
              {
                sql: "UPDATE outbox SET status = 'failed', error = ? WHERE seq = ?",
                params: ["The photo or video is no longer on the phone.", row.seq],
              },
            ]);
            continue;
          }
          form = formOf({ blob, name: row.file_name, fields: JSON.parse(row.file_fields ?? "{}") as Record<string, string> });
        }
        try {
          const data = await request<unknown>(row.method as Change["method"], ready.path, {
            body: form ? undefined : ready.body,
            form,
            idempotencyKey: row.key,
          });
          const created = row.local_id && data && typeof data === "object" ? (data as { id?: unknown }).id : null;
          await db.batch([
            ...(row.local_id && typeof created === "string"
              ? [{ sql: "INSERT OR REPLACE INTO id_map (local_id, server_id) VALUES (?, ?)", params: [row.local_id, created] }]
              : []),
            // The temporary copy of a record created on the phone goes; the real one comes with the next sync.
            ...(row.local_id
              ? [
                  { sql: "DELETE FROM installations WHERE id = ?", params: [row.local_id] },
                  { sql: "DELETE FROM installation_details WHERE id = ?", params: [row.local_id] },
                ]
              : []),
            { sql: "DELETE FROM outbox WHERE seq = ?", params: [row.seq] },
          ]);
          if (row.file_name && row.local_id) await fileStore.remove(row.local_id);
          sent++;
        } catch (e) {
          const message = e instanceof Error ? e.message : "The change could not be sent.";
          if (isRetryable(e) || (e instanceof ApiError && e.status === 401)) {
            await db.batch([
              { sql: "UPDATE outbox SET attempts = attempts + 1, error = ? WHERE seq = ?", params: [message, row.seq] },
            ]);
            stopped = true;
            break;
          }
          await db.batch([
            {
              sql: "UPDATE outbox SET status = 'failed', error = ?, attempts = attempts + 1 WHERE seq = ?",
              params: [message, row.seq],
            },
          ]);
        }
      }
      // GPS readings taken without a signal go out once the queue got through.
      if (!stopped) await flushGps();
      return { sent, stopped };
    } catch (e) {
      console.error("Outbox error", e);
      return { sent, stopped: true };
    } finally {
      sending = false;
      running = null;
      setStatus({ sending: false });
      await refreshOutboxStatus().catch(() => undefined);
    }
  })();
  return running;
}

/** Puts every refused change back in the queue to be sent again (the technician pressed "Try again"). */
export async function retryFailed(): Promise<void> {
  const db = await getDb();
  await db?.batch([{ sql: "UPDATE outbox SET status = 'pending', error = NULL WHERE status = 'failed'" }]);
  await refreshOutboxStatus();
  await flushOutbox();
}

/** Drops one waiting or refused change (the technician chose to give it up). */
export async function discardChange(seq: number): Promise<void> {
  const db = await getDb();
  const row = db ? (await db.all<Row>("SELECT * FROM outbox WHERE seq = ?", [seq]))[0] : null;
  if (row?.file_name && row.local_id) await fileStore.remove(row.local_id);
  await db?.batch([{ sql: "DELETE FROM outbox WHERE seq = ?", params: [seq] }]);
  await refreshOutboxStatus();
}

/**
 * Takes back a photo or video that is still waiting to be uploaded (the technician removed it again).
 * Returns false when it is not in the queue any more (it was uploaded: then it has a real id to delete).
 */
export async function cancelQueuedFile(localId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const row = (await db.all<Row>("SELECT * FROM outbox WHERE local_id = ? AND file_name IS NOT NULL", [localId]))[0];
  if (!row) return false;
  await db.batch([{ sql: "DELETE FROM outbox WHERE seq = ?", params: [row.seq] }]);
  await fileStore.remove(localId);
  await refreshOutboxStatus();
  return true;
}
