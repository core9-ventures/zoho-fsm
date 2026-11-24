import { ok, route } from "@/lib/api";
import { installationsService, putOnHoldSchema } from "@/modules/installations";

/** POST /api/v1/installations/{id}/hold — office puts a completed installation back on hold (body: { reason }). */
export const POST = route(
  { roles: ["ADMIN", "DISPATCHER"], body: putOnHoldSchema.omit({ id: true }), rateLimitPerMinute: 30 },
  async ({ db, user, params, body }) =>
    ok(await installationsService.putOnHold(db, user, params.id, body.reason), "Put on hold."),
);
