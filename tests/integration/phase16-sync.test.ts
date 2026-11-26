/**
 * Offline Phase 2: what a technician's phone downloads (GET /api/v1/sync).
 * Runs against the seeded dev database (Demo company) and removes what it creates.
 */
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as syncRoute } from "@/app/api/v1/sync/route";
import type { CurrentUser } from "@/lib/auth";
import { createDb, prismaBase, tenantContext, type AppDb } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { authService } from "@/modules/auth";
import { fieldService } from "@/modules/field";
import { schedulingService } from "@/modules/scheduling";
import { SYNC_WINDOW_DAYS, syncService } from "@/modules/sync";
import { workOrdersService } from "@/modules/work-orders";

const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const stamp = Date.now().toString(36);
const password = process.env.SEED_PASSWORD ?? "";

const dayAhead = (n: number) => new Date(Date.now() + n * 24 * 3600_000).toISOString().slice(0, 10);

let dispatcher: CurrentUser;
let techA: CurrentUser;
let techB: CurrentUser;
let db: AppDb;
let dbA: AppDb;
let dbB: AppDb;
let customerId: string;
const woIds: string[] = [];

const asUser = (u: { id: string; role: string; companyId: string | null; fullName: string; email: string }) =>
  ({ id: u.id, role: u.role, companyId: u.companyId, fullName: u.fullName, email: u.email, via: "session" }) as CurrentUser;

async function makeJob(title: string, day: string) {
  const wo = await workOrdersService.create(db, dispatcher, {
    customerId,
    addressId: "",
    assetId: "",
    title: `${title} ${stamp}`,
    description: "",
    priority: "MEDIUM",
    dueDate: "",
    checklistTemplateId: "",
  });
  woIds.push(wo.id);
  await schedulingService.schedule(db, dispatcher, wo.id, { technicianId: techA.id, start: `${day}T09:00`, durationMin: 60 });
  return wo.id;
}

beforeAll(async () => {
  const d = await owner.user.findFirstOrThrow({ where: { email: "dispatcher@demo.local" } });
  dispatcher = asUser(d);
  db = createDb(tenantContext(d.companyId!, d.id));
  const a = await owner.user.findFirstOrThrow({ where: { email: "tech1@demo.local" } });
  const b = await owner.user.findFirstOrThrow({ where: { email: "tech2@demo.local" } });
  techA = asUser(a);
  techB = asUser(b);
  dbA = createDb(tenantContext(d.companyId!, a.id));
  dbB = createDb(tenantContext(d.companyId!, b.id));
  customerId = (await owner.customer.findFirstOrThrow({ where: { companyId: d.companyId!, deletedAt: null } })).id;
});

afterAll(async () => {
  const where = { workOrderId: { in: woIds } };
  await owner.auditLog.deleteMany({ where: { entityId: { in: woIds } } });
  await owner.timeSheet.deleteMany({ where: { appointment: where } });
  await owner.appointment.deleteMany({ where });
  await owner.workOrderStatusChange.deleteMany({ where });
  await owner.workOrderChecklistItem.deleteMany({ where });
  await owner.workOrderNote.deleteMany({ where });
  await owner.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await owner.$disconnect();
  await prismaBase.$disconnect();
});

describe("Offline Phase 2 — sync down", () => {
  let nearId: string;
  let farId: string;

  it("a full copy has the jobs of the next 7 days with their details, and leaves later jobs out", async () => {
    nearId = await makeJob("Sync near", dayAhead(2));
    farId = await makeJob("Sync far", dayAhead(SYNC_WINDOW_DAYS + 20));

    const full = await syncService.forTechnician(dbA, techA, null);
    expect(full.full).toBe(true);
    expect(full.windowDays).toBe(SYNC_WINDOW_DAYS);
    const ids = full.jobs.jobs.map((j) => j.workOrderId);
    expect(ids).toContain(nearId);
    expect(ids).not.toContain(farId);
    expect(full.jobDetails.map((d) => d.id)).toContain(nearId);
    expect(full.jobDetails.map((d) => d.id)).not.toContain(farId);
    expect(full.customers).not.toBeNull();
    expect(Number.isNaN(Date.parse(full.serverTime))).toBe(false);
  });

  it("a job in progress stays even when its visit is far away", async () => {
    await fieldService.transition(dbA, techA, farId, { action: "start" });
    const res = await syncService.forTechnician(dbA, techA, null);
    expect(res.jobs.jobs.map((j) => j.workOrderId)).toContain(farId);
    expect(res.jobDetails.map((d) => d.id)).toContain(farId);
  });

  it("asking since the last answer returns only what changed", async () => {
    // Let the earlier changes fall outside the 5 second safety overlap the server adds.
    await new Promise((r) => setTimeout(r, 6_000));
    const first = await syncService.forTechnician(dbA, techA, null);
    // Nothing happened since: the lists are complete but no details and no companies are sent again.
    await new Promise((r) => setTimeout(r, 6_000));
    const quiet = await syncService.forTechnician(dbA, techA, new Date(first.serverTime));
    expect(quiet.full).toBe(false);
    expect(quiet.jobs.jobs.map((j) => j.workOrderId)).toContain(nearId);
    expect(quiet.jobDetails).toEqual([]);
    expect(quiet.customers).toBeNull();

    // A note on one job: only that job's detail comes back, with the note in it.
    await fieldService.addNote(dbA, techA, nearId, "synced note");
    const changed = await syncService.forTechnician(dbA, techA, new Date(quiet.serverTime));
    expect(changed.jobDetails.map((d) => d.id)).toEqual([nearId]);
    expect(changed.jobDetails[0].notes.map((n) => n.text)).toContain("synced note");
  }, 30_000);

  it("a job taken away from the technician leaves the list", async () => {
    await schedulingService.schedule(db, dispatcher, nearId, {
      technicianId: techB.id,
      start: `${dayAhead(2)}T11:00`,
      durationMin: 60,
    });
    const a = await syncService.forTechnician(dbA, techA, null);
    expect(a.jobs.jobs.map((j) => j.workOrderId)).not.toContain(nearId);
    expect(a.jobDetails.map((d) => d.id)).not.toContain(nearId);
    const b = await syncService.forTechnician(dbB, techB, null);
    expect(b.jobs.jobs.map((j) => j.workOrderId)).toContain(nearId);
    expect(b.jobDetails.map((d) => d.id)).toContain(nearId);
  });

  it("only technicians can sync, and a bad since value is refused", async () => {
    await expect(syncService.forTechnician(db, dispatcher, null)).rejects.toBeInstanceOf(ForbiddenError);

    const tech = await authService.loginForTokens("tech1@demo.local", password, "127.0.0.1");
    const office = await authService.loginForTokens("dispatcher@demo.local", password, "127.0.0.1");
    const call = async (token: string, qs: string) =>
      syncRoute(new NextRequest(`http://localhost/api/v1/sync${qs}`, { headers: { authorization: `Bearer ${token}` } }), {
        params: Promise.resolve({}),
      });
    expect((await call(office.accessToken, "")).status).toBe(403);
    expect((await call(tech.accessToken, "?since=yesterday")).status).toBe(400);
    const ok = await call(tech.accessToken, "");
    expect(ok.status).toBe(200);
    const json = (await ok.json()) as { success: boolean; data: { full: boolean } };
    expect(json.success).toBe(true);
    expect(json.data.full).toBe(true);
  });
});
