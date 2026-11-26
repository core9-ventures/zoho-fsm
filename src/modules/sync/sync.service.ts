import "server-only";
import { SYNC_WINDOW_DAYS, type SyncResponse } from "./sync.schema";
import type { CurrentUser } from "@/lib/auth";
import type { AppDb } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { formatIn } from "@/lib/tz";
import { fieldService, type FieldJobDetail } from "@/modules/field";
import { installationsService, type InstallationDetail } from "@/modules/installations";

/** A job in one of these states stays on the phone even when its visit is outside the window. */
const ALWAYS_KEEP = new Set(["DISPATCHED", "IN_PROGRESS", "ON_HOLD"]);
/** Installations kept on the phone: every one on hold, plus the newest finished ones. */
const HELD_MAX = 100;
const DONE_MAX = 50;
/** The phone asks "since the last answer"; going back a little covers writes that were still in flight. */
const OVERLAP_MS = 5_000;

const unique = (ids: string[]) => [...new Set(ids)];

/** Ids of the work orders (out of `ids`) with anything changed after `since`: the order, its visit, lines, notes, ... */
async function changedJobIds(db: AppDb, actor: CurrentUser, ids: string[], since: Date): Promise<string[]> {
  if (ids.length === 0) return [];
  const gt = { gt: since };
  const [orders, visits, lines, notes, checklist, issues, forms, files] = await Promise.all([
    db.workOrder.findMany({ where: { id: { in: ids }, updatedAt: gt }, select: { id: true } }),
    db.appointment.findMany({
      where: { workOrderId: { in: ids }, technicianId: actor.id, updatedAt: gt },
      select: { workOrderId: true },
    }),
    db.workOrderLine.findMany({ where: { workOrderId: { in: ids }, updatedAt: gt }, select: { workOrderId: true } }),
    db.workOrderNote.findMany({ where: { workOrderId: { in: ids }, updatedAt: gt }, select: { workOrderId: true } }),
    db.workOrderChecklistItem.findMany({ where: { workOrderId: { in: ids }, updatedAt: gt }, select: { workOrderId: true } }),
    db.workOrderIssue.findMany({ where: { workOrderId: { in: ids }, updatedAt: gt }, select: { workOrderId: true } }),
    db.workOrderServiceForm.findMany({ where: { workOrderId: { in: ids }, updatedAt: gt }, select: { workOrderId: true } }),
    // A deleted photo is a row with deletedAt set: naming the column (even as undefined) keeps those rows in.
    db.attachment.findMany({
      where: { entityType: "WORK_ORDER", entityId: { in: ids }, updatedAt: gt, deletedAt: undefined },
      select: { entityId: true },
    }),
  ]);
  return unique([
    ...orders.map((r) => r.id),
    ...visits.map((r) => r.workOrderId),
    ...lines.map((r) => r.workOrderId),
    ...notes.map((r) => r.workOrderId),
    ...checklist.map((r) => r.workOrderId),
    ...issues.map((r) => r.workOrderId),
    ...forms.map((r) => r.workOrderId),
    ...files.map((r) => r.entityId),
  ]);
}

export const syncService = {
  /**
   * The technician's data for the phone: jobs of the next 7 days plus the ones in progress, with their details, the
   * technician's own installations and the companies to pick from.
   */
  async forTechnician(db: AppDb, actor: CurrentUser, since: Date | null): Promise<SyncResponse> {
    if (actor.role !== "TECHNICIAN") throw new ForbiddenError("Only technicians sync to the phone.");
    const serverTime = new Date();
    const from = since ? new Date(since.getTime() - OVERLAP_MS) : null;

    // ---- Jobs: the visits in the window, complete every time ----
    const list = await fieldService.myJobs(db, actor);
    const lastDay = formatIn(new Date(serverTime.getTime() + SYNC_WINDOW_DAYS * 24 * 3600_000), list.timeZone, "yyyy-MM-dd");
    const jobs = { ...list, jobs: list.jobs.filter((j) => j.day <= lastDay || ALWAYS_KEEP.has(j.status)) };
    const jobIds = unique(jobs.jobs.map((j) => j.workOrderId));
    const detailIds = from ? await changedJobIds(db, actor, jobIds, from) : jobIds;

    const jobDetails: FieldJobDetail[] = [];
    for (const id of detailIds) {
      try {
        jobDetails.push(await fieldService.job(db, actor, id));
      } catch (e) {
        // One broken job must not stop the rest from syncing.
        logger.warn({ jobId: id, err: e instanceof Error ? e.message : String(e) }, "sync.job_skipped");
      }
    }

    // ---- Installations: the technician's own, complete list for the window ----
    const [held, done] = await Promise.all([
      installationsService.list(db, actor, { page: 1, pageSize: HELD_MAX, status: "ON_HOLD" }),
      installationsService.list(db, actor, { page: 1, pageSize: DONE_MAX, status: "COMPLETED" }),
    ]);
    const installations = [...held.items, ...done.items];
    const instIds = installations.map((i) => i.id);
    const changedInst = from
      ? new Set(
          (
            await db.installation.findMany({
              where: { id: { in: instIds }, createdById: actor.id, updatedAt: { gt: from } },
              select: { id: true },
            })
          ).map((r) => r.id),
        )
      : new Set(instIds);
    const installationDetails: InstallationDetail[] = [];
    for (const id of instIds) {
      if (!changedInst.has(id)) continue;
      try {
        installationDetails.push(await installationsService.get(db, actor, id));
      } catch (e) {
        logger.warn({ installationId: id, err: e instanceof Error ? e.message : String(e) }, "sync.installation_skipped");
      }
    }

    // ---- Companies and sites: only when something changed (or a full copy) ----
    let customers = null;
    if (from) {
      const [c, a] = await Promise.all([
        db.customer.findFirst({ where: { updatedAt: { gt: from }, deletedAt: undefined }, select: { id: true } }),
        db.serviceAddress.findFirst({ where: { updatedAt: { gt: from }, deletedAt: undefined }, select: { id: true } }),
      ]);
      if (c || a) customers = await installationsService.customerOptions(db);
    } else {
      customers = await installationsService.customerOptions(db);
    }

    return {
      serverTime: serverTime.toISOString(),
      full: from === null,
      windowDays: SYNC_WINDOW_DAYS,
      jobs,
      jobDetails,
      installations,
      installationDetails,
      customers,
    };
  },
};
