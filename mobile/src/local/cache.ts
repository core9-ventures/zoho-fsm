import type { PagedResult } from "@/lib/pagination";
import type {
  CustomerChoice,
  InstallationDetail,
  InstallationListItem,
} from "@/modules/installations/installations.schema";
import type { FieldJob, FieldJobDetail, FieldJobList } from "../api/jobTypes";
import { getDb } from "./db";

/**
 * What the technician's screens read, kept in the phone database. The API layer saves every answer it gets from the
 * server here, and reads from here when the server cannot be reached. Every function is safe to call when there is no
 * phone database (browser preview): writes do nothing and reads return null.
 *
 * Nothing here talks to the server, and nothing here throws: a problem with the local database must never break a
 * screen that the server could have served.
 */

const now = () => Date.now();
const parse = <T>(text: string) => JSON.parse(text) as T;

async function safe<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (e) {
    console.error("Phone database error", e);
    return fallback;
  }
}

// ---- Jobs (My jobs) ----

const jobKey = (j: FieldJob) => `${j.workOrderId}|${j.day}|${j.startTime}`;

export const jobsCache = {
  /** The server's list replaces what was saved: it always sends the complete current list. */
  save: (list: FieldJobList) =>
    safe(async () => {
      const db = await getDb();
      if (!db) return;
      const at = now();
      await db.batch([
        { sql: "DELETE FROM jobs" },
        ...list.jobs.map((j, i) => ({
          sql: "INSERT OR REPLACE INTO jobs (id, work_order_id, day, status, position, data, saved_at, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
          params: [jobKey(j), j.workOrderId, j.day, j.status, i, JSON.stringify(j), at],
        })),
        {
          sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('jobs_list', ?)",
          params: [JSON.stringify({ today: list.today, timeZone: list.timeZone, savedAt: at })],
        },
      ]);
    }, undefined),

  load: (): Promise<FieldJobList | null> =>
    safe(async () => {
      const db = await getDb();
      if (!db) return null;
      const meta = (await db.all<{ value: string }>("SELECT value FROM meta WHERE key = 'jobs_list'"))[0];
      if (!meta) return null;
      const { today, timeZone } = parse<{ today: string; timeZone: string }>(meta.value);
      const rows = await db.all<{ data: string }>("SELECT data FROM jobs WHERE deleted = 0 ORDER BY position");
      return { today, timeZone, jobs: rows.map((r) => parse<FieldJob>(r.data)) };
    }, null),

  saveDetail: (job: FieldJobDetail) =>
    safe(async () => {
      const db = await getDb();
      await db?.batch([
        {
          sql: "INSERT OR REPLACE INTO job_details (id, data, saved_at, deleted) VALUES (?, ?, ?, 0)",
          params: [job.id, JSON.stringify(job), now()],
        },
      ]);
    }, undefined),

  loadDetail: (id: string): Promise<FieldJobDetail | null> =>
    safe(async () => {
      const db = await getDb();
      if (!db) return null;
      const row = (await db.all<{ data: string }>("SELECT data FROM job_details WHERE id = ? AND deleted = 0", [id]))[0];
      return row ? parse<FieldJobDetail>(row.data) : null;
    }, null),
};

// ---- Installations (My installations and the form) ----

const searchText = (i: InstallationListItem) =>
  [i.vehicleNo, i.deviceId, i.customerName, i.location].join(" ").toLowerCase();

export type InstallationFilter = { page?: number; pageSize?: number; search?: string; status?: string; customerId?: string };

export const installationsCache = {
  /** Adds or updates rows; it cannot delete, because a page of the server's list is not the whole list. */
  saveList: (items: InstallationListItem[]) =>
    safe(async () => {
      const db = await getDb();
      if (!db) return;
      const at = now();
      await db.batch([
        ...items.map((i) => ({
          sql: "INSERT OR REPLACE INTO installations (id, status, created_at, search_text, data, saved_at, deleted) VALUES (?, ?, ?, ?, ?, ?, 0)",
          params: [i.id, i.status, i.createdAt, searchText(i), JSON.stringify(i), at],
        })),
        // Remembers that the list was saved at least once, so an empty list is not mistaken for "never saved".
        { sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('installations_saved', ?)", params: [String(at)] },
      ]);
    }, undefined),

  /** The same filters as the server's list, answered from the saved rows. Null when nothing was saved. */
  loadList: (q: InstallationFilter): Promise<PagedResult<InstallationListItem> | null> =>
    safe(async () => {
      const db = await getDb();
      if (!db) return null;
      const saved = (await db.all("SELECT value FROM meta WHERE key = 'installations_saved'"))[0];
      if (!saved) return null;
      const page = Math.max(1, q.page ?? 1);
      const pageSize = Math.max(1, q.pageSize ?? 20);
      const where: string[] = ["deleted = 0"];
      const params: (string | number)[] = [];
      if (q.status) {
        where.push("status = ?");
        params.push(q.status);
      }
      const term = q.search?.trim().toLowerCase();
      if (term) {
        where.push("search_text LIKE ?");
        params.push(`%${term}%`);
      }
      const clause = where.join(" AND ");
      const total = (await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM installations WHERE ${clause}`, params))[0]?.n ?? 0;
      const rows = await db.all<{ data: string }>(
        `SELECT data FROM installations WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      );
      return { items: rows.map((r) => parse<InstallationListItem>(r.data)), totalCount: total, page, pageSize };
    }, null),

  saveDetail: (d: InstallationDetail) =>
    safe(async () => {
      const db = await getDb();
      await db?.batch([
        {
          sql: "INSERT OR REPLACE INTO installation_details (id, data, saved_at, deleted) VALUES (?, ?, ?, 0)",
          params: [d.id, JSON.stringify(d), now()],
        },
      ]);
    }, undefined),

  loadDetail: (id: string): Promise<InstallationDetail | null> =>
    safe(async () => {
      const db = await getDb();
      if (!db) return null;
      const row = (
        await db.all<{ data: string }>("SELECT data FROM installation_details WHERE id = ? AND deleted = 0", [id])
      )[0];
      return row ? parse<InstallationDetail>(row.data) : null;
    }, null),

  /** Forgets one record (after a held record was discarded on the server). */
  remove: (id: string) =>
    safe(async () => {
      const db = await getDb();
      await db?.batch([
        { sql: "DELETE FROM installations WHERE id = ?", params: [id] },
        { sql: "DELETE FROM installation_details WHERE id = ?", params: [id] },
      ]);
    }, undefined),
};

// ---- Companies and sites (the new-installation form) ----

export const customersCache = {
  save: (list: CustomerChoice[]) =>
    safe(async () => {
      const db = await getDb();
      if (!db) return;
      const at = now();
      await db.batch([
        { sql: "DELETE FROM customers" },
        ...list.map((c) => ({
          sql: "INSERT OR REPLACE INTO customers (id, name, data, saved_at, deleted) VALUES (?, ?, ?, ?, 0)",
          params: [c.id, c.name, JSON.stringify(c), at],
        })),
        { sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('customers_saved', ?)", params: [String(at)] },
      ]);
    }, undefined),

  load: (): Promise<CustomerChoice[] | null> =>
    safe(async () => {
      const db = await getDb();
      if (!db) return null;
      const saved = (await db.all("SELECT value FROM meta WHERE key = 'customers_saved'"))[0];
      if (!saved) return null;
      const rows = await db.all<{ data: string }>("SELECT data FROM customers WHERE deleted = 0 ORDER BY name");
      return rows.map((r) => parse<CustomerChoice>(r.data));
    }, null),
};
