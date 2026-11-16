import { z } from "zod";

/** Reports and dashboard figures. Pure helpers live here so they can be tested without a database. */

export const REPORT_TYPES = ["work-orders", "revenue", "technicians"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_LABEL: Record<ReportType, string> = {
  "work-orders": "Work orders",
  revenue: "Revenue",
  technicians: "Technicians",
};

/** A day is 8 working hours; utilisation is tracked on-site time against that. */
export const WORK_MINUTES_PER_DAY = 8 * 60;
export const MAX_RANGE_DAYS = 366;
export const MAX_ROWS = 5000;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.");

export const reportQuerySchema = z
  .object({
    type: z.enum(REPORT_TYPES).default("work-orders"),
    from: day.optional(),
    to: day.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "The start date is after the end date.", path: ["to"] })
  .refine((q) => !q.from || !q.to || daysBetween(q.from, q.to) <= MAX_RANGE_DAYS, {
    message: `Choose a range of at most ${MAX_RANGE_DAYS} days.`,
    path: ["to"],
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** Number of days from `from` to `to`, both included. */
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000) + 1;

export function addDaysTo(d: string, n: number): string {
  return new Date(utc(d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Monday to Friday days in the range (both ends included): the days a technician is expected to work. */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let t = utc(from); t <= utc(to); t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/** Tracked minutes against the working time of the range, as a whole percent (not capped: overtime shows). */
export function utilisationPercent(trackedMinutes: number, from: string, to: string): number {
  const available = weekdaysBetween(from, to) * WORK_MINUTES_PER_DAY;
  return available === 0 ? 0 : Math.round((trackedMinutes / available) * 100);
}

/** The range to report on: what was asked, else the last 30 days ending today. */
export function resolveRange(q: { from?: string; to?: string }, today: string): { from: string; to: string } {
  const to = q.to ?? today;
  const from = q.from ?? addDaysTo(to, -29);
  return { from, to };
}

export type DashboardKpis = {
  currency: string;
  timeZone: string;
  today: string;
  visitsToday: number;
  visitsDoneToday: number;
  openWorkOrders: number;
  overdueWorkOrders: number;
  awaitingQa: number;
  /** Money figures are only filled for people allowed to see invoices. */
  money: null | {
    revenueThisMonth: number;
    revenueLastMonth: number;
    invoicedThisMonth: number;
    outstanding: number;
    overdue: number;
  };
  utilisation: { from: string; to: string; average: number; technicians: TechnicianUtilisation[] };
  completedPerDay: { day: string; count: number }[];
  byStatus: { status: string; count: number }[];
};

export type TechnicianUtilisation = {
  technicianId: string;
  name: string;
  trackedMinutes: number;
  percent: number;
};

export type WorkOrderReportRow = {
  number: string;
  title: string;
  customer: string;
  site: string;
  technician: string;
  status: string;
  priority: string;
  created: string;
  due: string;
  completed: string;
  overdue: boolean;
};

export type RevenueReportRow = {
  paidAt: string;
  invoiceNumber: string;
  customer: string;
  method: string;
  reference: string;
  amount: number;
};

export type TechnicianReportRow = {
  technician: string;
  visits: number;
  completedVisits: number;
  trackedHours: number;
  averageMinutes: number;
  utilisationPercent: number;
};

export type Report =
  | { type: "work-orders"; from: string; to: string; rows: WorkOrderReportRow[]; truncated: boolean; summary: Summary }
  | {
      type: "revenue";
      from: string;
      to: string;
      currency: string;
      rows: RevenueReportRow[];
      truncated: boolean;
      summary: Summary;
      byMethod: { method: string; amount: number }[];
      invoiced: number;
    }
  | { type: "technicians"; from: string; to: string; rows: TechnicianReportRow[]; truncated: false; summary: Summary };

/** Headline figures shown above a report table. */
export type Summary = { label: string; value: string }[];
