import { ok, route } from "@/lib/api";
import { installationsService } from "@/modules/installations";

/** GET /api/v1/field/installations/{id} — one of the technician's own records (held or completed) with its files. */
export const GET = route({ roles: ["TECHNICIAN"] }, ({ db, user, params }) =>
  installationsService.get(db, user, params.id),
);

/** DELETE /api/v1/field/installations/{id} — deletes the technician's own record that is still on hold. */
export const DELETE = route({ roles: ["TECHNICIAN"] }, async ({ db, user, params }) => {
  await installationsService.discardHeld(db, user, params.id);
  return ok(null, "Held installation deleted.");
});
