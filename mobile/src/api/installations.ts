import type { PagedResult } from "@/lib/pagination";
import type {
  CustomerChoice,
  HoldInstallationInput,
  InstallationDetail,
  InstallationInput,
  InstallationListItem,
  InstallationListQuery,
} from "@/modules/installations/installations.schema";
import { customersCache, installationsCache } from "../local/cache";
import { readThrough } from "../local/readThrough";
import { http } from "./http";

// The input shapes are the server's own zod types, so the app and the server cannot drift apart.
export type {
  CustomerChoice,
  HoldInstallationInput,
  InstallationDetail,
  InstallationInput,
  InstallationListItem,
  InstallationListQuery,
  PagedResult,
};

/** Optional filters of the list screens (page, search, status, ...). */
type ListQuery = Partial<Pick<InstallationListQuery, "page" | "pageSize" | "search" | "status" | "customerId">>;

/** What the technician's screens call. */
export const fieldInstallations = {
  /** The companies (and their saved sites) to pick from. */
  options: () =>
    readThrough(
      () => http.get<CustomerChoice[]>("/field/installations/options"),
      customersCache.save,
      customersCache.load,
    ),
  list: (q: ListQuery = {}) =>
    readThrough(
      () => http.get<PagedResult<InstallationListItem>>("/field/installations", q),
      (res) => installationsCache.saveList(res.items),
      () => installationsCache.loadList(q),
    ),
  get: (id: string) =>
    readThrough(
      () => http.get<InstallationDetail>(`/field/installations/${id}`),
      installationsCache.saveDetail,
      () => installationsCache.loadDetail(id),
    ),
  /** A finished record. Photos follow one by one through `uploadFile`. */
  create: (input: InstallationInput) => http.post<{ id: string }>("/field/installations", input),
  /** Saves a half-filled record as ON_HOLD (a reason is required). */
  hold: (input: HoldInstallationInput) => http.post<{ id: string }>("/field/installations/hold", input),
  /** Saves changes to a held record (it stays on hold). */
  updateHeld: (id: string, input: HoldInstallationInput) =>
    http.put<{ id: string }>(`/field/installations/${id}/hold`, input),
  /** Finishes a held record. */
  complete: (id: string, input: InstallationInput) =>
    http.post<{ id: string }>(`/field/installations/${id}/complete`, input),
  /** Deletes a held record (and its photos). */
  discard: async (id: string) => {
    const res = await http.delete<null>(`/field/installations/${id}`);
    await installationsCache.remove(id);
    return res;
  },
  /** Adds a photo (with `slot` for a labeled box) or the Device video. */
  uploadFile: (id: string, file: Blob, fileName: string, slot?: string) => {
    const form = new FormData();
    form.set("file", file, fileName);
    if (slot) form.set("slot", slot);
    return http.upload<unknown>(`/field/installations/${id}/files`, form);
  },
  deleteFile: (id: string, attachmentId: string) =>
    http.delete<null>(`/field/installations/${id}/files/${attachmentId}`),
};

/** What the office screens call (Admin, Dispatcher). */
export const officeInstallations = {
  list: (q: ListQuery = {}) => http.get<PagedResult<InstallationListItem>>("/installations", q),
  get: (id: string) => http.get<InstallationDetail>(`/installations/${id}`),
  update: (id: string, input: InstallationInput) => http.put<{ id: string }>(`/installations/${id}`, input),
  /** Puts a completed installation back on hold; the reason is what the technician sees. */
  putOnHold: (id: string, reason: string) => http.post<{ id: string }>(`/installations/${id}/hold`, { reason }),
  delete: (id: string) => http.delete<null>(`/installations/${id}`),
  uploadFile: (id: string, file: Blob, fileName: string, slot?: string) => {
    const form = new FormData();
    form.set("file", file, fileName);
    if (slot) form.set("slot", slot);
    return http.upload<unknown>(`/installations/${id}/files`, form);
  },
  deleteFile: (id: string, attachmentId: string) => http.delete<null>(`/installations/${id}/files/${attachmentId}`),
};
