import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../mobile/src/local/migrations";
import type { Db } from "../../mobile/src/local/types";

// Phone outbox (Offline Phase 3): the queue, the retries and the temporary ids, on a real in-memory SQLite database.
type SqliteModule = {
  DatabaseSync: new (path: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => { run: (...p: unknown[]) => unknown; all: (...p: unknown[]) => unknown[] };
  };
};
const sqliteModule = (() => {
  try {
    return createRequire(import.meta.url)("node:sqlite") as SqliteModule;
  } catch {
    return null;
  }
})();

const holder: { db: Db | null } = { db: null };
vi.mock("../../mobile/src/local/db", () => ({ getDb: async () => holder.db, isLocalDbAvailable: () => true }));

// The phone's file storage, in memory.
const files = new Map<string, Blob>();
vi.mock("../../mobile/src/local/fileStore", () => ({
  fileStore: {
    save: async (id: string, blob: Blob) => {
      if (failSave) throw new Error("ENOSPC");
      files.set(id, blob);
    },
    read: async (id: string) => files.get(id) ?? null,
    remove: async (id: string) => void files.delete(id),
    names: async () => [...files.keys()],
  },
}));
let failSave = false;

type Call = { method: string; path: string; body?: unknown; idempotencyKey?: string; form?: FormData; timeoutMs?: number };
const calls: Call[] = [];
let respond: (c: Call) => unknown = () => null;
vi.mock("../../mobile/src/api/http", async (orig) => {
  const real = await orig<typeof import("../../mobile/src/api/http")>();
  return {
    ...real,
    request: async (
      method: string,
      path: string,
      opts: { body?: unknown; idempotencyKey?: string; form?: FormData; timeoutMs?: number } = {},
    ) => {
      const c = { method, path, body: opts.body, idempotencyKey: opts.idempotencyKey, form: opts.form, timeoutMs: opts.timeoutMs };
      calls.push(c);
      return respond(c);
    },
  };
});

import { ApiError } from "../../mobile/src/api/http";
import { installationsCache, jobsCache } from "../../mobile/src/local/cache";
import { optimistic } from "../../mobile/src/local/optimistic";
import { flushGps, gpsBacklog, recordReading } from "../../mobile/src/local/gps";
import {
  cancelQueuedFile,
  discardChange,
  flushOutbox,
  isLocalId,
  listOutbox,
  newLocalId,
  outboxStatus,
  sweepOrphanFiles,
  DIRECT_TIMEOUT_MS,
  refreshOutboxStatus,
  resolveId,
  retryFailed,
  write,
} from "../../mobile/src/local/outbox";

