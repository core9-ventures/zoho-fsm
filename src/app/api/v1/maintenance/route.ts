import { route } from "@/lib/api";
import { maintenanceService } from "@/modules/maintenance";

/** GET /api/v1/maintenance — every recurring maintenance plan of the company (Admin). */
export const GET = route({ roles: ["ADMIN"] }, ({ db }) => maintenanceService.list(db));
