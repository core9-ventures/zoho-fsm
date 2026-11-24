import { ok, route } from "@/lib/api";
import { holdInstallationSchema, installationsService } from "@/modules/installations";

/** POST /api/v1/field/installations/hold — saves a half-filled installation as ON_HOLD (a reason is required). */
export const POST = route(
  { roles: ["TECHNICIAN"], body: holdInstallationSchema, rateLimitPerMinute: 30 },
  async ({ db, user, body }) => ok(await installationsService.hold(db, user, body), "Put on hold.", 201),
);
