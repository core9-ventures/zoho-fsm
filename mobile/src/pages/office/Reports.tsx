import { useState } from "react";
import { Download } from "lucide-react";
import { ApiError, reportsApi, type Report, type ReportType } from "../../api";
import { useAsync } from "../../data/useAsync";
import { saveFile } from "../../lib/files";
import { Badge, Button, LoadError, Spinner, inputClass } from "../../ui/kit";
import { PageHeader, Section, Stat, useMoney } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { REPORT_LABEL, REPORT_TYPES } from "@/modules/reports/reports.schema";

/** Work orders, revenue and technician reports for a date range, with an Excel download. */
export function Reports() {
  const toast = useToast();
  const money = useMoney();
  const [type, setType] = useState<ReportType>("work-orders");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);

  const range = from && to && from > to ? "The start date is after the end date." : "";
  const { data: report, error, loading, reload } = useAsync<Report | null>(
    () => (range ? Promise.resolve(null) : reportsApi.get(type, from || undefined, to || undefined)),
    [type, from, to],
  );

  async function exportExcel() {
    if (!report) return;
    setExporting(true);
    try {
      const blob = await reportsApi.excel(type, from || undefined, to || undefined);
      await saveFile(blob, `fieldserve-${report.type}-${report.from}_to_${report.to}.xlsx`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not export the report.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle={report ? `${report.from} to ${report.to}` : undefined} />

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Report">
        {REPORT_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={type === t}
            onClick={() => setType(t)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${type === t ? "bg-primary text-primary-foreground border-transparent" : "bg-card"}`}
          >
            {REPORT_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs font-medium">
          From
          <input type="date" value={from || report?.from || ""} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1 text-xs font-medium">
          To
          <input type="date" value={to || report?.to || ""} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </label>
      </div>
      {range && (
        <p role="alert" className="text-destructive text-sm">
          {range}
        </p>
      )}

      {loading && !report ? (
        <Spinner />
      ) : error ? (
        <LoadError error={error} onRetry={() => void reload()} />
      ) : report ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {report.summary.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} />
            ))}
          </div>

          <Button variant="outline" busy={exporting} onClick={() => void exportExcel()}>
            <Download className="size-4" /> Export to Excel
          </Button>
          {report.truncated && (
            <p className="text-muted-foreground text-xs">Only the first rows are shown. The Excel file has the whole report.</p>
          )}

          {report.rows.length === 0 && <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">Nothing in this period.</p>}

          {report.type === "work-orders" && (
            <ul className="space-y-2">
              {report.rows.map((r) => (
                <li key={r.number} className="bg-card space-y-1 rounded-xl border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground font-mono text-xs">{r.number}</span>
                    <Badge>{r.status}</Badge>
                    {r.overdue && <Badge tone="red">Overdue</Badge>}
                  </div>
                  <p className="font-medium">{r.title}</p>
                  <p className="text-muted-foreground">{[r.customer, r.site].filter(Boolean).join(" · ")}</p>
                  <p className="text-muted-foreground text-xs">
                    {[r.technician && `Technician ${r.technician}`, r.priority, r.due && `due ${r.due}`, r.completed && `completed ${r.completed}`].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {report.type === "revenue" && (
            <>
              <Section title="By payment method">
                <ul className="space-y-1.5 text-sm">
                  {report.byMethod.map((m) => (
                    <li key={m.method} className="flex justify-between">
                      <span className="text-muted-foreground">{m.method}</span>
                      <span className="tabular-nums">{money(m.amount)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between border-t pt-1.5">
                    <span className="text-muted-foreground">Invoiced in this period</span>
                    <span className="tabular-nums">{money(report.invoiced)}</span>
                  </li>
                </ul>
              </Section>
              <ul className="space-y-2">
                {report.rows.map((r, n) => (
                  <li key={`${r.invoiceNumber}-${n}`} className="bg-card flex justify-between gap-3 rounded-xl border p-3 text-sm">
                    <span>
                      <span className="font-medium">{r.customer}</span>
                      <span className="text-muted-foreground block text-xs">
                        {r.invoiceNumber} · {r.method} · {r.paidAt}
                        {r.reference ? ` · ${r.reference}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {report.type === "technicians" && (
            <ul className="space-y-2">
              {report.rows.map((r) => (
                <li key={r.technician} className="bg-card space-y-1 rounded-xl border p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{r.technician}</span>
                    <span className="text-muted-foreground tabular-nums">{r.utilisationPercent}% utilised</span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {r.completedVisits}/{r.visits} visits done · {r.trackedHours} h on site · {r.averageMinutes} min per visit
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
