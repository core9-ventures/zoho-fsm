import { route } from "@/lib/api";
import { reportQuerySchema, reportsService, reportWorkbook } from "@/modules/reports";

/** GET /api/v1/reports/export?type=…&from=…&to=… — the same report as an Excel (.xlsx) download. */
export const GET = route({ roles: ["ADMIN", "DISPATCHER"], query: reportQuerySchema }, async ({ db, user, query }) => {
  const report = await reportsService.report(db, user, query);
  const company = user.companyId ? await db.company.findUnique({ where: { id: user.companyId } }) : null;
  const file = await reportWorkbook(report, company?.name ?? "FieldServe");
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="fieldserve-${report.type}-${report.from}_to_${report.to}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
