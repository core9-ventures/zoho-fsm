/**
 * Phase 7 acceptance: "a monthly plan creates its next work order 7 days before the due date, exactly
 * once", plus the background jobs (overdue scan, invoice reminders, GPS clean-up). Runs against the
 * seeded dev database (Demo company) and removes what it creates.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/auth";
import { createDb, prismaBase, tenantContext, type AppDb } from "@/lib/db";
import { BadRequestError } from "@/lib/errors";
import { invoiceReminders, locationCleanup, overdueScan, type EmailJob } from "@/modules/automation";
import { checklistsService } from "@/modules/checklists";
import { maintenanceService, type MaintenancePlanInput } from "@/modules/maintenance";

const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const stamp = Date.now().toString(36);

let companyId: string;
let admin: CurrentUser;
let db: AppDb;
let acmeDb: AppDb;
let customerId: string;
let addressId: string;
let techId: string;
let staffCount: number;
const planIds: string[] = [];
const templateIds: string[] = [];
const invoiceIds: string[] = [];
const customerIds: string[] = [];
const locationIds: string[] = [];
const extraWoIds: string[] = [];

const asUser = (u: { id: string; role: string; companyId: string | null; fullName: string; email: string }) =>
  ({
    id: u.id,
    role: u.role,
    customRoleId: null,
    customRoleName: null,
    permissions: [],
    companyId: u.companyId,
    fullName: u.fullName,
    email: u.email,
    via: "session",
  }) as CurrentUser;

const plan = (patch: Partial<MaintenancePlanInput> = {}): MaintenancePlanInput => ({
  customerId,
  addressId: "",
  assetId: "",
  title: `P12 plan ${stamp}`,
  description: "Check cameras and wiring",
  frequency: "MONTHLY",
  intervalCount: 1,
  leadDays: 7,
  startDate: "2026-12-20",
  endDate: "",
  checklistTemplateId: "",
  priority: "MEDIUM",
  isActive: true,
  ...patch,
});

async function newPlan(patch: Partial<MaintenancePlanInput> = {}) {
  const p = await maintenanceService.create(db, admin, plan(patch));
  planIds.push(p.id);
  return p;
}

const workOrdersOf = (planId: string) =>
  owner.workOrder.findMany({ where: { maintenancePlanId: planId, deletedAt: null }, orderBy: { dueDate: "asc" } });

beforeAll(async () => {
  const a = await owner.user.findFirstOrThrow({ where: { email: "admin@demo.local" } });
  companyId = a.companyId!;
  admin = asUser(a);
  db = createDb(tenantContext(companyId, a.id));
  const x = await owner.user.findFirstOrThrow({ where: { email: "admin@acme.local" } });
  acmeDb = createDb(tenantContext(x.companyId!, x.id));
  const site = await owner.serviceAddress.findFirstOrThrow({
    where: { companyId, deletedAt: null, customer: { deletedAt: null } },
  });
  customerId = site.customerId;
  addressId = site.id;
  techId = (await owner.user.findFirstOrThrow({ where: { email: "tech1@demo.local" } })).id;
  staffCount = await owner.user.count({
    where: { companyId, role: { in: ["ADMIN", "DISPATCHER"] }, isActive: true, deletedAt: null },
  });
});

afterAll(async () => {
  const wos = await owner.workOrder.findMany({
    where: { OR: [{ maintenancePlanId: { in: planIds } }, { id: { in: extraWoIds } }] },
    select: { id: true },
  });
  const woIds = wos.map((w) => w.id);
  const links = [...woIds.map((id) => `/work-orders/${id}`), ...invoiceIds.map((id) => `/invoices/${id}`)];
  await owner.notification.deleteMany({ where: { link: { in: links } } });
  await owner.auditLog.deleteMany({
    where: { entityId: { in: [...planIds, ...woIds, ...templateIds, ...invoiceIds, ...customerIds] } },
  });
  await owner.workOrderStatusChange.deleteMany({ where: { workOrderId: { in: woIds } } });
  await owner.workOrderChecklistItem.deleteMany({ where: { workOrderId: { in: woIds } } });
  await owner.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await owner.maintenancePlan.deleteMany({ where: { id: { in: planIds } } });
  await owner.checklistTemplateItem.deleteMany({ where: { templateId: { in: templateIds } } });
  await owner.checklistTemplate.deleteMany({ where: { id: { in: templateIds } } });
  await owner.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await owner.customer.deleteMany({ where: { id: { in: customerIds } } });
  await owner.technicianLocation.deleteMany({ where: { id: { in: locationIds } } });
  await owner.$disconnect();
  await prismaBase.$disconnect();
});

describe("maintenance plans", () => {
  it("creates the work order 7 days before the due date, exactly once", async () => {
    const p = await newPlan({ startDate: "2026-12-20" });
    expect(p).toMatchObject({ nextDueDate: "2026-12-20", nextCreateOn: "2026-12-13", generatedCount: 0 });

    // Too early: 8 days before.
    const early = await maintenanceService.generateDue(db, "2026-12-12");
    expect(early.created.filter((c) => c.planId === p.id)).toHaveLength(0);

    // Seven days before: created.
    const first = await maintenanceService.generateDue(db, "2026-12-13");
    const mine = first.created.filter((c) => c.planId === p.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].dueDate).toBe("2026-12-20");

    // Running again, the same day or later, creates nothing more for the same due date.
    const again = await maintenanceService.generateDue(db, "2026-12-13");
    const later = await maintenanceService.generateDue(db, "2026-12-19");
    expect([...again.created, ...later.created].filter((c) => c.planId === p.id)).toHaveLength(0);

    const [wo, ...rest] = await workOrdersOf(p.id);
    expect(rest).toHaveLength(0);
    expect(wo).toMatchObject({
      customerId,
      title: p.title,
      description: "Check cameras and wiring",
      status: "NEW",
      priority: "MEDIUM",
      maintenancePlanId: p.id,
    });
    expect(wo.dueDate).not.toBeNull();
    expect((await maintenanceService.get(db, p.id)).nextDueDate).toBe("2027-01-20");
    expect(await owner.workOrderStatusChange.count({ where: { workOrderId: wo.id } })).toBe(1);
    // The office is told.
    expect(await owner.notification.count({ where: { link: `/work-orders/${wo.id}` } })).toBe(staffCount);
  });

  it("two workers running at the same moment still create one work order", async () => {
    const p = await newPlan({ title: `P12 race ${stamp}`, startDate: "2027-03-10" });
    const runs = await Promise.all(Array.from({ length: 4 }, () => maintenanceService.generateDue(db, "2027-03-05")));
    const created = runs.flatMap((r) => r.created).filter((c) => c.planId === p.id);
    expect(created).toHaveLength(1);
    expect(await workOrdersOf(p.id)).toHaveLength(1);
  });

  it("the database itself refuses a second work order for the same plan and due date", async () => {
    const p = await newPlan({ title: `P12 unique ${stamp}`, startDate: "2027-04-10" });
    await maintenanceService.generateDue(db, "2027-04-10");
    const [wo] = await workOrdersOf(p.id);
    await expect(
      owner.workOrder.create({
        data: {
          companyId,
          number: `DUP-${stamp}`,
          customerId,
          title: "duplicate",
          maintenancePlanId: p.id,
          dueDate: wo.dueDate,
        },
      }),
    ).rejects.toThrow();
  });

  it("catches up missed due dates, stops at the end date and switches the plan off", async () => {
    const p = await newPlan({
      title: `P12 weekly ${stamp}`,
      frequency: "WEEKLY",
      startDate: "2027-05-01",
      endDate: "2027-05-15",
      leadDays: 7,
    });
    const run = await maintenanceService.generateDue(db, "2027-05-10");
    // 1 May, 8 May and 15 May are all within reach (15 May - 7 days = 8 May); 22 May is past the end.
    expect(run.created.filter((c) => c.planId === p.id).map((c) => c.dueDate)).toEqual([
      "2027-05-01",
      "2027-05-08",
      "2027-05-15",
    ]);
    expect(run.finished).toContain(p.id);
    expect((await maintenanceService.get(db, p.id)).isActive).toBe(false);
    expect(await workOrdersOf(p.id)).toHaveLength(3);
  });

  it("copies the checklist and a paused plan creates nothing", async () => {
    const tpl = await checklistsService.create(db, admin, {
      name: `P12 checklist ${stamp}`,
      items: ["Clean lens", "Check wiring", "Test recording"],
      isActive: true,
    });
    templateIds.push(tpl.id);
    const p = await newPlan({
      title: `P12 checklist plan ${stamp}`,
      startDate: "2027-06-01",
      checklistTemplateId: tpl.id,
    });

    await maintenanceService.setActive(db, p.id, false);
    expect(
      (await maintenanceService.generateDue(db, "2027-06-01")).created.filter((c) => c.planId === p.id),
    ).toHaveLength(0);

    await maintenanceService.setActive(db, p.id, true);
    await maintenanceService.generateDue(db, "2027-06-01");
    const [wo] = await workOrdersOf(p.id);
    const items = await owner.workOrderChecklistItem.findMany({
      where: { workOrderId: wo.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(items.map((i) => i.text)).toEqual(["Clean lens", "Check wiring", "Test recording"]);
  });

  it("only the plans of the company that runs are touched", async () => {
    const p = await newPlan({ title: `P12 tenant ${stamp}`, startDate: "2027-07-01" });
    const run = await maintenanceService.generateDue(acmeDb, "2027-07-01");
    expect(run.created.filter((c) => c.planId === p.id)).toHaveLength(0);
    expect(await workOrdersOf(p.id)).toHaveLength(0);
  });

  it("checks that the site belongs to the customer, and moves the next date when the schedule changes", async () => {
    const other = await owner.serviceAddress.findFirst({
      where: { companyId, customerId: { not: customerId }, deletedAt: null },
    });
    if (other)
      await expect(maintenanceService.create(db, admin, plan({ addressId: other.id }))).rejects.toBeInstanceOf(
        BadRequestError,
      );

    const p = await newPlan({ title: `P12 edit ${stamp}`, startDate: "2027-08-01", addressId });
    const edited = await maintenanceService.update(db, admin, p.id, {
      ...plan({ title: `P12 edit ${stamp}`, addressId }),
      startDate: "2027-09-15",
    });
    expect(edited.nextDueDate).toBe("2027-09-15");
    await maintenanceService.remove(db, p.id);
    expect((await maintenanceService.list(db)).some((x) => x.id === p.id)).toBe(false);
  });
});

describe("background jobs", () => {
  it("overdue scan tells the office once per overdue work order", async () => {
    const wo = await owner.workOrder.create({
      data: {
        companyId,
        number: `OD-${stamp}`,
        customerId,
        title: `P12 overdue ${stamp}`,
        status: "NEW",
        dueDate: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    extraWoIds.push(wo.id);
    await overdueScan(db, companyId);
    const link = `/work-orders/${wo.id}`;
    expect(await owner.notification.count({ where: { link } })).toBe(staffCount);
    await overdueScan(db, companyId);
    expect(await owner.notification.count({ where: { link } })).toBe(staffCount);
  });

  it("invoice reminders: an office note and an email, once a week", async () => {
    const customer = await owner.customer.create({
      data: { companyId, name: `P12 payer ${stamp}`, email: `payer-${stamp}@example.test` },
    });
    customerIds.push(customer.id);
    const inv = await owner.invoice.create({
      data: {
        companyId,
        number: `INV-P12-${stamp}`,
        customerId: customer.id,
        status: "SENT",
        total: "250.00",
        amountPaid: "50.00",
        dueDate: new Date(Date.now() + 86_400_000),
      },
    });
    invoiceIds.push(inv.id);

    const sent: EmailJob[] = [];
    const enqueue = async (m: EmailJob) => void sent.push(m);
    const now = new Date();
    await invoiceReminders(db, companyId, enqueue, now);
    const mine = sent.filter((m) => m.to === `payer-${stamp}@example.test`);
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toContain(`INV-P12-${stamp}`);
    expect(mine[0].text).toContain("200.00");
    expect(await owner.notification.count({ where: { link: `/invoices/${inv.id}` } })).toBe(staffCount);

    // The next day: no second reminder.
    await invoiceReminders(db, companyId, enqueue, new Date(now.getTime() + 86_400_000));
    expect(sent.filter((m) => m.to === `payer-${stamp}@example.test`)).toHaveLength(1);
    // A week later: reminded again.
    await invoiceReminders(db, companyId, enqueue, new Date(now.getTime() + 7 * 86_400_000));
    expect(sent.filter((m) => m.to === `payer-${stamp}@example.test`)).toHaveLength(2);

    // A paid invoice is left alone.
    await owner.invoice.update({ where: { id: inv.id }, data: { status: "PAID", amountPaid: "250.00" } });
    await invoiceReminders(db, companyId, enqueue, new Date(now.getTime() + 20 * 86_400_000));
    expect(sent.filter((m) => m.to === `payer-${stamp}@example.test`)).toHaveLength(2);
  });

  it("GPS clean-up deletes only points older than the retention window", async () => {
    // A fixed moment in the past keeps real (recent) location data out of the way.
    const now = new Date("2020-06-01T00:00:00Z");
    const make = async (recordedAt: string) => {
      const row = await owner.technicianLocation.create({
        data: {
          companyId,
          technicianId: techId,
          latitude: "31.5204",
          longitude: "74.3587",
          recordedAt: new Date(recordedAt),
        },
      });
      locationIds.push(row.id);
      return row.id;
    };
    const old = await make("2020-03-01T00:00:00Z");
    const recent = await make("2020-05-25T00:00:00Z");
    expect(await locationCleanup(now, 30)).toBeGreaterThanOrEqual(1);
    expect(await owner.technicianLocation.count({ where: { id: old } })).toBe(0);
    expect(await owner.technicianLocation.count({ where: { id: recent } })).toBe(1);
  });
});
