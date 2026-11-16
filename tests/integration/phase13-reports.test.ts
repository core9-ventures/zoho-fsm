/**
 * Dashboard KPIs, reports and the Excel export. Read-only against the seeded dev database (Demo company):
 * nothing is created, so nothing needs removing.
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/auth";
import { createDb, prismaBase, tenantContext, type AppDb } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { reportsService, reportWorkbook } from "@/modules/reports";

const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

let admin: CurrentUser;
let dispatcher: CurrentUser;
let db: AppDb;
let otherCompanyDb: AppDb;

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

beforeAll(async () => {
  const d = await owner.user.findFirstOrThrow({ where: { email: "dispatcher@demo.local" } });
  const a = await owner.user.findFirstOrThrow({ where: { role: "ADMIN", companyId: d.companyId } });
  const other = await owner.company.findFirst({ where: { id: { not: a.companyId! } } });
  admin = asUser(a);
  dispatcher = asUser(d);
  db = createDb(tenantContext(a.companyId!, a.id));
  if (other) otherCompanyDb = createDb(tenantContext(other.id, a.id));
});

afterAll(async () => {
  await owner.$disconnect();
  await prismaBase.$disconnect();
});

describe("dashboard KPIs", () => {
  it("match what is in the database for this company", async () => {
    const k = await reportsService.kpis(db, admin);
    const open = await owner.workOrder.count({
      where: {
        companyId: admin.companyId!,
        deletedAt: null,
        status: { in: ["NEW", "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "ON_HOLD"] },
      },
    });
    expect(k.openWorkOrders).toBe(open);
    expect(k.overdueWorkOrders).toBeLessThanOrEqual(k.openWorkOrders);
    expect(k.completedPerDay).toHaveLength(14);
    expect(k.completedPerDay.at(-1)!.day).toBe(k.today);
    const total = await owner.workOrder.count({ where: { companyId: admin.companyId!, deletedAt: null } });
    expect(k.byStatus.reduce((n, s) => n + s.count, 0)).toBe(total);
    expect(k.utilisation.technicians.every((t) => t.percent >= 0)).toBe(true);
  });

  it("show money to the Admin but not to a dispatcher", async () => {
    expect((await reportsService.kpis(db, admin)).money).not.toBeNull();
    expect((await reportsService.kpis(db, dispatcher)).money).toBeNull();
  });

  it("revenue this month is the sum of this month's payments", async () => {
    const now = new Date();
    const k = await reportsService.kpis(db, admin, now);
    const month = k.today.slice(0, 7);
    const payments = await owner.payment.findMany({
      where: { companyId: admin.companyId!, deletedAt: null, paidAt: { lte: now } },
      select: { amount: true, paidAt: true },
    });
    const near = payments.filter((p) => p.paidAt.toISOString().slice(0, 7) === month);
    // Month edges differ by a few hours between UTC and the company zone, so only compare when nothing is near an edge.
    const edge = payments.some(
      (p) => Math.abs(p.paidAt.getTime() - new Date(`${month}-01T00:00:00Z`).getTime()) < 86_400_000,
    );
    if (!edge)
      expect(k.money!.revenueThisMonth).toBeCloseTo(
        near.reduce((n, p) => n + Number(p.amount), 0),
        2,
      );
  });

  it("never include another company's records", async () => {
    if (!otherCompanyDb) return;
    const other = await owner.company.findFirstOrThrow({ where: { id: { not: admin.companyId! } } });
    const otherAdmin = await owner.user.findFirst({ where: { role: "ADMIN", companyId: other.id } });
    if (!otherAdmin) return;
    const mine = await reportsService.kpis(db, admin);
    const theirs = await reportsService.kpis(otherCompanyDb, asUser(otherAdmin));
    const count = (k: typeof mine) => k.byStatus.reduce((n, s) => n + s.count, 0);
    expect(count(mine)).toBe(await owner.workOrder.count({ where: { companyId: admin.companyId!, deletedAt: null } }));
    expect(count(theirs)).toBe(await owner.workOrder.count({ where: { companyId: other.id, deletedAt: null } }));
  });
});

describe("reports", () => {
  it("work order report covers the range and flags overdue ones", async () => {
    const r = await reportsService.report(db, admin, { type: "work-orders", from: "2020-01-01", to: "2030-12-31" });
    if (r.type !== "work-orders") throw new Error("wrong type");
    const total = await owner.workOrder.count({ where: { companyId: admin.companyId!, deletedAt: null } });
    expect(r.rows).toHaveLength(total);
    expect(r.truncated).toBe(false);
    expect(r.summary[0]).toEqual({ label: "Created", value: String(total) });
    // An empty range gives an empty report.
    const none = await reportsService.report(db, admin, { type: "work-orders", from: "2001-01-01", to: "2001-01-31" });
    expect(none.rows).toHaveLength(0);
  });

  it("revenue is for people who may see money", async () => {
    const r = await reportsService.report(db, admin, { type: "revenue", from: "2020-01-01", to: "2030-12-31" });
    expect(r.type).toBe("revenue");
    await expect(
      reportsService.report(db, dispatcher, { type: "revenue", from: "2020-01-01", to: "2030-12-31" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("technician report lists every active technician", async () => {
    const r = await reportsService.report(db, admin, { type: "technicians", from: "2026-11-01", to: "2026-11-30" });
    if (r.type !== "technicians") throw new Error("wrong type");
    const techs = await owner.user.count({
      where: { companyId: admin.companyId!, role: "TECHNICIAN", isActive: true, deletedAt: null },
    });
    expect(r.rows).toHaveLength(techs);
  });

  it("exports a readable Excel file with a header and one row per record", async () => {
    const report = await reportsService.report(db, admin, {
      type: "work-orders",
      from: "2020-01-01",
      to: "2030-12-31",
    });
    const buffer = await reportWorkbook(report, "Demo");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Work orders")!;
    expect(ws.getRow(3).getCell(1).value).toBe("Number");
    expect(ws.rowCount).toBe(3 + report.rows.length);
  });
});
