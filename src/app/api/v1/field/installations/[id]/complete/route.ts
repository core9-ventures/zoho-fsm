import { ok, route } from "@/lib/api";
import { createInstallationSchema, installationsService } from "@/modules/installations";

/** POST /api/v1/field/installations/{id}/complete — finishes a held record (all fields are checked, the position is required). */
export const POST = route(
  { roles: ["TECHNICIAN"], body: createInstallationSchema, rateLimitPerMinute: 30 },
  async ({ db, user, params, body }) =>
    ok(await installationsService.completeHeld(db, user, params.id, body), "Installation saved."),
);
