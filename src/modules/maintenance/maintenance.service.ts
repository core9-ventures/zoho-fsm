import "server-only";
import { Prisma } from "@prisma/client";
import {
  addDays,
  dueDateAfter,
  type GenerationResult,
  type MaintenancePlanDto,
  type MaintenancePlanInput,
} from "./maintenance.schema";
import type { CurrentUser } from "@/lib/auth";
import type { AppDb } from "@/lib/db";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { nextNumber } from "@/lib/numbers";
import { fromCompanyTime, todayIn } from "@/lib/tz";
import { dateOnly, dateOrNull, nullIfEmpty } from "@/lib/validation";

const live = { deletedAt: null };
/** Largest lead time a plan may have: the generation query looks this far ahead. */
const MAX_LEAD_DAYS = 90;
/** A plan that was missed for a long time catches up at most this many due dates in one run. */
const MAX_CATCH_UP = 12;

const select = {
  id: true,
  customerId: true,
  customer: { select: { name: true } },
  addressId: true,
  address: { select: { label: true, addressLine: true } },
  assetId: true,
  asset: { select: { name: true } },
  title: true,
  description: true,
  frequency: true,
  intervalCount: true,
  leadDays: true,
  startDate: true,
  nextDueDate: true,
  endDate: true,
  checklistTemplateId: true,
  priority: true,
  isActive: true,
  updatedAt: true,
  _count: { select: { workOrders: { where: live } } },
  workOrders: {
    where: live,
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, number: true, dueDate: true },
  },
} satisfies Prisma.MaintenancePlanSelect;
type Row = Prisma.MaintenancePlanGetPayload<{ select: typeof select }>;

const day = (d: Date) => dateOnly(d)!;

function toDto(p: Row): MaintenancePlanDto {
  const last = p.workOrders[0];
  return {
    id: p.id,
    customerId: p.customerId,
    customerName: p.customer.name,
    addressId: p.addressId,
    siteLabel: p.address
      ? p.address.label
        ? `${p.address.label} — ${p.address.addressLine}`
        : p.address.addressLine
      : null,
    assetId: p.assetId,
    assetName: p.asset?.name ?? null,
    title: p.title,
    description: p.description ?? "",
    frequency: p.frequency,
    intervalCount: p.intervalCount,
    leadDays: p.leadDays,
    startDate: day(p.startDate),
    nextDueDate: day(p.nextDueDate),
    endDate: dateOnly(p.endDate),
    checklistTemplateId: p.checklistTemplateId,
    priority: p.priority,
    isActive: p.isActive,
    generatedCount: p._count.workOrders,
    lastWorkOrder: last ? { id: last.id, number: last.number, dueDate: last.dueDate?.toISOString() ?? null } : null,
    nextCreateOn: p.isActive ? addDays(day(p.nextDueDate), -p.leadDays) : null,
    updatedAt: p.updatedAt.toISOString(),
  };
}

const companyOf = (actor: CurrentUser) => {
  if (!actor.companyId) throw new ForbiddenError("This action needs a company account.");
  return actor.companyId;
};

async function getOrThrow(db: AppDb, id: string) {
  const p = await db.maintenancePlan.findFirst({ where: { id }, select });
  if (!p) throw new NotFoundError("Maintenance plan", id);
  return p;
}

async function assertTargets(db: AppDb, i: MaintenancePlanInput) {
  const customer = await db.customer.findFirst({ where: { id: i.customerId }, select: { id: true } });
  if (!customer) throw new BadRequestError("Customer was not found.", { customerId: ["Choose an existing customer."] });
  if (i.addressId && !(await db.serviceAddress.findFirst({ where: { id: i.addressId, customerId: i.customerId } })))
    throw new BadRequestError("That site is not one of this customer's.", {
      addressId: ["Choose one of this customer's sites."],
    });
  if (i.assetId && !(await db.asset.findFirst({ where: { id: i.assetId, customerId: i.customerId } })))
    throw new BadRequestError("That asset is not one of this customer's.", {
      assetId: ["Choose one of this customer's assets."],
    });
  if (i.checklistTemplateId && !(await db.checklistTemplate.findFirst({ where: { id: i.checklistTemplateId } })))
    throw new BadRequestError("Checklist template was not found.", { checklistTemplateId: ["Choose a template."] });
}

