"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, PlayCircle, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { handleResult } from "@/components/forms/apply-server-errors";
import { Field, NativeSelect } from "@/components/forms/field";
import { JobTargetFields } from "@/components/forms/job-target-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITY_LABEL } from "@/lib/statuses";
import type { ChecklistTemplateOption } from "@/modules/checklists/checklists.schema";
import type { CustomerOption } from "@/modules/customers/customers.schema";
import {
  deleteMaintenancePlanAction,
  runMaintenanceNowAction,
  saveMaintenancePlanAction,
  setMaintenancePlanActiveAction,
} from "@/modules/maintenance/maintenance.actions";
import {
  FREQUENCIES,
  FREQUENCY_LABEL,
  maintenancePlanSchema,
  type MaintenancePlanDto,
  type MaintenancePlanInput,
} from "@/modules/maintenance/maintenance.schema";

const today = () => new Date().toISOString().slice(0, 10);

const blank = (): MaintenancePlanInput => ({
  customerId: "",
  addressId: "",
  assetId: "",
  title: "",
  description: "",
  frequency: "MONTHLY",
  intervalCount: 1,
  leadDays: 7,
  startDate: today(),
  endDate: "",
  checklistTemplateId: "",
  priority: "MEDIUM",
  isActive: true,
});

const fromPlan = (p: MaintenancePlanDto): MaintenancePlanInput => ({
  customerId: p.customerId,
  addressId: p.addressId ?? "",
  assetId: p.assetId ?? "",
  title: p.title,
  description: p.description,
  frequency: p.frequency,
  intervalCount: p.intervalCount,
  leadDays: p.leadDays,
  startDate: p.startDate,
  endDate: p.endDate ?? "",
  checklistTemplateId: p.checklistTemplateId ?? "",
  priority: p.priority,
  isActive: p.isActive,
});

function PlanSheet({
  open,
  onOpenChange,
  plan,
  customers,
  templates,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  plan?: MaintenancePlanDto;
  customers: CustomerOption[];
  templates: ChecklistTemplateOption[];
}) {
  const form = useForm<MaintenancePlanInput>({
    resolver: zodResolver(maintenancePlanSchema) as unknown as Resolver<MaintenancePlanInput>,
    defaultValues: blank(),
  });
  const { register, handleSubmit, reset, setError, setValue, watch, formState } = form;
  const e = formState.errors;

  useEffect(() => {
    if (open) reset(plan ? fromPlan(plan) : blank());
  }, [open, plan, reset]);

  const onSubmit = handleSubmit(async (v) => {
    const res = await saveMaintenancePlanAction(plan?.id ?? null, v);
    if (handleResult(res, setError as never, plan ? "Plan saved." : "Plan created.")) onOpenChange(false);
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{plan ? `Edit ${plan.title}` : "New maintenance plan"}</SheetTitle>
          <SheetDescription>
            The first work order is due on the start date; the next ones follow the schedule.
          </SheetDescription>
        </SheetHeader>
        <form id="plan-form" onSubmit={onSubmit} noValidate className="space-y-4 px-4">
          <JobTargetFields form={form} customers={customers} idPrefix="plan" />
          <Field label="Title" htmlFor="plan-title" error={e.title?.message}>
            <Input id="plan-title" placeholder="Monthly camera check" {...register("title")} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Repeats" htmlFor="plan-freq">
              <NativeSelect id="plan-freq" {...register("frequency")}>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Every" htmlFor="plan-interval" hint="1 = every period" error={e.intervalCount?.message}>
              <Input
                id="plan-interval"
                type="number"
                min={1}
                max={52}
                {...register("intervalCount", { valueAsNumber: true })}
              />
            </Field>
            <Field label="Start date" htmlFor="plan-start" error={e.startDate?.message}>
              <Input id="plan-start" type="date" {...register("startDate")} />
            </Field>
            <Field label="End date" htmlFor="plan-end" hint="Optional" error={e.endDate?.message}>
              <Input id="plan-end" type="date" {...register("endDate")} />
            </Field>
            <Field
              label="Create work order"
              htmlFor="plan-lead"
              hint="days before it is due"
              error={e.leadDays?.message}
            >
              <Input id="plan-lead" type="number" min={0} max={90} {...register("leadDays", { valueAsNumber: true })} />
            </Field>
            <Field label="Priority" htmlFor="plan-priority">
              <NativeSelect id="plan-priority" {...register("priority")}>
                {(["HIGH", "MEDIUM", "LOW"] as const).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Checklist" htmlFor="plan-template" error={e.checklistTemplateId?.message}>
            <NativeSelect id="plan-template" {...register("checklistTemplateId")}>
              <option value="">No checklist</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.itemCount})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Description"
            htmlFor="plan-desc"
            hint="Copied onto each work order"
            error={e.description?.message}
          >
            <Textarea id="plan-desc" rows={3} {...register("description")} />
          </Field>
          <div className="flex items-center gap-2">
            <Switch
              id="plan-active"
              checked={watch("isActive")}
              onCheckedChange={(v) => setValue("isActive", v, { shouldDirty: true })}
            />
            <Label htmlFor="plan-active" className="font-normal">
              Active
            </Label>
          </div>
        </form>
        <SheetFooter>
          <Button type="submit" form="plan-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting && <Loader2 className="animate-spin" />}
            {plan ? "Save plan" : "Create plan"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function NewPlanButton({
  customers,
  templates,
}: {
  customers: CustomerOption[];
  templates: ChecklistTemplateOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New plan
      </Button>
      <PlanSheet open={open} onOpenChange={setOpen} customers={customers} templates={templates} />
    </>
  );
}

export function RunNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await runMaintenanceNowAction();
        setBusy(false);
        if (!res.ok) return void toast.error(res.error);
        const n = res.data.created.length;
        toast.success(
          n === 0
            ? "Nothing is due yet."
            : `Created ${n} work order${n === 1 ? "" : "s"}: ${res.data.created.map((c) => c.number).join(", ")}.`,
        );
        router.refresh();
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <PlayCircle />} Create due work orders
    </Button>
  );
}

export function PlanActions({
  plan,
  customers,
  templates,
}: {
  plan: MaintenancePlanDto;
  customers: CustomerOption[];
  templates: ChecklistTemplateOption[];
}) {
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const close = (o: boolean) => !o && setDialog(null);
  return (
    <div className="flex shrink-0 gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={plan.isActive ? `Pause ${plan.title}` : `Resume ${plan.title}`}
        onClick={async () => {
          const res = await setMaintenancePlanActiveAction(plan.id, !plan.isActive);
          if (!res.ok) toast.error(res.error);
          else toast.success(plan.isActive ? "Plan paused." : "Plan resumed.");
        }}
      >
        {plan.isActive ? <Pause /> : <Play />}
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Edit ${plan.title}`} onClick={() => setDialog("edit")}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Delete ${plan.title}`} onClick={() => setDialog("delete")}>
        <Trash2 />
      </Button>
      <PlanSheet
        open={dialog === "edit"}
        onOpenChange={close}
        plan={plan}
        customers={customers}
        templates={templates}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={close}
        title={`Delete ${plan.title}?`}
        description="No more work orders will be created. The ones it already made stay."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const res = await deleteMaintenancePlanAction(plan.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Plan deleted.");
        }}
      />
    </div>
  );
}
