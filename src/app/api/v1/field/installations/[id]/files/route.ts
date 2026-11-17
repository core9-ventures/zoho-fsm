import { ok, route } from "@/lib/api";
import { BadRequestError } from "@/lib/errors";
import { installationsService } from "@/modules/installations";

/** POST /api/v1/field/installations/{id}/files — multipart "file" (photo or video); slot=LABEL for a labeled photo. */
export const POST = route({ roles: ["TECHNICIAN"], rateLimitPerMinute: 60 }, async ({ db, user, params, req }) => {
  const form = await req.formData().catch(() => {
    throw new BadRequestError("Send the file as multipart/form-data.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new BadRequestError("Choose a file to upload.", { file: ["Choose a file."] });
  const slot = form.get("slot");
  return ok(
    await installationsService.addFile(db, user, params.id, file, {
      slot: typeof slot === "string" ? slot : undefined,
    }),
    "File uploaded.",
    201,
  );
});
