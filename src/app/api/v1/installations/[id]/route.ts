import { ok, route } from "@/lib/api";
import { createInstallationSchema, installationsService } from "@/modules/installations";

/** GET /api/v1/installations/{id} — one installation with its photos. */
export const GET = route({ roles: ["ADMIN", "DISPATCHER"] }, ({ db, user, params }) =>
  installationsService.get(db, user, params.id),
);

/** PUT /api/v1/installations/{id} — office corrects the details of a saved record. */
export const PUT = route(
  { roles: ["ADMIN", "DISPATCHER"], body: createInstallationSchema, rateLimitPerMinute: 60 },
  async ({ db, params, body }) => ok(await installationsService.update(db, params.id, body), "Installation saved."),
);

/** DELETE /api/v1/installations/{id} — removes the record (soft delete). */
export const DELETE = route({ roles: ["ADMIN", "DISPATCHER"] }, async ({ db, params }) => {
  await installationsService.remove(db, params.id);
  return ok(null, "Installation deleted.");
});
