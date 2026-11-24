import { useState } from "react";
import { maintenanceApi, ApiError } from "../../api";
import { useAsync } from "../../data/useAsync";
import { formatDay } from "../../lib/format";
import { Badge, Button, LoadError, Spinner } from "../../ui/kit";
import { PageHeader, Section } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { FREQUENCY_LABEL } from "@/modules/maintenance/maintenance.schema";

/** Recurring maintenance plans (Admin). Each plan can be switched on or off here. */
export function Maintenance() {
  const toast = useToast();
  const { data: plans, error, loading, reload } = useAsync(() => maintenanceApi.list());
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!plans) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;

  async function toggle(id: string, on: boolean) {
    setBusyId(id);
    try {
      await maintenanceApi.setActive(id, on);
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Maintenance" subtitle={`${plans.length} plan${plans.length === 1 ? "" : "s"}`} />
      {plans.length === 0 && <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">No maintenance plans yet.</p>}
      {plans.map((p) => (
        <Section key={p.id}>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{p.title}</p>
              <Badge tone={p.isActive ? "green" : "muted"}>{p.isActive ? "Active" : "Off"}</Badge>
              {p.priority === "HIGH" && <Badge tone="red">High</Badge>}
            </div>
            <p className="text-muted-foreground text-sm">
              {[p.customerName, p.siteLabel, p.assetName].filter(Boolean).join(" · ")}
            </p>
            <p className="text-muted-foreground text-xs">
              Every {p.intervalCount > 1 ? `${p.intervalCount} ` : ""}
              {FREQUENCY_LABEL[p.frequency].toLowerCase()} · next due {formatDay(p.nextDueDate)}
              {p.nextCreateOn ? ` · work order created ${formatDay(p.nextCreateOn)}` : ""}
            </p>
            <p className="text-muted-foreground text-xs">
              {p.generatedCount} work order{p.generatedCount === 1 ? "" : "s"} created
              {p.lastWorkOrder ? ` · last ${p.lastWorkOrder.number}` : ""}
            </p>
          </div>
          <Button variant="outline" busy={busyId === p.id} onClick={() => void toggle(p.id, !p.isActive)} className="w-full py-2">
            {p.isActive ? "Switch off" : "Switch on"}
          </Button>
        </Section>
      ))}
    </div>
  );
}
