-- Maintenance plans: optional checklist and priority for the work orders they create.
ALTER TABLE "MaintenancePlan" ADD COLUMN "checklistTemplateId" TEXT;
ALTER TABLE "MaintenancePlan" ADD COLUMN "priority" "Priority" NOT NULL DEFAULT 'MEDIUM';

-- Safety net for "exactly once": one live work order per plan and due date, even if two workers race.
CREATE UNIQUE INDEX "WorkOrder_maintenancePlanId_dueDate_key"
  ON "WorkOrder" ("maintenancePlanId", "dueDate")
  WHERE "maintenancePlanId" IS NOT NULL AND "deletedAt" IS NULL AND "dueDate" IS NOT NULL;
