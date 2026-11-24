import { ok, route } from "@/lib/api";
import { holdInstallationSchema, installationsService } from "@/modules/installations";

/** PUT /api/v1/field/installations/{id}/hold — saves changes to the technician's own held record (stays on hold). */
export const PUT = route(
  { roles: ["TECHNICIAN"], body: holdInstallationSchema, rateLimitPerMinute: 30 },
  async ({ db, user, params, body }) => ok(await installationsService.hold(db, user, body, params.id), "Put on hold."),
);