function memoryDb(): Db {
  const sql = new sqliteModule!.DatabaseSync(":memory:");
  return {
    exec: async (s) => void sql.exec(s),
    batch: async (statements) => {
      sql.exec("BEGIN");
      try {
        for (const s of statements) sql.prepare(s.sql).run(...(s.params ?? []));
        sql.exec("COMMIT");
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
    all: async <T,>(s: string, params: (string | number | null)[] = []) => sql.prepare(s).all(...params) as T[],
  };
}

const setOnline = (online: boolean) => Object.defineProperty(globalThis, "navigator", { value: { onLine: online }, configurable: true });
const noSignal = () => new ApiError("Could not reach the server.", 0);

const jobDetail = (id = "wo1") => ({
  id,
  number: "WO-1",
  title: "Fix",
  description: null,
  status: "SCHEDULED",
  priority: "MEDIUM",
  customer: { name: "Acme", phone: null },
  address: null,
  assetName: null,
  visit: { day: "2026-11-26", startTime: "09:00", endTime: "10:00", status: "SCHEDULED" },
  actions: ["on-my-way", "start"],
  checkedInAt: null,
  checklist: [{ id: "c1", text: "Check", isDone: false }],
  notes: [],
  hasTempSensor: false,
  evidence: { before: [], after: [] },
  meId: "u1",
  closed: false,
});

describe.skipIf(!sqliteModule)("Offline Phase 3 — outbox on the phone", () => {
  beforeEach(async () => {
    holder.db = memoryDb();
    await migrate(holder.db);
    calls.length = 0;
    files.clear();
    failSave = false;
    respond = () => null;
    setOnline(true);
    await refreshOutboxStatus();
  });

  it("sends a change straight away when there is a signal and nothing is waiting", async () => {
    const res = await write({ method: "POST", path: "/field/jobs/wo1/notes", body: { text: "hi" }, label: "Note" });
    expect(res.queued).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].idempotencyKey).toBeTruthy();
    expect(await listOutbox()).toHaveLength(0);
  });

  it("a refusal by the server reaches the screen and nothing is queued", async () => {
    respond = () => {
      throw new ApiError("Not yours.", 409);
    };
    await expect(write({ method: "POST", path: "/x", label: "X" })).rejects.toThrow("Not yours.");
    expect(await listOutbox()).toHaveLength(0);
  });

  it("without a signal the change is queued, shown on the phone and not sent", async () => {
    setOnline(false);
    await jobsCache.saveDetail(jobDetail() as never);
    const res = await write({
      method: "POST",
      path: "/field/jobs/wo1/transition",
      body: { action: "start" },
      label: "Start work: WO-1",
      optimistic: () => optimistic.transition("wo1", "start"),
    });
    expect(res.queued).toBe(true);
    expect(calls).toHaveLength(0);
    expect(outboxStatus.get().pending).toBe(1);
    const shown = await jobsCache.loadDetail("wo1");
    expect(shown?.status).toBe("IN_PROGRESS");
    expect(shown?.actions).toEqual(["complete", "hold"]);
  });

  it("a network error while sending queues the change with the SAME key (the server may have saved it)", async () => {
    respond = () => {
      throw noSignal();
    };
    const res = await write({ method: "POST", path: "/field/jobs/wo1/notes", body: { text: "hi" }, label: "Note" });
    expect(res.queued).toBe(true);
    const firstKey = calls[0].idempotencyKey;
    // The flush after queueing already tried again, with the same key.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(calls.map((c) => c.idempotencyKey))).toEqual(new Set([firstKey]));
    expect((await listOutbox())[0].status).toBe("pending");
  });

  it("sends the queue in the order it was made, then empties it", async () => {
    setOnline(false);
    await write({ method: "POST", path: "/a", label: "A" });
    await write({ method: "POST", path: "/b", label: "B" });
    await write({ method: "POST", path: "/c", label: "C" });
    setOnline(true);
    const r = await flushOutbox();
    expect(r).toEqual({ sent: 3, stopped: false });
    expect(calls.map((c) => c.path)).toEqual(["/a", "/b", "/c"]);
    expect(await listOutbox()).toHaveLength(0);
    expect(outboxStatus.get().pending).toBe(0);
  });

  it("keeps the order: a new change waits behind older ones instead of overtaking them", async () => {
    setOnline(false);
    await write({ method: "POST", path: "/first", label: "First" });
    setOnline(true);
    respond = (c) => {
      if (c.path === "/first" && calls.filter((x) => x.path === "/first").length === 1) throw noSignal();
      return null;
    };
    await write({ method: "POST", path: "/second", label: "Second" });
    // /first failed for lack of signal, so /second must not have gone first.
    expect(calls.map((c) => c.path)).toEqual(["/first"]);
    await flushOutbox();
    expect(calls.map((c) => c.path)).toEqual(["/first", "/first", "/second"]);
  });

  it("stops at the first network error and keeps the rest pending", async () => {
    setOnline(false);
    await write({ method: "POST", path: "/a", label: "A" });
    await write({ method: "POST", path: "/b", label: "B" });
    setOnline(true);
    respond = () => {
      throw noSignal();
    };
    const r = await flushOutbox();
    expect(r.stopped).toBe(true);
    expect(calls).toHaveLength(1);
    const items = await listOutbox();
    expect(items.map((i) => i.status)).toEqual(["pending", "pending"]);
    expect(items[0].attempts).toBe(1);
  });

  it("a change the server refuses is marked failed and does not block the ones behind it", async () => {
    setOnline(false);
    await write({ method: "POST", path: "/bad", label: "Bad" });
    await write({ method: "POST", path: "/good", label: "Good" });
    setOnline(true);
    respond = (c) => {
      if (c.path === "/bad") throw new ApiError("WO-1 is completed; you cannot do that now.", 409);
      return null;
    };
    const r = await flushOutbox();
    expect(r).toEqual({ sent: 1, stopped: false });
    const items = await listOutbox();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: "Bad", status: "failed", error: "WO-1 is completed; you cannot do that now." });
    expect(outboxStatus.get()).toMatchObject({ pending: 0, failed: 1 });

    // "Send now" puts it back in the queue; giving up removes it.
    await retryFailed();
    expect(calls.filter((c) => c.path === "/bad")).toHaveLength(2);
    await discardChange(items[0].seq);
    expect(await listOutbox()).toHaveLength(0);
  });

  it("a 5xx answer is retried later, not given up", async () => {
    setOnline(false);
    await write({ method: "POST", path: "/a", label: "A" });
    setOnline(true);
    respond = () => {
      throw new ApiError("boom", 503);
    };
    await flushOutbox();
    expect((await listOutbox())[0].status).toBe("pending");
  });

  it("a record created offline gets a temporary id; later changes use the real id once it exists", async () => {
    setOnline(false);
    const localId = newLocalId();
    expect(isLocalId(localId)).toBe(true);
    await write({ method: "POST", path: "/field/installations/hold", body: { v: 1 }, label: "Held", localId });
    await write({ method: "PUT", path: `/field/installations/${localId}/hold`, body: { v: 2, ref: localId }, label: "Edit" });
    setOnline(true);
    respond = (c) => (c.method === "POST" ? { id: "real-123" } : { id: "real-123" });
    await flushOutbox();
    expect(calls.map((c) => c.path)).toEqual(["/field/installations/hold", "/field/installations/real-123/hold"]);
    expect(calls[1].body).toEqual({ v: 2, ref: "real-123" });
    expect(await resolveId(localId)).toBe("real-123");
  });

  it("a change that depends on a record whose creation was refused fails too", async () => {
    setOnline(false);
    const localId = newLocalId();
    await write({ method: "POST", path: "/field/installations", body: {}, label: "New", localId });
    await write({ method: "POST", path: `/field/installations/${localId}/complete`, body: {}, label: "Complete" });
    setOnline(true);
    respond = () => {
      throw new ApiError("Validation failed.", 400);
    };
    await flushOutbox();
    const items = await listOutbox();
    expect(items.map((i) => i.status)).toEqual(["failed", "failed"]);
    expect(items[1].error).toMatch(/earlier change/);
    expect(calls).toHaveLength(1);
  });

  it("the temporary copy of a new installation is replaced once the server has saved it", async () => {
    setOnline(false);
    const localId = newLocalId();
    await write({
      method: "POST",
      path: "/field/installations/hold",
      body: {},
      label: "Held",
      localId,
      optimistic: () =>
        optimistic.installationSaved(
          localId,
          {
            customerId: "",
            vehicleNo: "abc 123",
            deviceId: "D1",
            simNo: "",
            installDate: "2026-11-26",
            location: "Depot",
            latitude: "",
            longitude: "",
            deviceType: "",
            hasTempSensor: false,
            checklist: [],
            notes: "",
            holdReason: "No power",
            fill: null,
          },
          "ON_HOLD",
          "Tech One",
        ),
    });
    const list = await installationsCache.loadList({ status: "ON_HOLD" });
    expect(list?.items.map((i) => i.id)).toEqual([localId]);
    expect(list?.items[0]).toMatchObject({ vehicleNo: "ABC 123", holdReason: "No power", createdBy: "Tech One" });
    expect((await installationsCache.loadDetail(localId))?.status).toBe("ON_HOLD");

    setOnline(true);
    respond = () => ({ id: "real-9" });
    await flushOutbox();
    expect((await installationsCache.loadList({ status: "ON_HOLD" }))?.items).toEqual([]);
    expect(await installationsCache.loadDetail(localId)).toBeNull();
  });

  it("shows checklist and note changes at once", async () => {
    setOnline(false);
    await jobsCache.saveDetail(jobDetail() as never);
    await write({
      method: "PUT",
      path: "/field/jobs/wo1/checklist/c1",
      body: { isDone: true },
      label: "Checklist",
      optimistic: () => optimistic.checklist("wo1", "c1", true),
    });
    await write({
      method: "POST",
      path: "/field/jobs/wo1/notes",
      body: { text: "done here" },
      label: "Note",
      optimistic: () => optimistic.note("wo1", newLocalId(), "done here"),
    });
    const job = await jobsCache.loadDetail("wo1");
    expect(job?.checklist[0].isDone).toBe(true);
    expect(job?.notes.map((n) => n.text)).toEqual(["done here"]);
    expect(job?.notes[0].mine).toBe(true);
  });

  // ---- Photos and videos ----


  it("a photo taken without a signal is kept on the phone, shown at once and uploaded later with its fields", async () => {
    setOnline(false);
    await jobsCache.saveDetail(jobDetail() as never);
    const blob = new Blob(["pixels"], { type: "image/jpeg" });
    const localId = newLocalId();
    const res = await write({
      method: "POST",
      path: "/field/jobs/wo1/attachments",
      label: "Photo for WO-1",
      localId,
      file: { blob, name: "front.jpg", fields: { phase: "BEFORE", slot: "FRONT" } },
      optimistic: () => optimistic.jobFile("wo1", "BEFORE", { id: localId, name: "front.jpg", kind: "PHOTO", slot: "FRONT", type: "image/jpeg" }),
    });
    expect(res.queued).toBe(true);
    expect(files.has(localId)).toBe(true);
    expect(calls).toHaveLength(0);
    const shown = await jobsCache.loadDetail("wo1");
    expect(shown?.evidence.before.map((m) => [m.id, m.slot, m.kind])).toEqual([[localId, "FRONT", "PHOTO"]]);

    setOnline(true);
    respond = () => ({ id: "att-1" });
    await flushOutbox();
    expect(calls).toHaveLength(1);
    expect(calls[0].form?.get("phase")).toBe("BEFORE");
    expect(calls[0].form?.get("slot")).toBe("FRONT");
    expect((calls[0].form?.get("file") as File).name).toBe("front.jpg");
    expect(files.has(localId)).toBe(false); // the file is removed once the server has it
    expect(await resolveId(localId)).toBe("att-1");
  });

  it("a new photo in a labeled box replaces the one waiting there", async () => {
    setOnline(false);
    await jobsCache.saveDetail(jobDetail() as never);
    for (const id of ["local-aaaaaaaa", "local-bbbbbbbb"]) {
      await optimistic.jobFile("wo1", "AFTER", { id, name: "x.jpg", kind: "PHOTO", slot: "FRONT", type: "image/jpeg" });
    }
    expect((await jobsCache.loadDetail("wo1"))?.evidence.after.map((m) => m.id)).toEqual(["local-bbbbbbbb"]);
  });

  it("removing a photo that is still waiting takes it out of the queue and deletes the file", async () => {
    setOnline(false);
    const localId = newLocalId();
    await write({
      method: "POST",
      path: "/field/jobs/wo1/attachments",
      label: "Photo",
      localId,
      file: { blob: new Blob(["x"], { type: "image/jpeg" }), name: "a.jpg", fields: { phase: "BEFORE" } },
    });
    expect(await cancelQueuedFile(localId)).toBe(true);
    expect(await listOutbox()).toHaveLength(0);
    expect(files.has(localId)).toBe(false);
    expect(await cancelQueuedFile(localId)).toBe(false);
  });

  it("a photo of a record created offline follows it: it uploads to the real id", async () => {
    setOnline(false);
    const recordId = newLocalId();
    const photoId = newLocalId();
    await write({ method: "POST", path: "/field/installations", body: {}, label: "New", localId: recordId });
    await write({
      method: "POST",
      path: `/field/installations/${recordId}/files`,
      label: "Photo",
      localId: photoId,
      file: { blob: new Blob(["x"], { type: "image/jpeg" }), name: "a.jpg", fields: { slot: "FRONT" } },
    });
    setOnline(true);
    respond = (c) => (c.path === "/field/installations" ? { id: "inst-7" } : { id: "att-7" });
    await flushOutbox();
    expect(calls.map((c) => c.path)).toEqual(["/field/installations", "/field/installations/inst-7/files"]);
    expect(calls[1].form?.get("slot")).toBe("FRONT");
  });

  it("a queued photo whose file has gone from the phone fails with a clear message", async () => {
    setOnline(false);
    const localId = newLocalId();
    await write({
      method: "POST",
      path: "/field/jobs/wo1/attachments",
      label: "Photo",
      localId,
      file: { blob: new Blob(["x"], { type: "image/jpeg" }), name: "a.jpg", fields: { phase: "BEFORE" } },
    });
    files.clear();
    setOnline(true);
    await flushOutbox();
    const [item] = await listOutbox();
    expect(item).toMatchObject({ status: "failed", error: "The photo or video is no longer on the phone." });
    expect(calls).toHaveLength(0);
  });

  it("giving up on a waiting photo deletes its file", async () => {
    setOnline(false);
    const localId = newLocalId();
    await write({
      method: "POST",
      path: "/field/jobs/wo1/attachments",
      label: "Photo",
      localId,
      file: { blob: new Blob(["x"], { type: "image/jpeg" }), name: "a.jpg", fields: { phase: "BEFORE" } },
    });
    const [item] = await listOutbox();
    await discardChange(item.seq);
    expect(files.has(localId)).toBe(false);
  });

  it("a photo on a record is shown and removed on an installation too", async () => {
    setOnline(false);
    await installationsCache.saveDetail({
      id: "inst-1", vehicleNo: "A", deviceId: "D", customerName: "C", deviceType: "GPS tracker", location: "L", installDate: "2026-11-26",
      createdBy: null, createdAt: "2026-11-26T00:00:00Z", status: "ON_HOLD", holdReason: "r", holdBy: "", customerId: null, simNo: null, fill: null,
      fillHistory: [], holdAt: null, latitude: null, longitude: null, hasTempSensor: false, checklist: [], notes: null, files: [], photos: [],
    });
    await optimistic.installationFile("inst-1", { id: "local-p1xxxxxxxx", name: "a.jpg", kind: "PHOTO", slot: "FRONT", type: "image/jpeg" });
    await optimistic.installationFile("inst-1", { id: "local-p2xxxxxxxx", name: "b.jpg", kind: "PHOTO", slot: null, type: "image/jpeg" });
    await optimistic.installationFile("inst-1", { id: "local-vxxxxxxxxx", name: "v.mp4", kind: "VIDEO", slot: null, type: "video/mp4" });
    let d = await installationsCache.loadDetail("inst-1");
    expect(d?.files.map((m) => m.id)).toEqual(["local-p1xxxxxxxx", "local-vxxxxxxxxx"]);
    expect(d?.photos.map((m) => m.id)).toEqual(["local-p2xxxxxxxx"]);
    await optimistic.installationFileRemoved("inst-1", "local-p1xxxxxxxx");
    d = await installationsCache.loadDetail("inst-1");
    expect(d?.files.map((m) => m.id)).toEqual(["local-vxxxxxxxxx"]);
  });

  // ---- GPS ----

  const fix = (n: number) => ({ latitude: 24 + n / 1000, longitude: 67, accuracy: 10 });

  it("sends a reading at once when there is a signal", async () => {
    await recordReading(fix(1));
    expect(calls.map((c) => c.path)).toEqual(["/field/location"]);
    expect(await gpsBacklog()).toBe(0);
  });

  it("keeps readings taken without a signal with their time and sends them in order as one batch", async () => {
    setOnline(false);
    await recordReading(fix(1));
    await recordReading(fix(2));
    await recordReading(fix(3));
    expect(calls).toHaveLength(0);
    expect(await gpsBacklog()).toBe(3);

    setOnline(true);
    respond = () => ({ saved: 3, skipped: 0 });
    expect(await flushGps()).toBe(3);
    expect(calls).toHaveLength(1);
    const body = calls[0].body as { points: { latitude: number; recordedAt: string }[] };
    expect(calls[0].path).toBe("/field/location/batch");
    expect(body.points.map((p) => p.latitude)).toEqual([24.001, 24.002, 24.003]);
    expect(body.points.every((p) => !Number.isNaN(Date.parse(p.recordedAt)))).toBe(true);
    expect(calls[0].idempotencyKey).toMatch(/^gps-/);
    expect(await gpsBacklog()).toBe(0);
  });

  it("a batch that could not be sent stays, and goes out again with the same key", async () => {
    setOnline(false);
    await recordReading(fix(1));
    setOnline(true);
    respond = () => {
      throw noSignal();
    };
    expect(await flushGps()).toBe(0);
    expect(await gpsBacklog()).toBe(1);
    respond = () => ({ saved: 1, skipped: 0 });
    await flushGps();
    expect(calls).toHaveLength(2);
    expect(calls[0].idempotencyKey).toBe(calls[1].idempotencyKey);
    expect(await gpsBacklog()).toBe(0);
  });

  it("a new reading waits behind older ones so the history stays in order", async () => {
    setOnline(false);
    await recordReading(fix(1));
    setOnline(true);
    respond = () => {
      throw noSignal();
    };
    await recordReading(fix(2));
    expect(await gpsBacklog()).toBe(2);
  });

  it("readings the server refuses are dropped, not retried forever", async () => {
    setOnline(false);
    await recordReading(fix(1));
    setOnline(true);
    respond = () => {
      throw new ApiError("Validation failed.", 400);
    };
    await flushGps();
    expect(await gpsBacklog()).toBe(0);
  });

  it("the outbox sends GPS readings after the queued changes", async () => {
    setOnline(false);
    await write({ method: "POST", path: "/a", label: "A" });
    await recordReading(fix(1));
    setOnline(true);
    await flushOutbox();
    expect(calls.map((c) => c.path)).toEqual(["/a", "/field/location/batch"]);
  });

  // ---- Offline Phase 5: refused changes ----

  it("keeps the server's reason code and what the change holds, and never deletes a refused note or photo", async () => {
    setOnline(false);
    const photoId = newLocalId();
    await write({ method: "POST", path: "/field/jobs/wo1/notes", body: { text: "Arrived, gate locked" }, label: "Note on WO-1" });
    await write({
      method: "POST",
      path: "/field/jobs/wo1/attachments",
      label: "Photo for WO-1",
      localId: photoId,
      file: { blob: new Blob(["x"], { type: "image/jpeg" }), name: "gate.jpg", fields: { phase: "BEFORE" } },
    });
    setOnline(true);
    respond = () => {
      throw new ApiError("WO-1 was cancelled by the office.", 409, {}, "JOB_CANCELLED");
    };
    await flushOutbox();
    const items = await listOutbox();
    expect(items.map((i) => [i.status, i.errorCode])).toEqual([
      ["failed", "JOB_CANCELLED"],
      ["failed", "JOB_CANCELLED"],
    ]);
    expect(items[0].detail).toEqual({ kind: "note", text: "Arrived, gate locked" });
    expect(items[1].detail).toEqual({ kind: "file", text: "gate.jpg" });
    expect(files.has(photoId)).toBe(true); // the photo stays on the phone until the technician deletes the change
    expect(outboxStatus.get()).toMatchObject({ pending: 0, failed: 2 });
  });

  it("retries one refused change and leaves the others", async () => {
    setOnline(false);
    await write({ method: "POST", path: "/a", label: "A" });
    await write({ method: "POST", path: "/b", label: "B" });
    setOnline(true);
    respond = () => {
      throw new ApiError("no", 409, {}, "JOB_STATUS_CHANGED");
    };
    await flushOutbox();
    const [a] = await listOutbox();
    calls.length = 0;
    respond = () => null;
    await retryFailed(a.seq);
    expect(calls.map((c) => c.path)).toEqual(["/a"]);
    const left = await listOutbox();
    expect(left.map((i) => [i.label, i.status])).toEqual([["B", "failed"]]);
  });

  it("a refused change does not hide or lose the changes behind it", async () => {
    setOnline(false);
    await write({ method: "POST", path: "/field/jobs/wo1/transition", body: { action: "start" }, label: "Start" });
    await write({ method: "POST", path: "/field/jobs/wo2/notes", body: { text: "other job" }, label: "Note on WO-2" });
    setOnline(true);
    respond = (c) => {
      if (c.path.includes("wo1")) throw new ApiError("cancelled", 409, {}, "JOB_CANCELLED");
      return null;
    };
    const r = await flushOutbox();
    expect(r.sent).toBe(1);
    expect((await listOutbox()).map((i) => i.label)).toEqual(["Start"]);
  });
});

