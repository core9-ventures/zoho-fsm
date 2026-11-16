import { route } from "@/lib/api";
import { reportQuerySchema, reportsService } from "@/modules/reports";

/** GET /api/v1/reports?type=work-orders|revenue|technicians&from=YYYY-MM-DD&to=YYYY-MM-DD — default: last 30 days. */
export const GET = route({ roles: ["ADMIN", "DISPATCHER"], query: reportQuerySchema }, ({ db, user, query }) =>
  reportsService.report(db, user, query),
);