const data = (i: MaintenancePlanInput) => ({
  customerId: i.customerId,
  addressId: i.addressId || null,
  assetId: i.assetId || null,
  title: i.title,
  description: nullIfEmpty(i.description),
  frequency: i.frequency,
  intervalCount: i.intervalCount,
  leadDays: i.leadDays,
  startDate: dateOrNull(i.startDate)!,
  endDate: dateOrNull(i.endDate),
  checklistTemplateId: i.checklistTemplateId || null,
  priority: i.priority,
  isActive: i.isActive,
});

export const maintenanceService = {
  async list(db: AppDb): Promise<MaintenancePlanDto[]> {
    const rows = await db.maintenancePlan.findMany({
      orderBy: [{ isActive: "desc" }, { nextDueDate: "asc" }],
      select,
    });
    return rows.map(toDto);
  },

  async get(db: AppDb, id: string): Promise<MaintenancePlanDto> {
    return toDto(await getOrThrow(db, id));
  },

  async create(db: AppDb, actor: CurrentUser, input: MaintenancePlanInput): Promise<MaintenancePlanDto> {
    const companyId = companyOf(actor);
    await assertTargets(db, input);
    const p = await db.maintenancePlan.create({
      // The first work order is due on the start date.
      data: { companyId, ...data(input), nextDueDate: dateOrNull(input.startDate)! },
      select: { id: true },
    });
    return toDto(await getOrThrow(db, p.id));
  },

  /**
   * Edits a plan. When the schedule itself (start date, frequency or interval) changes, the next due
   * date is recalculated: the first due date on or after today, never one that was already created.
   */
  async update(db: AppDb, actor: CurrentUser, id: string, input: MaintenancePlanInput): Promise<MaintenancePlanDto> {
    companyOf(actor);
    const before = await getOrThrow(db, id);
    await assertTargets(db, input);
    const scheduleChanged =
      day(before.startDate) !== input.startDate ||
      before.frequency !== input.frequency ||
      before.intervalCount !== input.intervalCount;
    let nextDueDate = before.nextDueDate;
    if (scheduleChanged) {
      const c = await db.company.findFirst({ select: { timeZone: true } });
      const yesterday = addDays(todayIn(c?.timeZone ?? "UTC"), -1);
      const next = dueDateAfter(input.startDate, input.frequency, input.intervalCount, yesterday);
      // A plan that already created work orders never goes back to an earlier date.
      nextDueDate = dateOrNull(
        next > day(before.nextDueDate) || before._count.workOrders === 0 ? next : day(before.nextDueDate),
      )!;
    }
    await db.maintenancePlan.update({ where: { id }, data: { ...data(input), nextDueDate } });
    return toDto(await getOrThrow(db, id));
  },

  async setActive(db: AppDb, id: string, isActive: boolean): Promise<MaintenancePlanDto> {
    await getOrThrow(db, id);
    await db.maintenancePlan.update({ where: { id }, data: { isActive } });
    return toDto(await getOrThrow(db, id));
  },

  /** Soft delete: work orders it already created stay. */
  async remove(db: AppDb, id: string): Promise<void> {
    await getOrThrow(db, id);
    await db.maintenancePlan.delete({ where: { id } });
  },

  /**
   * Creates the work orders that are due, for the company `db` is scoped to. A plan is due once today
   * reaches its due date minus its lead days (7 by default). Safe to run any number of times: the plan's
   * next due date moves forward in the same transaction that creates the work order (and is only moved
   * if nobody else has moved it first), and the database refuses a second work order for one due date.
   */
  async generateDue(db: AppDb, today?: string): Promise<GenerationResult> {
    const ctx = db.$dbContext();
    if (ctx.kind !== "tenant") throw new ForbiddenError("Maintenance runs inside one company.");
    const companyId = ctx.companyId;
    const company = await db.company.findFirst({ select: { timeZone: true } });
    const timeZone = company?.timeZone ?? "UTC";
    const now = today ?? todayIn(timeZone);

    const plans = await db.maintenancePlan.findMany({
      where: { isActive: true, nextDueDate: { lte: dateOrNull(addDays(now, MAX_LEAD_DAYS))! } },
      orderBy: { nextDueDate: "asc" },
      select: {
        id: true,
        customerId: true,
        addressId: true,
        assetId: true,
        title: true,
        description: true,
        frequency: true,
        intervalCount: true,
        leadDays: true,
        startDate: true,
        nextDueDate: true,
        endDate: true,
        checklistTemplateId: true,
        priority: true,
        customer: { select: { name: true } },
      },
    });

    const result: GenerationResult = { created: [], finished: [] };
    for (const plan of plans) {
      let due = day(plan.nextDueDate);
      const start = day(plan.startDate);
      const end = dateOnly(plan.endDate);
      for (let i = 0; i < MAX_CATCH_UP; i++) {
        if (end && due > end) break;
        if (addDays(due, -plan.leadDays) > now) break; // not time yet
        const following = dueDateAfter(start, plan.frequency, plan.intervalCount, due);
        const finished = !!end && following > end;
        const created = await createOne(db, companyId, timeZone, plan, due, following, finished);
        if (created) result.created.push({ planId: plan.id, ...created, dueDate: due });
        if (finished) result.finished.push(plan.id);
        due = following;
      }
      // A plan whose end date has already passed (e.g. edited into the past) is switched off.
      if (end && due > end && !result.finished.includes(plan.id)) {
        await db.maintenancePlan.updateMany({ where: { id: plan.id, isActive: true }, data: { isActive: false } });
        result.finished.push(plan.id);
      }
    }
    return result;
  },
};

