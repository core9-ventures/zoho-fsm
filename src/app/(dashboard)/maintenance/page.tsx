import { CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NewPlanButton, PlanActions, RunNowButton } from "./maintenance-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { dbFor, requirePagePermission, requireRole, requireUser } from "@/lib/auth";
import { PRIORITY_LABEL } from "@/lib/statuses";
import { checklistsService } from "@/modules/checklists";
import { customersService } from "@/modules/customers";
import { describeSchedule, maintenanceService } from "@/modules/maintenance";

export const metadata: Metadata = { title: "Maintenance plans" };

export default async function MaintenancePage() {
  const user = await requireUser();
  requireRole(user, ["ADMIN"]);
  requirePagePermission(user, "/maintenance");
  const db = dbFor(user);
  const [plans, customers, templates] = await Promise.all([
    maintenanceService.list(db),
    customersService.options(db),
    checklistsService.options(db),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Maintenance plans</h1>
          <p className="text-muted-foreground text-sm">
            Recurring service. A work order is created automatically before each due date, once.
          </p>
        </div>
        <div className="flex gap-2">
          <RunNowButton />
          <NewPlanButton customers={customers} templates={templates} />
        </div>
      </div>

      {plans.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
            <CalendarClock className="size-8 opacity-50" />
            No plans yet. Add one for a customer or an asset, for example &quot;Monthly camera check&quot;.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((p) => (
          <Card key={p.id} className={p.isActive ? undefined : "opacity-60"}>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.title}</div>
                  <div className="text-muted-foreground truncate text-sm">
                    {p.customerName}
                    {p.siteLabel ? ` · ${p.siteLabel}` : ""}
                    {p.assetName ? ` · ${p.assetName}` : ""}
                  </div>
                </div>
                <PlanActions plan={p} customers={customers} templates={templates} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{describeSchedule(p.frequency, p.intervalCount)}</Badge>
                <Badge variant="outline">{PRIORITY_LABEL[p.priority]}</Badge>
                {!p.isActive && <Badge variant="outline">Paused</Badge>}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">Next due</dt>
                  <dd>{p.nextDueDate}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Work order created on</dt>
                  <dd>{p.nextCreateOn ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Created so far</dt>
                  <dd>{p.generatedCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Latest</dt>
                  <dd>
                    {p.lastWorkOrder ? (
                      <Link href={`/work-orders/${p.lastWorkOrder.id}`} className="hover:underline">
                        {p.lastWorkOrder.number}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
