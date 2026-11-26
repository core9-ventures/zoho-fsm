import { route } from "@/lib/api";
import { syncQuerySchema, syncService } from "@/modules/sync";

/**
 * GET /api/v1/sync — everything a technician's phone keeps to work without a signal: jobs of the next 7 days plus
 * the ones in progress (with details), the technician's installations and the companies to pick from.
 * Send `since` (the `serverTime` of the last answer) to get only the details that changed.
 */
export const GET = route({ roles: ["TECHNICIAN"], query: syncQuerySchema, rateLimitPerMinute: 30 }, ({ db, user, query }) =>
  syncService.forTechnician(db, user, query.since ? new Date(query.since) : null),
);
