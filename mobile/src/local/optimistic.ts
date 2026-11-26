import type {
  HoldInstallationInput,
  InstallationDetail,
  InstallationInput,
  InstallationListItem,
} from "@/modules/installations/installations.schema";
import type { FieldAction, FieldJob, FieldJobDetail } from "../api/jobTypes";
import { customersCache, installationsCache, jobsCache } from "./cache";
import { getDb } from "./db";

/**
 * What the phone shows for a change that is waiting in the outbox: the saved copy of the job or record is changed
 * the way the server will change it, so the technician sees the result at once, without a signal. The next sync
 * replaces these copies with the server's own, once the changes have been sent.
 */

/** The status a job gets from each action (the server's own rules, see `field.service.ts`). */
const STATUS_AFTER: Record<FieldAction, string> = {
  "on-my-way": "DISPATCHED",
  start: "IN_PROGRESS",
  resume: "IN_PROGRESS",
  hold: "ON_HOLD",
  complete: "COMPLETED",
};

/** The buttons a job shows in each status. */
const ACTIONS_FOR: Record<string, FieldAction[]> = {
  SCHEDULED: ["on-my-way", "start"],
  DISPATCHED: ["start"],
  IN_PROGRESS: ["complete", "hold"],
  ON_HOLD: ["resume"],
};

export const statusAfter = (action: FieldAction) => STATUS_AFTER[action];

async function patchJobRows(workOrderId: string, patch: (j: FieldJob) => FieldJob) {
  const db = await getDb();
  if (!db) return;
  const rows = await db.all<{ id: string; data: string }>("SELECT id, data FROM jobs WHERE work_order_id = ?", [workOrderId]);
  for (const r of rows) {
    const next = patch(JSON.parse(r.data) as FieldJob);
    await db.batch([
      { sql: "UPDATE jobs SET status = ?, data = ? WHERE id = ?", params: [next.status, JSON.stringify(next), r.id] },
    ]);
  }
}

async function patchJob(id: string, patch: (j: FieldJobDetail) => FieldJobDetail) {
  const job = await jobsCache.loadDetail(id);
  if (job) await jobsCache.saveDetail(patch(job));
}

export const optimistic = {
  /** A status change of a job (on my way, start, hold, resume, complete). */
  transition: async (id: string, action: FieldAction, at = new Date()) => {
    const status = STATUS_AFTER[action];
    await patchJob(id, (j) => ({
      ...j,
      status,
      actions: ACTIONS_FOR[status] ?? [],
      closed: status === "COMPLETED",
      checkedInAt: action === "start" || action === "resume" ? (j.checkedInAt ?? at.toISOString()) : j.checkedInAt,
    }));
    await patchJobRows(id, (j) => ({ ...j, status }));
  },

  checklist: (id: string, itemId: string, isDone: boolean) =>
    patchJob(id, (j) => ({ ...j, checklist: j.checklist.map((c) => (c.id === itemId ? { ...c, isDone } : c)) })),

  note: (id: string, localId: string, text: string, at = new Date()) =>
    patchJob(id, (j) => ({
      ...j,
      notes: [...j.notes, { id: localId, text, author: null, createdAt: at.toISOString(), mine: true }],
    })),

  /** A new installation (completed or held) that exists only on the phone until the server has saved it. */
  installationSaved: async (
    localId: string,
    input: InstallationInput | HoldInstallationInput,
    status: "COMPLETED" | "ON_HOLD",
    who: string | null,
    at = new Date(),
  ) => {
    const customers = (await customersCache.load()) ?? [];
    const customerName = customers.find((c) => c.id === input.customerId)?.name ?? "";
    const existing = await installationsCache.loadDetail(localId);
    const detail: InstallationDetail = {
      id: localId,
      vehicleNo: input.vehicleNo.trim().toUpperCase(),
      deviceId: input.deviceId.trim(),
      customerName,
      deviceType: input.deviceType,
      location: input.location,
      installDate: input.installDate,
      createdBy: existing?.createdBy ?? who,
      createdAt: existing?.createdAt ?? at.toISOString(),
      status,
      holdReason: status === "ON_HOLD" && "holdReason" in input ? input.holdReason : "",
      holdBy: "",
      customerId: input.customerId || null,
      simNo: input.simNo || null,
      fill: input.fill ? { lat: input.fill.lat, lng: input.fill.lng, accuracy: input.fill.accuracy, at: at.toISOString() } : null,
      fillHistory: existing?.fillHistory ?? [],
      holdAt: null,
      latitude: input.latitude ? Number(input.latitude) : null,
      longitude: input.longitude ? Number(input.longitude) : null,
      hasTempSensor: input.hasTempSensor,
      checklist: input.checklist,
      notes: input.notes || null,
      files: existing?.files ?? [],
      photos: existing?.photos ?? [],
    };
    const item: InstallationListItem = {
      id: localId,
      vehicleNo: detail.vehicleNo,
      deviceId: detail.deviceId,
      customerName,
      deviceType: detail.deviceType,
      location: detail.location,
      installDate: detail.installDate,
      createdBy: detail.createdBy,
      createdAt: detail.createdAt,
      status,
      holdReason: detail.holdReason,
      holdBy: "",
      fileCount: detail.files.length + detail.photos.length,
      thumbs: [],
    };
    await installationsCache.saveDetail(detail);
    await installationsCache.saveList([item]);
  },
};
