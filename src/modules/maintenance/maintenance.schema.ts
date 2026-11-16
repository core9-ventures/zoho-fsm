import type { MaintenanceFrequency, Priority } from "@prisma/client";
import { z } from "zod";
import { idParam, optionalText, requiredText } from "@/lib/validation";

export const FREQUENCIES = [
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
] as const satisfies readonly MaintenanceFrequency[];
export const FREQUENCY_LABEL: Record<MaintenanceFrequency, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};
const UNIT: Record<MaintenanceFrequency, string> = {
  WEEKLY: "week",
  MONTHLY: "month",
  QUARTERLY: "quarter",
  YEARLY: "year",
};

/** "Every month", "Every 2 weeks". */
export function describeSchedule(frequency: MaintenanceFrequency, intervalCount: number) {
  const unit = UNIT[frequency];
  return intervalCount === 1 ? `Every ${unit}` : `Every ${intervalCount} ${unit}s`;
}

const MONTHS_PER: Record<MaintenanceFrequency, number> = { WEEKLY: 0, MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

const parse = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m: m - 1, d };
};
const fmt = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The n-th due date of a plan ("YYYY-MM-DD"), counted from its start date (n = 0 is the start itself).
 * Always computed from the start, never from the previous date, so "31 Jan, monthly" gives 28 Feb and
 * then 31 Mar instead of drifting to the 28th for good.
 */
export function nthDueDate(start: string, frequency: MaintenanceFrequency, intervalCount: number, n: number): string {
  const { y, m, d } = parse(start);
  if (frequency === "WEEKLY") return fmt(new Date(Date.UTC(y, m, d + 7 * intervalCount * n)));
  const months = m + MONTHS_PER[frequency] * intervalCount * n;
  const year = y + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(year, month, Math.min(d, lastDay))));
}

/** The first due date strictly after `after`. */
export function dueDateAfter(
  start: string,
  frequency: MaintenanceFrequency,
  intervalCount: number,
  after: string,
): string {
  for (let n = 0; n < 5000; n++) {
    const due = nthDueDate(start, frequency, intervalCount, n);
    if (due > after) return due;
  }
  throw new Error("Maintenance schedule is out of range.");
}

/** "YYYY-MM-DD" shifted by whole days. */
export const addDays = (day: string, days: number) => {
  const { y, m, d } = parse(day);
  return fmt(new Date(Date.UTC(y, m, d + days)));
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.");

export const maintenancePlanSchema = z
  .object({
    customerId: z.string().min(1, "Choose a customer.").max(40),
    addressId: z.union([z.literal(""), idParam]),
    assetId: z.union([z.literal(""), idParam]),
    title: requiredText(200, "Title"),
    description: optionalText(2000),
    frequency: z.enum(FREQUENCIES),
    intervalCount: z
      .number({ invalid_type_error: "Enter a number." })
      .int()
      .min(1, "At least 1.")
      .max(52, "At most 52."),
    leadDays: z
      .number({ invalid_type_error: "Enter a number." })
      .int()
      .min(0, "Use 0 or more.")
      .max(90, "At most 90 days."),
    startDate: day,
    endDate: z.union([z.literal(""), day]),
    checklistTemplateId: z.union([z.literal(""), idParam]),
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
    isActive: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.endDate && p.endDate < p.startDate)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "End date is before the start date." });
  });
export type MaintenancePlanInput = z.infer<typeof maintenancePlanSchema>;

export type MaintenancePlanDto = {
  id: string;
  customerId: string;
  customerName: string;
  addressId: string | null;
  siteLabel: string | null;
  assetId: string | null;
  assetName: string | null;
  title: string;
  description: string;
  frequency: MaintenanceFrequency;
  intervalCount: number;
  leadDays: number;
  startDate: string;
  nextDueDate: string;
  endDate: string | null;
  checklistTemplateId: string | null;
  priority: Priority;
  isActive: boolean;
  /** Work orders already created by this plan. */
  generatedCount: number;
  lastWorkOrder: { id: string; number: string; dueDate: string | null } | null;
  /** When the next work order will be created (due date minus lead days). */
  nextCreateOn: string | null;
  updatedAt: string;
};

/** What a run created, for the "Run now" button and the worker log. */
export type GenerationResult = {
  created: { planId: string; workOrderId: string; number: string; dueDate: string }[];
  /** Plans that reached their end date and were switched off. */
  finished: string[];
};
