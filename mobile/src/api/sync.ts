import { http } from "./http";
import type { SyncResponse } from "./syncTypes";

export type { SyncResponse } from "./syncTypes";

export const syncApi = {
  /** Without `since` the server sends a full copy; with it, only the details that changed. */
  get: (since?: string) => http.get<SyncResponse>("/sync", { since }),
};
