import { route } from "@/lib/api";
import { rolesService } from "@/modules/roles";

/** GET /api/v1/roles — the company's custom roles with their permissions and member counts (Admin). */
export const GET = route({ roles: ["ADMIN"] }, ({ db }) => rolesService.list(db));
