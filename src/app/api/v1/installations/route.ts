import { route } from "@/lib/api";
import { installationListQuerySchema, installationsService } from "@/modules/installations";

/** GET /api/v1/installations — every installation of the company (office view), newest first. */
export const GET = route(
  { roles: ["ADMIN", "DISPATCHER"], query: installationListQuerySchema },
  ({ db, user, query }) => installationsService.list(db, user, query),
);
