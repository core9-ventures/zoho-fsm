import "server-only";
import { createDb, systemDb, tenantContext, type AppDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { formatIn, todayIn } from "@/lib/tz";
import { dateOrNull } from "@/lib/validation";
import { addDays, maintenanceService, type GenerationResult } from "@/modules/maintenance";

/** Local hour (in the company time zone) at which the daily jobs run. */
export const DAILY_HOUR = 6;
/** Technician GPS points older than this are deleted. */
export const LOCATION_RETENTION_DAYS = 30;
/** An invoice gets a reminder this many days before it is due, and then weekly while unpaid. */
export const REMINDER_LEAD_DAYS = 3;
export const REMINDER_EVERY_DAYS = 7;

export type EmailJob = { to: string; subject: string; text: string };
/** How the jobs hand an email to the queue (the worker passes pg-boss; tests pass a recorder). */
export type EnqueueEmail = (mail: EmailJob) => Promise<void>;

const CLOSED_WORK_ORDERS = ["COMPLETED", "CLOSED", "CANCELLED", "ON_HOLD"] as const;

async function notifyStaff(db: AppDb, companyId: string, n: { title: string; body: string; link: string }) {
  const users = await db.user.findMany({
    where: { role: { in: ["ADMIN", "DISPATCHER"] }, isActive: true },
    select: { id: true },
  });
  if (users.length === 0) return;
  await db.notification.createMany({ data: users.map((u) => ({ companyId, userId: u.id, ...n })) });
}

/** Has the office already been told about this (same link and title start), optionally since a date? */
async function alreadyTold(db: AppDb, link: string, titleStart: string, since?: Date) {
  const n = await db.notification.count({
    where: { link, title: { startsWith: titleStart }, ...(since ? { createdAt: { gte: since } } : {}) },
  });
  return n > 0;
}

/**
 * Overdue scan: tells the office once about every open work order past its due date and every unpaid
 * invoice past its due date. Running it again tells nobody twice.
 */
export async function overdueScan(db: AppDb, companyId: string, now = new Date()) {
  const company = await db.company.findFirst({ select: { timeZone: true } });
  const timeZone = company?.timeZone ?? "UTC";
  const today = todayIn(timeZone, now);
  let workOrders = 0;
  let invoices = 0;

  const late = await db.workOrder.findMany({
    where: { dueDate: { lt: now }, status: { notIn: [...CLOSED_WORK_ORDERS] } },
    select: { id: true, number: true, title: true, dueDate: true },
  });
  for (const w of late) {
    const link = `/work-orders/${w.id}`;
    if (await alreadyTold(db, link, "Overdue work order")) continue;
    await notifyStaff(db, companyId, {
      title: `Overdue work order ${w.number}`,
      body: `${w.title} was due ${formatIn(w.dueDate!, timeZone)}.`,
      link,
    });
    workOrders++;
  }

  const unpaid = await db.invoice.findMany({
    where: { status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: dateOrNull(today)! } },
    select: { id: true, number: true, customer: { select: { name: true } } },
  });
  for (const i of unpaid) {
    const link = `/invoices/${i.id}`;
    if (await alreadyTold(db, link, "Overdue invoice")) continue;
    await notifyStaff(db, companyId, {
      title: `Overdue invoice ${i.number}`,
      body: `${i.customer.name} has not paid it by the due date.`,
      link,
    });
    invoices++;
  }
  return { workOrders, invoices };
}

/**
 * Invoice reminders: an unpaid invoice due within 3 days (or already late) is reminded about once a
 * week: a note for the office and, when the customer has an email address, an email.
 */
export async function invoiceReminders(db: AppDb, companyId: string, enqueue: EnqueueEmail, now = new Date()) {
  const company = await db.company.findFirst({ select: { name: true, timeZone: true } });
  const today = todayIn(company?.timeZone ?? "UTC", now);
  const invoices = await db.invoice.findMany({
    where: {
      status: { in: ["SENT", "PARTIALLY_PAID"] },
      dueDate: { lte: dateOrNull(addDays(today, REMINDER_LEAD_DAYS))! },
    },
    select: {
      id: true,
      number: true,
      total: true,
      amountPaid: true,
      dueDate: true,
      customer: { select: { name: true, email: true } },
    },
  });
  // A reminder sent 7 days ago may be repeated; one sent less than a week ago may not.
  const since = new Date(now.getTime() - REMINDER_EVERY_DAYS * 86_400_000 + 3_600_000);
  let reminded = 0;
  for (const i of invoices) {
    const link = `/invoices/${i.id}`;
    if (await alreadyTold(db, link, "Payment reminder", since)) continue;
    const balance = Number(i.total) - Number(i.amountPaid);
    if (balance <= 0) continue;
    const due = i.dueDate!.toISOString().slice(0, 10);
    await notifyStaff(db, companyId, {
      title: `Payment reminder ${i.number}`,
      body: `${i.customer.name} owes ${balance.toFixed(2)}; due ${due}.`,
      link,
    });
    if (i.customer.email) {
      await enqueue({
        to: i.customer.email,
        subject: `Payment reminder: invoice ${i.number}`,
        text:
          `Hello ${i.customer.name},\n\n` +
          `A friendly reminder that invoice ${i.number} (balance ${balance.toFixed(2)}) ` +
          `${due < today ? "was due" : "is due"} on ${due}.\n\nThank you,\n${company?.name ?? "FieldServe"}`,
      });
    }
    reminded++;
  }
  return { reminded };
}

/** Everything one company needs each morning, in its own time zone. Safe to run again. */
export async function runCompanyDaily(companyId: string, enqueue: EnqueueEmail, now = new Date()) {
  const db = createDb(tenantContext(companyId, null));
  const maintenance: GenerationResult = await maintenanceService.generateDue(db);
  const overdue = await overdueScan(db, companyId, now);
  const reminders = await invoiceReminders(db, companyId, enqueue, now);
  logger.info({ companyId, created: maintenance.created.length, ...overdue, ...reminders }, "automation.company_daily");
  return { maintenance, overdue, reminders };
}

/** Deletes technician GPS points older than the retention window (all companies). */
export async function locationCleanup(now = new Date(), days = LOCATION_RETENTION_DAYS) {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const db = systemDb("location clean-up job");
  const deleted = await db.$rawInContext(
    (tx) => tx.$executeRaw`DELETE FROM "TechnicianLocation" WHERE "recordedAt" < ${cutoff}`,
  );
  logger.info({ deleted, days }, "automation.location_cleanup");
  return deleted;
}

/** Companies whose local clock reads the daily hour right now, with their local date (the once-a-day key). */
export async function companiesDueNow(now = new Date(), hour = DAILY_HOUR) {
  const companies = await systemDb("daily scheduler").company.findMany({
    where: { isActive: true },
    select: { id: true, timeZone: true },
  });
  return companies
    .filter((c) => Number(formatIn(now, c.timeZone, "H")) === hour)
    .map((c) => ({ companyId: c.id, day: todayIn(c.timeZone, now) }));
}
