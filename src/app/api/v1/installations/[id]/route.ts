import { ok, route } from "@/lib/api";
import { installationsService } from "@/modules/installations";

/** GET /api/v1/installations/{id} — one installation with its photos. */
export const GET = route({ roles: ["ADMIN", "DISPATCHER"] }, ({ db, user, params }) =>
  installationsService.get(db, user, params.id),
);

/** DELETE /api/v1/installations/{id} — removes the record (soft delete). */
export const DELETE = route({ roles: ["ADMIN", "DISPATCHER"] }, async ({ db, params }) => {
  await installationsService.remove(db, params.id);
  return ok(null, "Installation deleted.");
});
