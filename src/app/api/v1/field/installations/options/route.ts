import { route } from "@/lib/api";
import { installationsService } from "@/modules/installations";

/** GET /api/v1/field/installations/options — the companies (customers) a technician can pick. */
export const GET = route({ roles: ["TECHNICIAN"] }, ({ db }) => installationsService.customerOptions(db));
