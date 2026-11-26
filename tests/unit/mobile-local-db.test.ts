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

import { customersCache, installationsCache, jobsCache } from "../../mobile/src/local/cache";

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