type DuePlan = {
  id: string;
  customerId: string;
  addressId: string | null;
  assetId: string | null;
  title: string;
  description: string | null;
  checklistTemplateId: string | null;
  priority: "HIGH" | "MEDIUM" | "LOW";
  nextDueDate: Date;
  customer: { name: string };
};

/**
 * One due date → one work order, atomically. Returns null when someone else already handled it.
 */
async function createOne(
  db: AppDb,
  companyId: string,
  timeZone: string,
  plan: DuePlan,
  due: string,
  following: string,
  finished: boolean,
): Promise<{ workOrderId: string; number: string } | null> {
  const advance = { nextDueDate: dateOrNull(following)!, ...(finished ? { isActive: false } : {}) };
  try {
    return await db.$withTx(async () => {
      // Claim this due date: only one run can move the plan from `due` to `following`.
      const claimed = await db.maintenancePlan.updateMany({
        where: { id: plan.id, isActive: true, nextDueDate: dateOrNull(due)! },
        data: advance,
      });
      if (claimed.count === 0) return null;

      const items = plan.checklistTemplateId
        ? await db.checklistTemplateItem.findMany({
            where: { templateId: plan.checklistTemplateId },
            orderBy: { sortOrder: "asc" },
            select: { text: true },
          })
        : [];
      const number = await nextNumber(db, "WO");
      const wo = await db.workOrder.create({
        data: {
          companyId,
          number,
          customerId: plan.customerId,
          addressId: plan.addressId,
          assetId: plan.assetId,
          maintenancePlanId: plan.id,
          title: plan.title,
          description: plan.description,
          priority: plan.priority,
          status: "NEW",
          // The job is due by the end of the working day of its due date, in the company's time zone.
          dueDate: fromCompanyTime(`${due}T17:00`, timeZone),
        },
        select: { id: true },
      });
      await db.workOrderStatusChange.create({
        data: {
          companyId,
          workOrderId: wo.id,
          fromStatus: null,
          toStatus: "NEW",
          reason: "Created by maintenance plan",
          changedById: null,
        },
      });
      if (items.length) {
        await db.workOrderChecklistItem.createMany({
          data: items.map((t, i) => ({ companyId, workOrderId: wo.id, text: t.text, sortOrder: i + 1 })),
        });
      }
      const staff = await db.user.findMany({
        where: { role: { in: ["ADMIN", "DISPATCHER"] }, isActive: true },
        select: { id: true },
      });
      if (staff.length) {
        await db.notification.createMany({
          data: staff.map((u) => ({
            companyId,
            userId: u.id,
            title: `Maintenance work order ${number} created`,
            body: `${plan.title} for ${plan.customer.name}, due ${due}.`,
            link: `/work-orders/${wo.id}`,
          })),
        });
      }
      return { workOrderId: wo.id, number };
    });
  } catch (err) {
    // A work order for this plan and due date already exists (the unique index says so): just move on.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      logger.warn({ planId: plan.id, due }, "maintenance.already_created");
      await db.maintenancePlan.updateMany({
        where: { id: plan.id, nextDueDate: dateOrNull(due)! },
        data: advance,
      });
      return null;
    }
    throw err;
  }
}
