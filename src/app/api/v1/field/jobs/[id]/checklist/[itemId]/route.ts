import { z } from "zod";
import { ok, route } from "@/lib/api";
import { fieldService } from "@/modules/field";

/** PUT /api/v1/field/jobs/{id}/checklist/{itemId} { isDone } — ticks or unticks a checklist item of my job. */
export const PUT = route(
  { roles: ["TECHNICIAN"], body: z.object({ isDone: z.boolean() }) },
  async ({ db, user, params, body }) => {
    await fieldService.setChecklist(db, user, params.id, params.itemId, body.isDone);
    return ok(null, "Saved.");
  },
);
