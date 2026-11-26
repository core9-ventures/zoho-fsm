import { z } from "zod";
import type { FieldJobDetail, FieldJobList } from "@/modules/field/field.schema";
import type {
  CustomerChoice,
  InstallationDetail,
  InstallationListItem,
} from "@/modules/installations/installations.schema";

/** How many days ahead a technician's phone keeps jobs (jobs in progress or on hold are always kept). */
export const SYNC_WINDOW_DAYS = 7;

/** GET /api/v1/sync?since=... — `since` is the `serverTime` of the previous answer; leave it out for a full copy. */
export const syncQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
});
export type SyncQuery = z.infer<typeof syncQuerySchema>;

/**
 * What a technician's phone needs to work without a signal. The lists are always complete for the window, so the
 * phone can drop anything that is no longer in them (a job given to someone else, a deleted record). Details are
 * sent only for rows that changed since `since` (all of them in a full copy).
 */
export type SyncResponse = {
  /** Send this back as `since` next time. */
  serverTime: string;
  /** True when no `since` was given: the phone replaces everything it has. */
  full: boolean;
  windowDays: number;
  jobs: FieldJobList;
  jobDetails: FieldJobDetail[];
  installations: InstallationListItem[];
  installationDetails: InstallationDetail[];
  /** Companies and saved sites for the installation form; null when nothing changed. */
  customers: CustomerChoice[] | null;
};
