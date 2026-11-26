import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../mobile/src/local/migrations";
import type { Db } from "../../mobile/src/local/types";

// The cache talks to the phone database through getDb(); here it is a real SQLite database in memory (the same SQL
// engine as on the phone), so the tables and queries are checked for real.
// node:sqlite is built into Node 22.5 and newer (the Docker image uses Node 22); Vite cannot import it by name.
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
vi.mock("../../mobile/src/local/db", () => ({ getDb: async () => holder.db }));

import { addDays, customersCache, installationsCache, jobsCache, jobsInWindow, syncCache } from "../../mobile/src/local/cache";

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

const job = (n: number, day = "2026-11-26") => ({
  workOrderId: `wo${n}`,
  number: `WO-${n}`,
  title: `Job ${n}`,
  status: "SCHEDULED",
  visitStatus: "SCHEDULED",
  priority: "MEDIUM",
  customerName: "Acme",
  customerPhone: null,
  siteLabel: null,
  assetName: null,
  day,
  startTime: "09:00",
  endTime: "10:00",
});

const inst = (n: number, status: "COMPLETED" | "ON_HOLD", customerName = "Acme") =>
  ({
    id: `i${n}`,
    vehicleNo: `ABC-${n}`,
    deviceId: `DEV${n}`,
    customerName,
    deviceType: "GPS",
    location: "Lahore",
    installDate: "2026-11-20",
    createdBy: "Tech",
    createdAt: `2026-11-2${n}T10:00:00.000Z`,
    status,
    holdReason: "",
    holdBy: "",
    fileCount: 0,
    thumbs: [],
  }) as never;

beforeEach(async () => {
  holder.db = memoryDb();
  await migrate(holder.db);
});

