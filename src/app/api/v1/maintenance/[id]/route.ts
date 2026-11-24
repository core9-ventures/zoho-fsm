import { route } from "@/lib/api";
import { maintenanceService } from "@/modules/maintenance";

/** GET /api/v1/maintenance/{id} — one maintenance plan (Admin). */
export const GET = route({ roles: ["ADMIN"] }, ({ db, params }) => maintenanceService.get(db, params.id));
