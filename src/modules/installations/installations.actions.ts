"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { installationsService } from "./installations.service";
import { createInstallationSchema, type InstallationInput } from "./installations.schema";
import { runAction } from "@/lib/action";
import { idParam } from "@/lib/validation";

const FIELD = ["TECHNICIAN"] as const;
const OFFICE = ["ADMIN", "DISPATCHER"] as const;

/** A technician saves a new installation record; photos follow one by one through the upload API. */
export async function createInstallationAction(input: InstallationInput) {
  const res = await runAction(
    { roles: FIELD, permission: "field:create", input: createInstallationSchema },
    input,
    ({ db, user, input }) => installationsService.create(db, user, input),
  );
  if (res.ok) revalidatePath("/installations");
  return res;
}

export async function deleteInstallationAction(id: string) {
  const res = await runAction(
    { roles: OFFICE, permission: "workOrders:delete", input: z.object({ id: idParam }) },
    { id },
    ({ db, input }) => installationsService.remove(db, input.id),
  );
  if (res.ok) revalidatePath("/installations");
  return res;
}

/** Office staff correct a saved installation. */
export async function updateInstallationAction(id: string, input: InstallationInput) {
  const res = await runAction(
    { roles: OFFICE, permission: "workOrders:edit", input: createInstallationSchema },
    input,
    ({ db, input }) => installationsService.update(db, idParam.parse(id), input),
  );
  if (res.ok) revalidatePath("/installations", "layout");
  return res;
}

export async function deleteInstallationFileAction(id: string, attachmentId: string) {
  const res = await runAction(
    { roles: OFFICE, permission: "workOrders:edit", input: z.object({ id: idParam, attachmentId: idParam }) },
    { id, attachmentId },
    ({ db, user, input }) => installationsService.removeFile(db, user, input.id, input.attachmentId),
  );
  if (res.ok) revalidatePath("/installations", "layout");
  return res;
}