describe("Offline Phase 5 — explaining a refusal", () => {
  it("every reason the server can give has a plain explanation", async () => {
    const { explain } = await import("../../mobile/src/local/rejections");
    for (const code of [
      "JOB_CANCELLED", "JOB_REASSIGNED", "JOB_DELETED", "JOB_UNSCHEDULED", "JOB_ALREADY_COMPLETED", "JOB_STATUS_CHANGED",
      "INSTALLATION_NOT_FOUND", "INSTALLATION_ALREADY_COMPLETED", "DEPENDS_ON_FAILED", "FILE_MISSING", "VALIDATION_ERROR",
    ]) {
      const e = explain(code, "server sentence");
      expect(e.title.length).toBeGreaterThan(10);
      expect(e.title).not.toBe("server sentence");
    }
    expect(explain("JOB_CANCELLED", null).canRetry).toBe(false);
    expect(explain("JOB_REASSIGNED", null).title).toMatch(/another technician/);
  });

  it("an unknown reason shows the server's own sentence and allows a retry", async () => {
    const { explain } = await import("../../mobile/src/local/rejections");
    expect(explain("SOMETHING_NEW", "Please call the office.")).toMatchObject({ title: "Please call the office.", canRetry: true });
    expect(explain(null, null).title).toMatch(/did not accept/);
  });
});

