import { Link } from "react-router-dom";
import { dashboardApi } from "../../api";
import { useAsync } from "../../data/useAsync";
import { formatDay } from "../../lib/format";
import { STATUS_LABEL } from "../../lib/status";
import { useSession } from "../../session";
import { LoadError, Spinner } from "../../ui/kit";
import { PageHeader, Section, Stat, useMoney } from "../../ui/parts";

function Tile({ to, ...props }: { to: string; label: string; value: React.ReactNode; tone?: "red" | "green" }) {
  return (
    <Link to={to} className="block">
      <Stat {...props} />
    </Link>
  );
}

/** The day at a glance: today's visits, open and overdue jobs, money, technician utilisation. */
export function Dashboard() {
  const { user } = useSession();
  const money = useMoney();
  const { data: k, error, loading, reload } = useAsync(() => dashboardApi.get());

  if (!k) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;

  const maxDone = Math.max(1, ...k.completedPerDay.map((d) => d.count));
  const change =
    k.money && k.money.revenueLastMonth > 0
      ? Math.round(((k.money.revenueThisMonth - k.money.revenueLastMonth) / k.money.revenueLastMonth) * 100)
      : null;

  return (
    <div className="space-y-4">
      <PageHeader title={`Welcome, ${user?.fullName.split(" ")[0] ?? ""}`} subtitle={`${formatDay(k.today)} · ${k.timeZone}`} />
      {error && <LoadError error={error} onRetry={() => void reload()} />}

      <div className="grid grid-cols-2 gap-2">
        <Tile to="/dispatch" label="Visits today" value={`${k.visitsToday} (${k.visitsDoneToday} done)`} />
        <Tile to="/work-orders" label="Open work orders" value={k.openWorkOrders} />
        <Tile to="/work-orders" label="Overdue" value={k.overdueWorkOrders} tone={k.overdueWorkOrders > 0 ? "red" : undefined} />
        <Tile to="/work-orders" label="Waiting for QA" value={k.awaitingQa} />
      </div>

      {k.money && (
        <Section title="Money">
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label={`Revenue this month${change != null ? ` (${change >= 0 ? "+" : ""}${change}%)` : ""}`}
              value={money(k.money.revenueThisMonth)}
              tone="green"
            />
            <Stat label="Last month" value={money(k.money.revenueLastMonth)} />
            <Stat label="Invoiced this month" value={money(k.money.invoicedThisMonth)} />
            <Stat label="Outstanding" value={money(k.money.outstanding)} />
          </div>
          {k.money.overdue > 0 && (
            <Link to="/invoices" className="text-destructive text-sm font-medium underline">
              {money(k.money.overdue)} is overdue
            </Link>
          )}
        </Section>
      )}

      <Section title="Technician utilisation" right={<span className="text-muted-foreground text-xs">{formatDay(k.utilisation.from)} – {formatDay(k.utilisation.to)}</span>}>
        <p className="text-sm">
          Average <span className="font-semibold">{k.utilisation.average}%</span>
        </p>
        {k.utilisation.technicians.length === 0 && <p className="text-muted-foreground text-sm">No technicians yet.</p>}
        <ul className="space-y-2">
          {k.utilisation.technicians.map((t) => (
            <li key={t.technicianId} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{t.name}</span>
                <span className="text-muted-foreground tabular-nums">{t.percent}%</span>
              </div>
              <div className="bg-muted h-2 overflow-hidden rounded-full" role="img" aria-label={`${t.name} ${t.percent}%`}>
                <div className="bg-primary h-full rounded-full" style={{ width: `${Math.min(100, t.percent)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Completed per day">
        <div className="flex h-28 items-end gap-1" role="img" aria-label="Completed work orders per day">
          {k.completedPerDay.map((d) => (
            <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-muted-foreground text-[10px] tabular-nums">{d.count || ""}</span>
              <div className="bg-primary w-full rounded-t" style={{ height: `${(d.count / maxDone) * 100}%`, minHeight: d.count ? 4 : 1 }} />
            </div>
          ))}
        </div>
        <div className="text-muted-foreground flex justify-between text-[10px]">
          <span>{k.completedPerDay[0] ? formatDay(k.completedPerDay[0].day) : ""}</span>
          <span>{k.completedPerDay.at(-1) ? formatDay(k.completedPerDay.at(-1)!.day) : ""}</span>
        </div>
      </Section>

      <Section title="Work orders by status">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {k.byStatus.map((s) => (
            <li key={s.status} className="flex justify-between">
              <span className="text-muted-foreground">{STATUS_LABEL[s.status] ?? s.status}</span>
              <span className="tabular-nums">{s.count}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
