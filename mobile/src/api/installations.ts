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
import { cancelQueuedFile, isLocalId, newLocalId, resolveId, write } from "../local/outbox";
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
  /**
   * Adds a photo (with `slot` for a labeled box) or the Device video. Without a signal the file is kept on the phone
   * and uploaded later; a record that exists only on the phone can take photos too (they follow it to the server).
   */
  uploadFile: async (id: string, file: Blob, fileName: string, slot?: string) => {
    const localId = newLocalId();
    const kind = file.type.startsWith("video/") ? "VIDEO" : "PHOTO";
    return write<unknown>({
      method: "POST",
      path: `/field/installations/${id}/files`,
      label: `${kind === "VIDEO" ? "Video" : "Photo"} for an installation`,
      localId,
      file: { blob: file, name: fileName, fields: slot ? { slot } : {} },
      optimistic: () => optimistic.installationFile(id, { id: localId, name: fileName, kind, slot: slot ?? null, type: file.type }),
    });
  },
  deleteFile: async (id: string, attachmentId: string) => {
    if (isLocalId(attachmentId) && (await cancelQueuedFile(attachmentId))) {
      await optimistic.installationFileRemoved(id, attachmentId);
      return { queued: true as const };
    }
    const real = await resolveId(attachmentId);
    if (isLocalId(real)) throw new ApiError("This photo was not found on the phone.", 404);
    return write<null>({
      method: "DELETE",
      path: `/field/installations/${id}/files/${real}`,
      label: "Remove a photo from an installation",
      optimistic: () => optimistic.installationFileRemoved(id, attachmentId),
    });
  },
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
