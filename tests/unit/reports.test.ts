import { describe, expect, it } from "vitest";
import {
  addDaysTo,
  daysBetween,
  reportQuerySchema,
  resolveRange,
  utilisationPercent,
  weekdaysBetween,
} from "@/modules/reports/reports.schema";

describe("report ranges", () => {
  it("counts days and weekdays, both ends included", () => {
    expect(daysBetween("2026-11-01", "2026-11-30")).toBe(30);
    expect(daysBetween("2026-11-04", "2026-11-04")).toBe(1);
    // 2026-11-02 is a Monday: Mon to Sun is 7 days, 5 of them weekdays.
    expect(weekdaysBetween("2026-11-02", "2026-11-08")).toBe(5);
    expect(weekdaysBetween("2026-11-07", "2026-11-08")).toBe(0);
  });

  it("shifts days across month and year ends", () => {
    expect(addDaysTo("2026-12-30", 5)).toBe("2027-01-04");
    expect(addDaysTo("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("defaults to the last 30 days ending today", () => {
    expect(resolveRange({}, "2026-11-30")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(resolveRange({ from: "2026-10-01" }, "2026-11-30")).toEqual({ from: "2026-10-01", to: "2026-11-30" });
    expect(resolveRange({ to: "2026-11-10" }, "2026-11-30")).toEqual({ from: "2026-10-12", to: "2026-11-10" });
  });

  it("utilisation is tracked time against 8 working hours on weekdays", () => {
    // One work week = 5 × 480 = 2400 minutes available.
    expect(utilisationPercent(1200, "2026-11-02", "2026-11-08")).toBe(50);
    expect(utilisationPercent(2400, "2026-11-02", "2026-11-08")).toBe(100);
    expect(utilisationPercent(3000, "2026-11-02", "2026-11-08")).toBe(125); // overtime is not hidden
    expect(utilisationPercent(100, "2026-11-07", "2026-11-08")).toBe(0); // a weekend has no capacity
  });

  it("validates the report query", () => {
    expect(reportQuerySchema.safeParse({}).success).toBe(true);
    expect(reportQuerySchema.parse({}).type).toBe("work-orders");
    expect(reportQuerySchema.safeParse({ type: "revenue", from: "2026-11-01", to: "2026-11-30" }).success).toBe(true);
    expect(reportQuerySchema.safeParse({ type: "secrets" }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: "01/11/2026" }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: "2026-11-10", to: "2026-11-01" }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: "2024-01-01", to: "2026-11-01" }).success).toBe(false);
  });
});
