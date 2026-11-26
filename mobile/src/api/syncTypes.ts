import type {
  CustomerChoice,
  InstallationDetail,
  InstallationListItem,
} from "@/modules/installations/installations.schema";
import type { FieldJobDetail, FieldJobList } from "./jobTypes";

/**
 * What GET /api/v1/sync returns (it mirrors `SyncResponse` in the server's `src/modules/sync/sync.schema.ts`; keep the
 * two in step). The lists are complete for the window; details are only the ones that changed.
 */
export type SyncResponse = {
  /** Sent back as `since` next time. */
  serverTime: string;
  /** True when no `since` was sent: the phone replaces everything. */
  full: boolean;
  windowDays: number;
  jobs: FieldJobList;
  jobDetails: FieldJobDetail[];
  installations: InstallationListItem[];
  installationDetails: InstallationDetail[];
  /** Companies and sites; null when nothing changed. */
  customers: CustomerChoice[] | null;
};
