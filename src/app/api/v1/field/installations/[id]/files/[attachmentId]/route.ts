import { ok, route } from "@/lib/api";
import { installationsService } from "@/modules/installations";

/** DELETE /api/v1/field/installations/{id}/files/{attachmentId} — removes a photo of a record that is still on hold. */
export const DELETE = route({ roles: ["TECHNICIAN"] }, async ({ db, user, params }) => {
  await installationsService.removeFile(db, user, params.id, params.attachmentId);
  return ok(null, "File removed.");
});
