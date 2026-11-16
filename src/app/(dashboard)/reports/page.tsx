import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dbFor, requirePagePermission, requireRole, requireUser } from "@/lib/auth";
import { formatCurrency } from "@/lib/format";
import { canSeeMoney, REPORT_LABEL, REPORT_TYPES, reportQuerySchema, reportsService } from "@/modules/reports";

export const metadata: Metadata = { title: "Reports" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await requireUser();
  requireRole(user, ["ADMIN", "DISPATCHER"]);
  requirePagePermission(user, "/reports");
  const db = dbFor(user);

  const parsed = reportQuerySchema.safeParse({
    type: typeof sp.type === "string" ? sp.type : undefined,
    from: typeof sp.from === "string" && sp.from ? sp.from : undefined,
    to: typeof sp.to === "string" && sp.to ? sp.to : undefined,
  });
  const types = REPORT_TYPES.filter((t) => t !== "revenue" || canSeeMoney(user));
  const error = parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check the dates.");
  const query = parsed.success ? parsed.data : reportQuerySchema.parse({});
  const report = types.includes(query.type)
    ? await reportsService.report(db, user, query)
    : await reportsService.report(db, user, { type: "work-orders" });
  const company = user.companyId ? await db.company.findUnique({ where: { id: user.companyId } }) : null;
  const money = (n: number) => formatCurrency(n, company?.currency ?? "USD");
  const exportHref = `/api/v1/reports/export?type=${report.type}&from=${report.from}&to=${report.to}`;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm">
            Pick a report and a date range (days in your company time zone), then download it as Excel.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href={exportHref}>
            <Download className="size-4" /> Export to Excel
          </a>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <Link
            key={t}
            href={`/reports?type=${t}&from=${report.from}&to=${report.to}`}
            className={`rounded-md border px-3 py-1.5 text-sm ${t === report.type ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {REPORT_LABEL[t]}
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="type" value={report.type} />
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground text-xs">From</span>
          <Input type="date" name="from" defaultValue={report.from} className="w-44" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground text-xs">To</span>
          <Input type="date" name="to" defaultValue={report.to} className="w-44" />
        </label>
        <Button type="submit">Show</Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <div className="grid gap-3 sm:grid-cols-3">
        {report.summary.map((s) => (
          <Card key={s.label} className="py-0">
            <CardContent className="space-y-0.5 py-4">
              <p className="text-muted-foreground text-xs font-medium">{s.label}</p>
              <p className="text-2xl font-semibold tabular-nums">
                {report.type === "revenue" && (s.label === "Collected" || s.label === "Invoiced")
                  ? money(Number(s.value))
                  : s.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {report.truncated && (
        <p className="text-sm text-amber-700">Showing the first 5,000 rows. Narrow the dates to see the rest.</p>
      )}

      <Card className="py-0">
        <CardContent className="p-0">
          {report.rows.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center text-sm">Nothing in this range.</p>
          ) : report.type === "work-orders" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Technician</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.number}>
                    <TableCell className="font-medium">{r.number}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell>{r.customer}</TableCell>
                    <TableCell>{r.technician || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={r.overdue ? "destructive" : "secondary"}>
                        {r.overdue ? "Overdue" : r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.created}</TableCell>
                    <TableCell>{r.due || "—"}</TableCell>
                    <TableCell>{r.completed || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : report.type === "revenue" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paid at</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r, i) => (
                  <TableRow key={`${r.invoiceNumber}-${i}`}>
                    <TableCell>{r.paidAt}</TableCell>
                    <TableCell className="font-medium">{r.invoiceNumber}</TableCell>
                    <TableCell>{r.customer}</TableCell>
                    <TableCell>{r.method}</TableCell>
                    <TableCell>{r.reference || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Technician</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Completed</TableHead>
                  <TableHead className="text-right">Tracked hours</TableHead>
                  <TableHead className="text-right">Avg minutes / visit</TableHead>
                  <TableHead className="text-right">Utilisation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.technician}>
                    <TableCell className="font-medium">{r.technician}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.visits}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.completedVisits}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.trackedHours}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.averageMinutes}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.utilisationPercent}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
