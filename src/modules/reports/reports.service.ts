import "server-only";
import {
  addDaysTo,
  daysBetween,
  MAX_ROWS,
  resolveRange,
  utilisationPercent,
  type DashboardKpis,
  type Report,
  type ReportQuery,
  type TechnicianUtilisation,
} from "./reports.schema";
import type { CurrentUser } from "@/lib/auth";
import type { AppDb } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { dayRangeUtc, formatIn, todayIn } from "@/lib/tz";

const OPEN = ["NEW", "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "ON_HOLD"] as const;
const UNPAID = ["SENT", "PARTIALLY_PAID", "OVERDUE"] as const;

const num = (v: { toNumber(): number } | null | undefined) => (v ? v.toNumber() : 0);
const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

async function companyOf(db: AppDb, actor: CurrentUser) {
  if (!actor.companyId) throw new ForbiddenError("Reports belong to a company.");
  const company = await db.company.findUnique({ where: { id: actor.companyId } });
  if (!company) throw new ForbiddenError("Company not found.");
  return company;
}

/** Built-in Admin always sees money; a custom role needs invoice access; dispatchers do not by default. */
export function canSeeMoney(user: CurrentUser): boolean {
  if (user.customRoleId) return hasPermission(user.permissions, "invoices:view");
  return user.role === "ADMIN";
}

/** UTC [start, end) of the range's days in the company time zone. */
function utcRange(from: string, to: string, timeZone: string) {
  return { gte: dayRangeUtc(from, timeZone).start, lt: dayRangeUtc(to, timeZone).end };
}

async function utilisation(db: AppDb, from: string, to: string, timeZone: string): Promise<TechnicianUtilisation[]> {
  const [techs, sheets] = await Promise.all([
    db.user.findMany({
      where: { role: "TECHNICIAN", isActive: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
    db.timeSheet.groupBy({
      by: ["technicianId"],
      where: { checkInAt: utcRange(from, to, timeZone), durationMinutes: { not: null } },
      _sum: { durationMinutes: true },
    }),
  ]);
  const minutes = new Map(sheets.map((s) => [s.technicianId, s._sum.durationMinutes ?? 0]));
  return techs.map((t) => {
    const tracked = minutes.get(t.id) ?? 0;
    return {
      technicianId: t.id,
      name: t.fullName,
      trackedMinutes: tracked,
      percent: utilisationPercent(tracked, from, to),
    };
  });
}

export const reportsService = {
  /** The numbers on the dashboard. `now` is injectable so tests can pin the clock. */
  async kpis(db: AppDb, actor: CurrentUser, now = new Date()): Promise<DashboardKpis> {
    const company = await companyOf(db, actor);
    const tz = company.timeZone;
    const today = todayIn(tz, now);
    const todayUtc = dayRangeUtc(today, tz);
    const month = today.slice(0, 7);
    const monthStart = `${month}-01`;
    const lastMonthStart = `${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 1))
      .toISOString()
      .slice(0, 7)}-01`;
    const monthStartUtc = dayRangeUtc(monthStart, tz).start;
    const lastMonthStartUtc = dayRangeUtc(lastMonthStart, tz).start;
    const trendFrom = addDaysTo(today, -13);
    const utilFrom = addDaysTo(today, -29);
    const money = canSeeMoney(actor);

    const [visitsToday, visitsDoneToday, open, overdue, qa, byStatus, completed, techs] = await Promise.all([
      db.appointment.count({
        where: { scheduledStart: { gte: todayUtc.start, lt: todayUtc.end }, status: { not: "CANCELLED" } },
      }),
      db.appointment.count({
        where: { scheduledStart: { gte: todayUtc.start, lt: todayUtc.end }, status: "COMPLETED" },
      }),
      db.workOrder.count({ where: { status: { in: [...OPEN] } } }),
      db.workOrder.count({ where: { status: { in: [...OPEN] }, dueDate: { lt: now } } }),
      db.workOrder.count({ where: { status: "COMPLETED" } }),
      db.workOrder.groupBy({ by: ["status"], _count: { _all: true } }),
      db.workOrder.findMany({
        where: { completedAt: { gte: dayRangeUtc(trendFrom, tz).start, lt: todayUtc.end } },
        select: { completedAt: true },
      }),
      utilisation(db, utilFrom, today, tz),
    ]);

    const perDay = new Map<string, number>();
    for (const w of completed) {
      const d = formatIn(w.completedAt!, tz, "yyyy-MM-dd");
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const completedPerDay = Array.from({ length: 14 }, (_, i) => {
      const d = addDaysTo(trendFrom, i);
      return { day: d, count: perDay.get(d) ?? 0 };
    });

    let moneyFigures: DashboardKpis["money"] = null;
    if (money) {
      const [thisMonth, lastMonth, invoiced, unpaid, late] = await Promise.all([
        db.payment.aggregate({ where: { paidAt: { gte: monthStartUtc, lt: todayUtc.end } }, _sum: { amount: true } }),
        db.payment.aggregate({
          where: { paidAt: { gte: lastMonthStartUtc, lt: monthStartUtc } },
          _sum: { amount: true },
        }),
        db.invoice.aggregate({
          where: {
            status: { notIn: ["DRAFT", "VOID"] },
            issueDate: { gte: new Date(`${monthStart}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) },
          },
          _sum: { total: true },
        }),
        db.invoice.aggregate({ where: { status: { in: [...UNPAID] } }, _sum: { total: true, amountPaid: true } }),
        db.invoice.aggregate({
          where: { status: { in: [...UNPAID] }, dueDate: { lt: new Date(`${today}T00:00:00Z`) } },
          _sum: { total: true, amountPaid: true },
        }),
      ]);
      const balance = (s: { total: { toNumber(): number } | null; amountPaid: { toNumber(): number } | null }) =>
        Math.round((num(s.total) - num(s.amountPaid)) * 100) / 100;
      moneyFigures = {
        revenueThisMonth: num(thisMonth._sum.amount),
        revenueLastMonth: num(lastMonth._sum.amount),
        invoicedThisMonth: num(invoiced._sum.total),
        outstanding: balance(unpaid._sum),
        overdue: balance(late._sum),
      };
    }

    const average = techs.length ? Math.round(techs.reduce((n, t) => n + t.percent, 0) / techs.length) : 0;
    return {
      currency: company.currency,
      timeZone: tz,
      today,
      visitsToday,
      visitsDoneToday,
      openWorkOrders: open,
      overdueWorkOrders: overdue,
      awaitingQa: qa,
      money: moneyFigures,
      utilisation: { from: utilFrom, to: today, average, technicians: techs.sort((a, b) => b.percent - a.percent) },
      completedPerDay,
      byStatus: byStatus
        .map((g) => ({ status: g.status, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  },

  /** One report for a date range (days in the company's time zone). */
  async report(db: AppDb, actor: CurrentUser, query: ReportQuery, now = new Date()): Promise<Report> {
    const company = await companyOf(db, actor);
    const tz = company.timeZone;
    const { from, to } = resolveRange(query, todayIn(tz, now));
    const range = utcRange(from, to, tz);

    if (query.type === "work-orders") {
      const rows = await db.workOrder.findMany({
        where: { createdAt: range },
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS + 1,
        select: {
          number: true,
          title: true,
          status: true,
          priority: true,
          createdAt: true,
          dueDate: true,
          completedAt: true,
          customer: { select: { name: true } },
          address: { select: { label: true, addressLine: true } },
          appointments: {
            where: { status: { not: "CANCELLED" } },
            orderBy: { scheduledStart: "desc" },
            take: 1,
            select: { technician: { select: { fullName: true } } },
          },
        },
      });
      const truncated = rows.length > MAX_ROWS;
      const data = rows.slice(0, MAX_ROWS).map((w) => ({
        number: w.number,
        title: w.title,
        customer: w.customer.name,
        site: w.address ? (w.address.label ?? w.address.addressLine) : "",
        technician: w.appointments[0]?.technician.fullName ?? "",
        status: label(w.status),
        priority: label(w.priority),
        created: formatIn(w.createdAt, tz, "yyyy-MM-dd"),
        due: w.dueDate ? formatIn(w.dueDate, tz, "yyyy-MM-dd") : "",
        completed: w.completedAt ? formatIn(w.completedAt, tz, "yyyy-MM-dd") : "",
        overdue: !!w.dueDate && w.dueDate < now && (OPEN as readonly string[]).includes(w.status),
      }));
      const done = rows.filter((w) => w.status === "COMPLETED" || w.status === "CLOSED").length;
      return {
        type: "work-orders",
        from,
        to,
        rows: data,
        truncated,
        summary: [
          { label: "Created", value: String(data.length) },
          { label: "Completed or closed", value: String(done) },
          { label: "Overdue now", value: String(data.filter((r) => r.overdue).length) },
        ],
      };
    }

    if (query.type === "revenue") {
      if (!canSeeMoney(actor)) throw new ForbiddenError("You do not have access to revenue figures.");
      const [payments, invoiced] = await Promise.all([
        db.payment.findMany({
          where: { paidAt: range },
          orderBy: { paidAt: "desc" },
          take: MAX_ROWS + 1,
          select: {
            paidAt: true,
            method: true,
            reference: true,
            amount: true,
            invoice: { select: { number: true, customer: { select: { name: true } } } },
          },
        }),
        db.invoice.aggregate({
          where: {
            status: { notIn: ["DRAFT", "VOID"] },
            issueDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
          },
          _sum: { total: true },
        }),
      ]);
      const truncated = payments.length > MAX_ROWS;
      const rows = payments.slice(0, MAX_ROWS).map((p) => ({
        paidAt: formatIn(p.paidAt, tz, "yyyy-MM-dd HH:mm"),
        invoiceNumber: p.invoice.number,
        customer: p.invoice.customer.name,
        method: label(p.method),
        reference: p.reference ?? "",
        amount: num(p.amount),
      }));
      const byMethod = new Map<string, number>();
      for (const r of rows) byMethod.set(r.method, Math.round(((byMethod.get(r.method) ?? 0) + r.amount) * 100) / 100);
      const collected = Math.round(rows.reduce((n, r) => n + r.amount, 0) * 100) / 100;
      return {
        type: "revenue",
        from,
        to,
        currency: company.currency,
        rows,
        truncated,
        invoiced: num(invoiced._sum.total),
        byMethod: [...byMethod].map(([method, amount]) => ({ method, amount })),
        summary: [
          { label: "Collected", value: String(collected) },
          { label: "Invoiced", value: String(num(invoiced._sum.total)) },
          { label: "Payments", value: String(rows.length) },
        ],
      };
    }

    // Technicians
    const [techs, visits] = await Promise.all([
      utilisation(db, from, to, tz),
      db.appointment.groupBy({
        by: ["technicianId", "status"],
        where: { scheduledStart: range, status: { not: "CANCELLED" } },
        _count: { _all: true },
      }),
    ]);
    const rows = techs.map((t) => {
      const mine = visits.filter((v) => v.technicianId === t.technicianId);
      const total = mine.reduce((n, v) => n + v._count._all, 0);
      const doneVisits = mine.filter((v) => v.status === "COMPLETED").reduce((n, v) => n + v._count._all, 0);
      return {
        technician: t.name,
        visits: total,
        completedVisits: doneVisits,
        trackedHours: Math.round((t.trackedMinutes / 60) * 10) / 10,
        averageMinutes: doneVisits ? Math.round(t.trackedMinutes / doneVisits) : 0,
        utilisationPercent: t.percent,
      };
    });
    return {
      type: "technicians",
      from,
      to,
      rows,
      truncated: false,
      summary: [
        { label: "Technicians", value: String(rows.length) },
        { label: "Visits", value: String(rows.reduce((n, r) => n + r.visits, 0)) },
        { label: "Days in range", value: String(daysBetween(from, to)) },
      ],
    };
  },
};
