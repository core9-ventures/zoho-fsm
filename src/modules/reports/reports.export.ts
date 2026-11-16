import "server-only";
import ExcelJS from "exceljs";
import { REPORT_LABEL, type Report } from "./reports.schema";

type Column = { header: string; key: string; width: number; numFmt?: string };

/** An .xlsx file for one report: a header row, the rows, and frozen, filterable headers. */
export async function reportWorkbook(report: Report, company: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FieldServe";
  wb.created = new Date();
  const ws = wb.addWorksheet(REPORT_LABEL[report.type]);

  let columns: Column[];
  let rows: object[];
  if (report.type === "work-orders") {
    columns = [
      { header: "Number", key: "number", width: 14 },
      { header: "Title", key: "title", width: 38 },
      { header: "Customer", key: "customer", width: 26 },
      { header: "Site", key: "site", width: 26 },
      { header: "Technician", key: "technician", width: 22 },
      { header: "Status", key: "status", width: 14 },
      { header: "Priority", key: "priority", width: 10 },
      { header: "Created", key: "created", width: 12 },
      { header: "Due", key: "due", width: 12 },
      { header: "Completed", key: "completed", width: 12 },
      { header: "Overdue", key: "overdue", width: 9 },
    ];
    rows = report.rows.map((r) => ({ ...r, overdue: r.overdue ? "Yes" : "" }));
  } else if (report.type === "revenue") {
    columns = [
      { header: "Paid at", key: "paidAt", width: 18 },
      { header: "Invoice", key: "invoiceNumber", width: 14 },
      { header: "Customer", key: "customer", width: 28 },
      { header: "Method", key: "method", width: 16 },
      { header: "Reference", key: "reference", width: 22 },
      { header: `Amount (${report.currency})`, key: "amount", width: 16, numFmt: "#,##0.00" },
    ];
    rows = report.rows;
  } else {
    columns = [
      { header: "Technician", key: "technician", width: 26 },
      { header: "Visits", key: "visits", width: 10 },
      { header: "Completed visits", key: "completedVisits", width: 16 },
      { header: "Tracked hours", key: "trackedHours", width: 14, numFmt: "0.0" },
      { header: "Avg minutes per visit", key: "averageMinutes", width: 20 },
      { header: "Utilisation %", key: "utilisationPercent", width: 14 },
    ];
    rows = report.rows;
  }

  ws.addRow([`${company} · ${REPORT_LABEL[report.type]} · ${report.from} to ${report.to}`]).font = { bold: true, size: 12 };
  ws.addRow([]);
  const headerRow = ws.addRow(columns.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  });
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
    if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
  });
  for (const row of rows) ws.addRow(columns.map((c) => (row as Record<string, unknown>)[c.key]));
  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
