import { ok, route } from "@/lib/api";
import { fieldService, noteInputSchema } from "@/modules/field";

/** POST /api/v1/field/jobs/{id}/notes { text } — adds a note to one of my jobs. */
export const POST = route(
  { roles: ["TECHNICIAN"], body: noteInputSchema, rateLimitPerMinute: 60 },
  async ({ db, user, params, body }) => {
    await fieldService.addNote(db, user, params.id, body.text);
    return ok(null, "Note added.", 201);
  },
);
