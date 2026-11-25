import { route } from "@/lib/api";
import { reportsService } from "@/modules/reports";

/** GET /api/v1/dashboard — the dashboard figures (visits today, open and overdue jobs, money for those who may see it). */
export const GET = route({ roles: ["ADMIN", "DISPATCHER"] }, ({ db, user }) => reportsService.kpis(db, user));
