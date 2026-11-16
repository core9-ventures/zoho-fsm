import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dbFor, requirePagePermission, requireUser } from "@/lib/auth";
import { formatCurrency, formatDay } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/roles";
import { reportsService } from "@/modules/reports";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Dashboard KPIs. Every number is read through the tenant client (one company only); the day and
 * month boundaries follow the company's time zone. Money is shown only to people who may see invoices.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  requirePagePermission(user, "/dashboard");
  const db = dbFor(user);
  const k = await reportsService.kpis(db, user);
  const money = (n: number) => formatCurrency(n, k.currency);
  const maxDone = Math.max(1, ...k.completedPerDay.map((d) => d.count));
  const change =
    k.money && k.money.revenueLastMonth > 0
      ? Math.round(((k.money.revenueThisMonth - k.money.revenueLastMonth) / k.money.revenueLastMonth) * 100)
      : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user.fullName.split(" ")[0]}</h1>
        <p className="text-muted-foreground text-sm">
          {user.customRoleName ?? ROLE_LABEL[user.role]} · {formatDay(k.today)} · {k.timeZone}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Visits today" value={k.visitsToday} hint={`${k.visitsDoneToday} done`} href="/dispatch" />
        <Stat label="Open work orders" value={k.openWorkOrders} hint="Not yet completed" href="/work-orders" />
        <Stat
          label="Overdue work orders"
          value={k.overdueWorkOrders}
          hint="Past the due date"
          alert={k.overdueWorkOrders > 0}
          href="/work-orders"
        />
        <Stat label="Waiting for QA" value={k.awaitingQa} hint="Completed, not closed" href="/work-orders" />
      </div>

      {k.money && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Revenue this month"
            text={money(k.money.revenueThisMonth)}
            hint={change === null ? "Payments received" : `${change >= 0 ? "+" : ""}${change}% vs last month`}
            href="/reports?type=revenue"
          />
          <Stat
            label="Invoiced this month"
            text={money(k.money.invoicedThisMonth)}
            hint="Issued invoices"
            href="/invoices"
          />
          <Stat label="Outstanding" text={money(k.money.outstanding)} hint="Unpaid balance" href="/invoices" />
          <Stat
            label="Overdue invoices"
            text={money(k.money.overdue)}
            hint="Past the due date"
            alert={k.money.overdue > 0}
            href="/invoices"
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Completed work orders, last 14 days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-32 items-end gap-1" role="img" aria-label="Completed work orders per day">
              {k.completedPerDay.map((d) => (
                <div
                  key={d.day}
                  className="flex flex-1 flex-col items-center justify-end gap-1"
                  title={`${formatDay(d.day)}: ${d.count}`}
                >
                  <span className="text-muted-foreground text-[10px] tabular-nums">{d.count || ""}</span>
                  <div
                    className="bg-primary w-full rounded-t"
                    style={{
                      height: `${Math.max(d.count ? 8 : 2, (d.count / maxDone) * 96)}px`,
                      opacity: d.count ? 1 : 0.2,
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
              <span>{formatDay(k.completedPerDay[0].day)}</span>
              <span>{formatDay(k.completedPerDay[13].day)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Technician utilisation, last 30 days</CardTitle>
            <CardDescription>
              Time on site against 8 working hours on weekdays. Company average: {k.utilisation.average}%.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {k.utilisation.technicians.length === 0 && (
              <p className="text-muted-foreground text-sm">No active technicians.</p>
            )}
            {k.utilisation.technicians.slice(0, 8).map((t) => (
              <div key={t.technicianId} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{t.name}</span>
                  <span className="tabular-nums">{t.percent}%</span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div className="bg-primary h-full" style={{ width: `${Math.min(100, t.percent)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Work orders by status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {k.byStatus.length === 0 && <p className="text-muted-foreground text-sm">No work orders yet.</p>}
          {k.byStatus.map((g) => (
            <Badge key={g.status} variant="secondary" className="text-sm">
              {g.status.replace("_", " ").toLowerCase()} · {g.count}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  text,
  hint,
  alert,
  href,
}: {
  label: string;
  value?: number;
  text?: string;
  hint: string;
  alert?: boolean;
  href: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="hover:bg-accent/40 h-full transition-colors">
        <CardHeader className="pb-2">
          <CardDescription>{label}</CardDescription>
          <CardTitle className={`text-3xl tabular-nums ${alert ? "text-red-600" : ""}`}>{text ?? value}</CardTitle>
          <p className="text-muted-foreground text-xs">{hint}</p>
        </CardHeader>
      </Card>
    </Link>
  );
}