describe.skipIf(!sqliteModule)("phone database migrations", () => {
  it("creates the tables once and records the version", async () => {
    const db = holder.db!;
    await migrate(db); // a second run must change nothing
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
    for (const t of ["meta", "jobs", "job_details", "installations", "installation_details", "customers"]) {
      expect(tables).toContain(t);
    }
    expect((await db.all<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value).toBe("1");
  });
});

describe.skipIf(!sqliteModule)("jobs cache", () => {
  it("returns nothing before the first save", async () => {
    expect(await jobsCache.load()).toBeNull();
  });

  it("saves the list in the server's order and replaces the old one", async () => {
    await jobsCache.save({ today: "2026-11-26", timeZone: "Asia/Karachi", jobs: [job(2), job(1)] });
    expect((await jobsCache.load())!.jobs.map((j) => j.number)).toEqual(["WO-2", "WO-1"]);
    await jobsCache.save({ today: "2026-11-27", timeZone: "Asia/Karachi", jobs: [job(3)] });
    const again = (await jobsCache.load())!;
    expect(again.today).toBe("2026-11-27");
    expect(again.jobs.map((j) => j.number)).toEqual(["WO-3"]);
  });

  it("keeps a job's detail", async () => {
    const d = { id: "wo1", number: "WO-1", title: "T", checklist: [{ id: "c1", text: "x", isDone: true }] } as never;
    await jobsCache.saveDetail(d);
    expect(((await jobsCache.loadDetail("wo1")) as { checklist: unknown[] }).checklist).toHaveLength(1);
    expect(await jobsCache.loadDetail("nope")).toBeNull();
  });
});

describe.skipIf(!sqliteModule)("installations cache", () => {
  it("returns null when nothing was ever saved", async () => {
    expect(await installationsCache.loadList({ status: "COMPLETED" })).toBeNull();
  });

  it("filters by status, searches, sorts newest first and pages", async () => {
    await installationsCache.saveList([inst(1, "COMPLETED"), inst(2, "COMPLETED", "Globex"), inst(3, "ON_HOLD")]);

    const done = (await installationsCache.loadList({ status: "COMPLETED", page: 1, pageSize: 10 }))!;
    expect(done.totalCount).toBe(2);
    expect(done.items.map((i) => i.id)).toEqual(["i2", "i1"]);

    expect((await installationsCache.loadList({ status: "ON_HOLD" }))!.items.map((i) => i.id)).toEqual(["i3"]);
    expect((await installationsCache.loadList({ search: "globex" }))!.items.map((i) => i.id)).toEqual(["i2"]);
    expect((await installationsCache.loadList({ search: "dev1" }))!.items.map((i) => i.id)).toEqual(["i1"]);

    const page2 = (await installationsCache.loadList({ status: "COMPLETED", page: 2, pageSize: 1 }))!;
    expect(page2.items.map((i) => i.id)).toEqual(["i1"]);
    expect(page2.totalCount).toBe(2);
  });

  it("an empty match is an empty list, not 'nothing saved'", async () => {
    await installationsCache.saveList([inst(1, "COMPLETED")]);
    const none = (await installationsCache.loadList({ status: "ON_HOLD" }))!;
    expect(none.items).toEqual([]);
    expect(none.totalCount).toBe(0);
  });

  it("updates a row when the same id is saved again, and forgets a removed record", async () => {
    await installationsCache.saveList([inst(1, "ON_HOLD")]);
    await installationsCache.saveList([inst(1, "COMPLETED")]);
    expect((await installationsCache.loadList({ status: "ON_HOLD" }))!.items).toEqual([]);
    expect((await installationsCache.loadList({ status: "COMPLETED" }))!.items).toHaveLength(1);

    await installationsCache.saveDetail({ id: "i1", simNo: "123" } as never);
    await installationsCache.remove("i1");
    expect(await installationsCache.loadDetail("i1")).toBeNull();
    expect((await installationsCache.loadList({}))!.totalCount).toBe(0);
  });
});

describe.skipIf(!sqliteModule)("customers cache", () => {
  it("saves the companies with their sites, sorted by name", async () => {
    expect(await customersCache.load()).toBeNull();
    await customersCache.save([
      { id: "c2", name: "Zeta", sites: [] },
      { id: "c1", name: "Acme", sites: [{ id: "s1", label: "Head office", lat: 31.5, lng: 74.3 }] },
    ]);
    const list = (await customersCache.load())!;
    expect(list.map((c) => c.name)).toEqual(["Acme", "Zeta"]);
    expect(list[0].sites[0].label).toBe("Head office");
  });
});

describe.skipIf(!sqliteModule)("without a phone database (browser preview)", () => {
  it("writes do nothing and reads return null", async () => {
    holder.db = null;
    await jobsCache.save({ today: "x", timeZone: "y", jobs: [job(1)] });
    expect(await jobsCache.load()).toBeNull();
    expect(await installationsCache.loadList({})).toBeNull();
    expect(await customersCache.load()).toBeNull();
  });
});

describe.skipIf(!sqliteModule)("sync: the 7-day window", () => {
  const list = (jobs: ReturnType<typeof job>[]) => ({ today: '2026-11-26', timeZone: 'Asia/Karachi', jobs });

  it('adds days to a calendar date', () => {
    expect(addDays('2026-11-26', 7)).toBe('2026-12-03');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('keeps visits up to 7 days ahead and anything in progress or on hold, whatever the date', () => {
    const jobs = [
      job(1, '2026-11-20'), // history
      job(2, '2026-12-03'), // last day of the window
      job(3, '2026-12-04'), // one day too far
      { ...job(4, '2027-02-01'), status: 'IN_PROGRESS' },
      { ...job(5, '2027-02-01'), status: 'ON_HOLD' },
    ];
    expect(jobsInWindow(list(jobs)).map((j) => j.number)).toEqual(['WO-1', 'WO-2', 'WO-4', 'WO-5']);
    expect(jobsInWindow(list(jobs), 2).map((j) => j.number)).toEqual(['WO-1', 'WO-4', 'WO-5']);
  });

  it('the list saved after an online read only keeps the window', async () => {
    await jobsCache.save(list([job(1), job(2, '2027-03-01')]));
    expect((await jobsCache.load())!.jobs.map((j) => j.number)).toEqual(['WO-1']);
  });
});

describe.skipIf(!sqliteModule)('sync: applying the server answer', () => {
  const detail = (n: number) => ({ id: `wo${n}`, number: `WO-${n}`, title: `Job ${n}`, checklist: [] }) as never;
  const answer = (over: Record<string, unknown> = {}) =>
    ({
      serverTime: '2026-11-26T10:00:00.000Z',
      full: true,
      windowDays: 7,
      jobs: { today: '2026-11-26', timeZone: 'Asia/Karachi', jobs: [job(1), job(2)] },
      jobDetails: [detail(1), detail(2)],
      installations: [inst(1, 'COMPLETED'), inst(3, 'ON_HOLD')],
      installationDetails: [{ id: 'i1', simNo: '1' }, { id: 'i3', simNo: '3' }],
      customers: [{ id: 'c1', name: 'Acme', sites: [] }],
      ...over,
    }) as never;

  it('a full copy fills every table and records the state', async () => {
    const state = await syncCache.apply(answer(), 1000);
    expect(state).toMatchObject({ serverTime: '2026-11-26T10:00:00.000Z', lastSyncedAt: 1000, lastFullAt: 1000, windowDays: 7 });
    expect((await syncCache.state())!.serverTime).toBe('2026-11-26T10:00:00.000Z');
    expect((await jobsCache.load())!.jobs).toHaveLength(2);
    expect(await jobsCache.loadDetail('wo2')).not.toBeNull();
    expect((await installationsCache.loadList({ status: 'ON_HOLD' }))!.items.map((i) => i.id)).toEqual(['i3']);
    expect(await installationsCache.loadDetail('i1')).not.toBeNull();
    expect((await customersCache.load())!.map((c) => c.name)).toEqual(['Acme']);
  });

  it('an incremental answer keeps the details that were not sent again, and updates the ones that were', async () => {
    await syncCache.apply(answer(), 1000);
    const changed = { ...(detail(1) as object), title: 'Renamed' } as never;
    const state = await syncCache.apply(
      answer({ full: false, serverTime: '2026-11-26T10:05:00.000Z', jobDetails: [changed], installationDetails: [], customers: null }),
      2000,
    );
    expect(state).toMatchObject({ lastSyncedAt: 2000, lastFullAt: 1000 }); // not a full copy: the old date stays
    expect(((await jobsCache.loadDetail('wo1')) as { title: string }).title).toBe('Renamed');
    expect(await jobsCache.loadDetail('wo2')).not.toBeNull(); // unchanged, kept
    expect(await installationsCache.loadDetail('i3')).not.toBeNull();
    expect((await customersCache.load())!).toHaveLength(1); // customers: null means unchanged
  });

  it('a job that left the list loses its detail, and an installation that was deleted disappears', async () => {
    await syncCache.apply(answer(), 1000);
    await syncCache.apply(
      answer({
        full: false,
        jobs: { today: '2026-11-26', timeZone: 'Asia/Karachi', jobs: [job(2)] },
        jobDetails: [],
        installations: [inst(3, 'ON_HOLD')],
        installationDetails: [],
        customers: null,
      }),
      2000,
    );
    expect((await jobsCache.load())!.jobs.map((j) => j.number)).toEqual(['WO-2']);
    expect(await jobsCache.loadDetail('wo1')).toBeNull();
    expect(await jobsCache.loadDetail('wo2')).not.toBeNull();
    expect((await installationsCache.loadList({}))!.items.map((i) => i.id)).toEqual(['i3']);
    expect(await installationsCache.loadDetail('i1')).toBeNull();
  });

  it('replaces the companies when new ones are sent', async () => {
    await syncCache.apply(answer(), 1000);
    await syncCache.apply(answer({ full: false, customers: [{ id: 'c2', name: 'Zeta', sites: [] }] }), 2000);
    expect((await customersCache.load())!.map((c) => c.name)).toEqual(['Zeta']);
  });

  it('is all or nothing: a failing statement leaves the old data as it was', async () => {
    await syncCache.apply(answer(), 1000);
    // A job with no status breaks the NOT NULL rule of the table half-way through the transaction.
    const bad = answer({ jobs: { today: '2026-11-26', timeZone: 'x', jobs: [job(9), { ...job(8), status: null }] } });
    await expect(syncCache.apply(bad, 2000)).rejects.toThrow();
    expect((await jobsCache.load())!.jobs.map((j) => j.number)).toEqual(['WO-1', 'WO-2']);
    expect((await syncCache.state())!.lastSyncedAt).toBe(1000);
  });

  it('does nothing without a phone database', async () => {
    holder.db = null;
    expect(await syncCache.apply(answer())).toBeNull();
    expect(await syncCache.state()).toBeNull();
  });
});
