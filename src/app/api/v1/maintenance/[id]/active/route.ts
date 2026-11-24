import { z } from "zod";
import { route } from "@/lib/api";
import { maintenanceService } from "@/modules/maintenance";

/** POST /api/v1/maintenance/{id}/active { isActive } — switches a plan on or off (Admin). */
export const POST = route({ roles: ["ADMIN"], body: z.object({ isActive: z.boolean() }) }, ({ db, params, body }) =>
  maintenanceService.setActive(db, params.id, body.isActive),
);
