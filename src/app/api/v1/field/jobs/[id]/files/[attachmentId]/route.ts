import { ok, route } from "@/lib/api";
import { fieldService } from "@/modules/field";

/** DELETE /api/v1/field/jobs/{id}/files/{attachmentId} — removes one of my files (photo or video) from my job. */
export const DELETE = route({ roles: ["TECHNICIAN"] }, async ({ db, user, params }) => {
  await fieldService.removeFile(db, user, params.id, params.attachmentId);
  return ok(null, "File removed.");
});
