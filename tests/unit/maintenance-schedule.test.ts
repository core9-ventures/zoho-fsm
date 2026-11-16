import { describe, expect, it } from "vitest";
import {
  addDays,
  describeSchedule,
  dueDateAfter,
  maintenancePlanSchema,
  nthDueDate,
} from "@/modules/maintenance/maintenance.schema";

describe("maintenance schedule", () => {
  it("counts weekly, monthly, quarterly and yearly from the start date", () => {
    expect(nthDueDate("2026-11-04", "WEEKLY", 1, 0)).toBe("2026-11-04");
    expect(nthDueDate("2026-11-04", "WEEKLY", 2, 3)).toBe("2026-12-16");
    expect(nthDueDate("2026-11-04", "MONTHLY", 1, 2)).toBe("2027-01-04");
    expect(nthDueDate("2026-11-04", "QUARTERLY", 1, 1)).toBe("2027-02-04");
    expect(nthDueDate("2026-11-04", "YEARLY", 1, 1)).toBe("2027-11-04");
    expect(nthDueDate("2026-11-04", "MONTHLY", 3, 1)).toBe("2027-02-04");
  });

  it("keeps the day of the month: 31 Jan is 28 Feb, then 31 Mar again", () => {
    expect(nthDueDate("2027-01-31", "MONTHLY", 1, 1)).toBe("2027-02-28");
    expect(nthDueDate("2027-01-31", "MONTHLY", 1, 2)).toBe("2027-03-31");
    expect(nthDueDate("2028-02-29", "YEARLY", 1, 1)).toBe("2029-02-28");
  });

  it("finds the next due date after a given day", () => {
    expect(dueDateAfter("2026-11-04", "MONTHLY", 1, "2026-11-04")).toBe("2026-12-04");
    expect(dueDateAfter("2026-11-04", "MONTHLY", 1, "2026-11-03")).toBe("2026-11-04");
    expect(dueDateAfter("2026-11-04", "WEEKLY", 1, "2027-01-01")).toBe("2027-01-06");
  });

  it("shifts days across month and year ends", () => {
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("describes the schedule", () => {
    expect(describeSchedule("MONTHLY", 1)).toBe("Every month");
    expect(describeSchedule("WEEKLY", 2)).toBe("Every 2 weeks");
    expect(describeSchedule("QUARTERLY", 1)).toBe("Every quarter");
  });

  it("validates a plan", () => {
    const ok = {
      customerId: "c1",
      addressId: "",
      assetId: "",
      title: "Monthly camera check",
      description: "",
      frequency: "MONTHLY",
      intervalCount: 1,
      leadDays: 7,
      startDate: "2026-12-01",
      endDate: "",
      checklistTemplateId: "",
      priority: "MEDIUM",
      isActive: true,
    };
    expect(maintenancePlanSchema.safeParse(ok).success).toBe(true);
    expect(maintenancePlanSchema.safeParse({ ...ok, endDate: "2026-11-01" }).success).toBe(false);
    expect(maintenancePlanSchema.safeParse({ ...ok, intervalCount: 0 }).success).toBe(false);
    expect(maintenancePlanSchema.safeParse({ ...ok, leadDays: 120 }).success).toBe(false);
    expect(maintenancePlanSchema.safeParse({ ...ok, frequency: "DAILY" }).success).toBe(false);
    expect(maintenancePlanSchema.safeParse({ ...ok, title: " " }).success).toBe(false);
  });
});
