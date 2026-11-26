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
import { optimistic } from "../local/optimistic";
import { isLocalId, newLocalId, resolveId, write } from "../local/outbox";
import { readThrough } from "../local/readThrough";
import { ApiError, http } from "./http";
import { authApi } from "./auth";

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
  get: async (id: string) => {
    // A record created on the phone has a temporary id until the server has saved it.
    const real = await resolveId(id);
    if (isLocalId(real)) {
      const saved = await installationsCache.loadDetail(real);
      if (!saved) throw new ApiError("This record was not found on the phone.", 404);
      return saved;
    }
    return readThrough(
      () => http.get<InstallationDetail>(`/field/installations/${real}`),
      installationsCache.saveDetail,
      () => installationsCache.loadDetail(real),
    );
  },
  /**
   * A finished record. Without a signal it is saved on the phone and sent later; `queued` is then true and `id` is a
   * temporary one. Photos follow one by one through `uploadFile` (they need a signal until Phase 4).
   */
  create: async (input: InstallationInput): Promise<{ id: string; queued: boolean }> => {
    const localId = newLocalId();
    const who = authApi.cachedUser()?.fullName ?? null;
    const res = await write<{ id: string }>({
      method: "POST",
      path: "/field/installations",
      body: input,
      label: `New installation ${input.vehicleNo.trim().toUpperCase()}`,
      localId,
      optimistic: () => optimistic.installationSaved(localId, input, "COMPLETED", who),
    });
    return res.queued ? { id: localId, queued: true } : { id: res.data.id, queued: false };
  },
  /** Saves a half-filled record as ON_HOLD (a reason is required). */
  hold: async (input: HoldInstallationInput): Promise<{ id: string; queued: boolean }> => {
    const localId = newLocalId();
    const who = authApi.cachedUser()?.fullName ?? null;
    const res = await write<{ id: string }>({
      method: "POST",
      path: "/field/installations/hold",
      body: input,
      label: `Held installation ${input.vehicleNo.trim().toUpperCase() || "(no vehicle yet)"}`,
      localId,
      optimistic: () => optimistic.installationSaved(localId, input, "ON_HOLD", who),
    });
    return res.queued ? { id: localId, queued: true } : { id: res.data.id, queued: false };
  },
  /** Saves changes to a held record (it stays on hold). */
  updateHeld: async (id: string, input: HoldInstallationInput) => {
    const who = authApi.cachedUser()?.fullName ?? null;
    return write<{ id: string }>({
      method: "PUT",
      path: `/field/installations/${id}/hold`,
      body: input,
      label: `Held installation ${input.vehicleNo.trim().toUpperCase() || "(no vehicle yet)"}`,
      optimistic: () => optimistic.installationSaved(id, input, "ON_HOLD", who),
    });
  },
  /** Finishes a held record. */
  complete: async (id: string, input: InstallationInput) => {
    const who = authApi.cachedUser()?.fullName ?? null;
    return write<{ id: string }>({
      method: "POST",
      path: `/field/installations/${id}/complete`,
      body: input,
      label: `Installation ${input.vehicleNo.trim().toUpperCase()}`,
      optimistic: () => optimistic.installationSaved(id, input, "COMPLETED", who),
    });
  },
  /** Deletes a held record (and its photos). */
  discard: async (id: string) => {
    const res = await write<null>({
      method: "DELETE",
      path: `/field/installations/${id}`,
      label: "Delete held installation",
      optimistic: () => installationsCache.remove(id),
    });
    await installationsCache.remove(id);
    return res;
  },
  /** Adds a photo (with `slot` for a labeled box) or the Device video. */
  uploadFile: async (id: string, file: Blob, fileName: string, slot?: string) => {
    const real = await resolveId(id);
    if (isLocalId(real)) throw new ApiError("Photos can be added once the record has reached the server.", 0);
    const form = new FormData();
    form.set("file", file, fileName);
    if (slot) form.set("slot", slot);
    return http.upload<unknown>(`/field/installations/${real}/files`, form);
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
