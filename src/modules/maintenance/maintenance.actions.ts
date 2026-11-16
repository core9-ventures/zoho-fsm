"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { maintenanceService } from "./maintenance.service";
import { maintenancePlanSchema, type MaintenancePlanInput } from "./maintenance.schema";
import { runAction } from "@/lib/action";
import type { ActionResult } from "@/lib/action-result";
import { idParam } from "@/lib/validation";

const ADMIN = ["ADMIN"] as const;

function done<T>(res: ActionResult<T>) {
  if (res.ok) {
    revalidatePath("/maintenance");
    revalidatePath("/work-orders", "layout");
  }
  return res;
}

/** Create when `id` is null, otherwise update. */
export async function saveMaintenancePlanAction(id: string | null, input: MaintenancePlanInput) {
  return done(
    await runAction(
      {
        roles: ADMIN,
        permission: id ? "maintenance:edit" : "maintenance:create",
        input: z.object({ id: idParam.nullable(), data: maintenancePlanSchema }),
      },
      { id, data: input },
      ({ db, user, input }) =>
        input.id
          ? maintenanceService.update(db, user, input.id, input.data)
          : maintenanceService.create(db, user, input.data),
    ),
  );
}

export async function setMaintenancePlanActiveAction(id: string, isActive: boolean) {
  return done(
    await runAction(
      { roles: ADMIN, permission: "maintenance:edit", input: z.object({ id: idParam, isActive: z.boolean() }) },
      { id, isActive },
      ({ db, input }) => maintenanceService.setActive(db, input.id, input.isActive),
    ),
  );
}

export async function deleteMaintenancePlanAction(id: string) {
  return done(
    await runAction(
      { roles: ADMIN, permission: "maintenance:delete", input: z.object({ id: idParam }) },
      { id },
      ({ db, input }) => maintenanceService.remove(db, input.id),
    ),
  );
}

/** "Create due work orders now": the same run the background worker does every morning. */
export async function runMaintenanceNowAction() {
  return done(
    await runAction({ roles: ADMIN, permission: "maintenance:edit", input: z.object({}) }, {}, ({ db }) =>
      maintenanceService.generateDue(db),
    ),
  );
}
