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
    save: async (id: string, blob: Blob) => void files.set(id, blob),
    read: async (id: string) => files.get(id) ?? null,
    remove: async (id: string) => void files.delete(id),
  },
}));

type Call = { method: string; path: string; body?: unknown; idempotencyKey?: string; form?: FormData };
const calls: Call[] = [];
let respond: (c: Call) => unknown = () => null;
vi.mock("../../mobile/src/api/http", async (orig) => {
  const real = await orig<typeof import("../../mobile/src/api/http")>();
  return {
    ...real,
    request: async (method: string, path: string, opts: { body?: unknown; idempotencyKey?: string; form?: FormData } = {}) => {
      const c = { method, path, body: opts.body, idempotencyKey: opts.idempotencyKey, form: opts.form };
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
});
