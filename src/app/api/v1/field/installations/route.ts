import { ok, route } from "@/lib/api";
import { createInstallationSchema, installationListQuerySchema, installationsService } from "@/modules/installations";

/** GET /api/v1/field/installations — the signed-in technician's own installation records. */
export const GET = route({ roles: ["TECHNICIAN"], query: installationListQuerySchema }, ({ db, user, query }) =>
  installationsService.list(db, user, query),
);

/** POST /api/v1/field/installations — saves a new installation record; send photos to /{id}/files afterwards. */
export const POST = route(
  { roles: ["TECHNICIAN"], body: createInstallationSchema, rateLimitPerMinute: 30 },
  async ({ db, user, body }) => ok(await installationsService.create(db, user, body), "Installation saved.", 201),
);
