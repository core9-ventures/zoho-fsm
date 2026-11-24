import { ok, route } from "@/lib/api";
import { installationsService } from "@/modules/installations";

/** DELETE /api/v1/installations/{id}/files/{attachmentId} — office removes a photo or video. */
export const DELETE = route({ roles: ["ADMIN", "DISPATCHER"] }, async ({ db, user, params }) => {
  await installationsService.removeFile(db, user, params.id, params.attachmentId);
  return ok(null, "File removed.");
});