describe.skipIf(!sqliteModule)("Offline Phase 6 — field conditions", () => {
  beforeEach(async () => {
    holder.db = memoryDb();
    await migrate(holder.db);
    calls.length = 0;
    files.clear();
    failSave = false;
    respond = () => null;
    setOnline(true);
    await refreshOutboxStatus();
  });

  it("a change made with a signal waits only a few seconds for the server, an upload waits long", async () => {
    await write({ method: "POST", path: "/field/jobs/wo1/notes", body: { text: "x" }, label: "Note" });
    expect(calls[0].timeoutMs).toBe(DIRECT_TIMEOUT_MS);
    expect(DIRECT_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    await write({
      method: "POST",
      path: "/field/jobs/wo1/attachments",
      label: "Photo",
      localId: newLocalId(),
      file: { blob: new Blob(["x"], { type: "image/jpeg" }), name: "a.jpg", fields: {} },
    });
    expect(calls[1].timeoutMs).toBeUndefined();
  });

  it("a weak signal (timeout) queues the change instead of losing it, and it is sent once the signal is good", async () => {
    let attempts = 0;
    respond = () => {
      if (++attempts <= 2) throw new ApiError("The server took too long to answer.", 0);
      return null;
    };
    const res = await write({ method: "PUT", path: "/field/jobs/wo1/checklist/c1", body: { isDone: true }, label: "Checklist" });
    expect(res.queued).toBe(true);
    expect((await listOutbox()).length).toBe(1);
    await flushOutbox();
    expect(await listOutbox()).toHaveLength(0);
    expect(new Set(calls.map((c) => c.idempotencyKey)).size).toBe(1); // one key for every attempt
  });

  it("a photo that cannot be stored (phone out of space) queues nothing and says why", async () => {
    failSave = true;
    setOnline(false);
    await expect(
      write({
        method: "POST",
        path: "/field/jobs/wo1/attachments",
        label: "Photo",
        localId: newLocalId(),
        file: { blob: new Blob(["x"], { type: "image/jpeg" }), name: "a.jpg", fields: {} },
      }),
    ).rejects.toThrow(/almost out of storage/);
    expect(await listOutbox()).toHaveLength(0);
  });

  it("removes stored files no queued change needs, and keeps the ones it does", async () => {
    setOnline(false);
    const keep = newLocalId();
    await write({
      method: "POST",
      path: "/field/jobs/wo1/attachments",
      label: "Photo",
      localId: keep,
      file: { blob: new Blob(["x"], { type: "image/jpeg" }), name: "a.jpg", fields: {} },
    });
    files.set("local-orphan-left-by-a-crash", new Blob(["y"]));
    expect(await sweepOrphanFiles()).toBe(1);
    expect([...files.keys()]).toEqual([keep]);
  });

  it("a full day offline ends with an empty queue and everything sent once, in order", async () => {
    setOnline(false);
    const order: string[] = [];
    // A technician's day: start a job, tick the checklist, a note, two photos, complete it, a held installation, GPS.
    await write({ method: "POST", path: "/field/jobs/wo1/transition", body: { action: "start" }, label: "Start" });
    await write({ method: "PUT", path: "/field/jobs/wo1/checklist/c1", body: { isDone: true }, label: "Tick" });
    await write({ method: "POST", path: "/field/jobs/wo1/notes", body: { text: "n" }, label: "Note" });
    for (const slot of ["FRONT", "CABIN_1"]) {
      await write({
        method: "POST",
        path: "/field/jobs/wo1/attachments",
        label: `Photo ${slot}`,
        localId: newLocalId(),
        file: { blob: new Blob([slot], { type: "image/jpeg" }), name: `${slot}.jpg`, fields: { phase: "AFTER", slot } },
      });
    }
    await write({ method: "POST", path: "/field/jobs/wo1/transition", body: { action: "complete" }, label: "Complete" });
    const inst = newLocalId();
    await write({ method: "POST", path: "/field/installations/hold", body: {}, label: "Held", localId: inst });
    await recordReading({ latitude: 24.1, longitude: 67.1 });
    await recordReading({ latitude: 24.2, longitude: 67.2 });
    expect(outboxStatus.get().pending).toBe(7);
    expect(calls).toHaveLength(0);

    setOnline(true);
    respond = (c) => {
      order.push(c.path);
      return c.path === "/field/installations/hold" ? { id: "inst-1" } : { id: "x" };
    };
    const r = await flushOutbox();
    expect(r).toEqual({ sent: 7, stopped: false });
    expect(order).toEqual([
      "/field/jobs/wo1/transition",
      "/field/jobs/wo1/checklist/c1",
      "/field/jobs/wo1/notes",
      "/field/jobs/wo1/attachments",
      "/field/jobs/wo1/attachments",
      "/field/jobs/wo1/transition",
      "/field/installations/hold",
      "/field/location/batch",
    ]);
    expect(await listOutbox()).toHaveLength(0);
    expect(files.size).toBe(0);
    expect(await gpsBacklog()).toBe(0);
    expect(outboxStatus.get()).toMatchObject({ pending: 0, failed: 0 });
  });

  it("signal lost in the middle of the queue: what was sent stays sent, the rest waits and finishes later with no duplicates", async () => {
    setOnline(false);
    for (const p of ["/1", "/2", "/3", "/4"]) await write({ method: "POST", path: p, label: p });
    setOnline(true);
    let seen = 0;
    respond = () => {
      if (++seen === 3) throw new ApiError("Could not reach the server.", 0);
      return null;
    };
    const first = await flushOutbox();
    expect(first).toEqual({ sent: 2, stopped: true });
    const keysBefore = calls.map((c) => c.idempotencyKey);
    respond = () => null;
    const second = await flushOutbox();
    expect(second).toEqual({ sent: 2, stopped: false });
    // "/3" was tried twice with the same key, so the server applies it once.
    const k3 = calls.filter((c) => c.path === "/3").map((c) => c.idempotencyKey);
    expect(k3).toHaveLength(2);
    expect(k3[0]).toBe(k3[1]);
    expect(keysBefore.length).toBe(3);
    expect(await listOutbox()).toHaveLength(0);
  });
});

describe("Offline Phase 6 — reading with a weak signal", () => {
  it("shows the saved copy after a few seconds when the server is slow, instead of waiting for the timeout", async () => {
    const { readThrough } = await import("../../mobile/src/local/readThrough");
    let saved = 0;
    const slowServer = () => new Promise<string>((resolve) => setTimeout(() => resolve("fresh"), 200));
    const t0 = Date.now();
    const value = await readThrough(slowServer, async () => void saved++, async () => "saved copy", 20);
    expect(value).toBe("saved copy");
    expect(Date.now() - t0).toBeLessThan(150);
    // The server did answer in the end: its answer is saved for next time.
    await new Promise((r) => setTimeout(r, 300));
    expect(saved).toBe(1);
  });

  it("with no saved copy it keeps waiting for the server", async () => {
    const { readThrough } = await import("../../mobile/src/local/readThrough");
    const slowServer = () => new Promise<string>((resolve) => setTimeout(() => resolve("fresh"), 60));
    expect(await readThrough(slowServer, async () => undefined, async () => null, 10)).toBe("fresh");
  });

  it("an answer from the server is never replaced by old data, even a slow refusal", async () => {
    const { readThrough } = await import("../../mobile/src/local/readThrough");
    const refusal = () =>
      new Promise<string>((_, reject) => setTimeout(() => reject(new ApiError("Not found", 404)), 40));
    await expect(readThrough(refusal, async () => undefined, async () => "saved", 200)).rejects.toThrow("Not found");
  });

  it("a network error shows the saved copy at once", async () => {
    const { readThrough } = await import("../../mobile/src/local/readThrough");
    const down = async () => {
      throw new ApiError("Could not reach the server.", 0);
    };
    expect(await readThrough(down, async () => undefined, async () => "saved", 5_000)).toBe("saved");
  });
});

describe("Offline Phase 6 — knowing when the server is reachable", () => {
  it("goes offline on a failed call, and back online (running the sync callbacks) on the next answer", async () => {
    const { connection, reportOutcome } = await import("../../mobile/src/local/connection");
    let back = 0;
    const stop = connection.onBack(() => back++);
    let changes = 0;
    const unsub = connection.subscribe(() => changes++);
    reportOutcome(true);
    expect(connection.get()).toBe(true);
    reportOutcome(false);
    expect(connection.get()).toBe(false);
    reportOutcome(false); // still offline: nothing new
    reportOutcome(true);
    expect(connection.get()).toBe(true);
    expect(back).toBe(1);
    expect(changes).toBe(2);
    stop();
    unsub();
  });
});
