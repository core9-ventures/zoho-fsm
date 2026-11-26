import { ok, route } from "@/lib/api";
import { fieldService, locationBatchSchema } from "@/modules/field";

/** POST /api/v1/field/location/batch { points: [{ latitude, longitude, ..., recordedAt }] } — readings taken offline. */
export const POST = route(
  { roles: ["TECHNICIAN"], body: locationBatchSchema, rateLimitPerMinute: 30 },
  async ({ db, user, body }) => ok(await fieldService.recordLocations(db, user, body), "Locations saved.", 201),
);
