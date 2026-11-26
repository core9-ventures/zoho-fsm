import type { FieldJobDetail, FieldJobList, LocationInput, TransitionInput } from "./jobTypes";
import { jobsCache } from "../local/cache";
import { recordReading } from "../local/gps";
import { cancelQueuedFile, isLocalId, newLocalId, resolveId, write, type WriteResult } from "../local/outbox";
import { fileStore } from "../local/fileStore";
import { ApiError } from "./http";
import { optimistic } from "../local/optimistic";
import { readThrough } from "../local/readThrough";
import { FIELD_ACTION_LABEL } from "./jobTypes";
import { http, requestBlob } from "./http";

/** "WO-1024" for the label of a waiting change; empty when the job is not saved on the phone. */
const numberOf = async (id: string) => (await jobsCache.loadDetail(id))?.number ?? "job";

export type { FieldJob, FieldJobDetail, FieldJobList, LocationInput, TransitionInput } from "./jobTypes";
export { FIELD_ACTION_LABEL } from "./jobTypes";

/** The technician's jobs. */
export const fieldJobs = {
  /** Open visits plus the last 3 days. */
  list: () => readThrough(() => http.get<FieldJobList>("/field/jobs"), jobsCache.save, jobsCache.load),
  get: (id: string) =>
    readThrough(
      () => http.get<FieldJobDetail>(`/field/jobs/${id}`),
      jobsCache.saveDetail,
      () => jobsCache.loadDetail(id),
    ),
  /**
   * on-my-way, start, hold (with a reason), resume, complete. Without a signal the change is saved on the phone and
   * sent later (see `local/outbox.ts`); the saved copy of the job already shows the new status.
   */
  transition: async (id: string, input: TransitionInput): Promise<WriteResult<unknown>> =>
    write<unknown>({
      method: "POST",
      path: `/field/jobs/${id}/transition`,
      body: input,
      label: `${FIELD_ACTION_LABEL[input.action]}: ${await numberOf(id)}`,
      optimistic: () => optimistic.transition(id, input.action),
    }),
  addNote: async (id: string, text: string): Promise<WriteResult<null>> =>
    write<null>({
      method: "POST",
      path: `/field/jobs/${id}/notes`,
      body: { text },
      label: `Note on ${await numberOf(id)}`,
      optimistic: () => optimistic.note(id, newLocalId(), text),
    }),
  setChecklist: async (id: string, itemId: string, isDone: boolean): Promise<WriteResult<null>> =>
    write<null>({
      method: "PUT",
      path: `/field/jobs/${id}/checklist/${itemId}`,
      body: { isDone },
      label: `Checklist on ${await numberOf(id)}`,
      optimistic: () => optimistic.checklist(id, itemId, isDone),
    }),
  /**
   * A before or after photo: `phase` is BEFORE or AFTER and `slot` is the label of the box. Without a signal the file
   * is kept on the phone and uploaded later; the job shows it from the phone in the meantime.
   */
  uploadFile: async (
    id: string,
    file: Blob,
    fileName: string,
    fields: { phase: "BEFORE" | "AFTER"; slot?: string },
  ): Promise<WriteResult<unknown>> => {
    const localId = newLocalId();
    const kind = file.type.startsWith("video/") ? "VIDEO" : "PHOTO";
    return write<unknown>({
      method: "POST",
      path: `/field/jobs/${id}/attachments`,
      label: `${kind === "VIDEO" ? "Video" : "Photo"} for ${await numberOf(id)}`,
      localId,
      file: { blob: file, name: fileName, fields: { phase: fields.phase, ...(fields.slot ? { slot: fields.slot } : {}) } },
      optimistic: () =>
        optimistic.jobFile(id, fields.phase, { id: localId, name: fileName, kind, slot: fields.slot ?? null, type: file.type }),
    });
  },
  deleteFile: async (id: string, attachmentId: string): Promise<WriteResult<null>> => {
    // A photo that never left the phone is simply taken out of the queue.
    if (isLocalId(attachmentId) && (await cancelQueuedFile(attachmentId))) {
      await optimistic.jobFileRemoved(id, attachmentId);
      return { queued: true };
    }
    const real = await resolveId(attachmentId);
    if (isLocalId(real)) throw new ApiError("This photo was not found on the phone.", 404);
    return write<null>({
      method: "DELETE",
      path: `/field/jobs/${id}/files/${real}`,
      label: `Remove a photo from ${await numberOf(id)}`,
      optimistic: () => optimistic.jobFileRemoved(id, attachmentId),
    });
  },
};

/** One GPS reading; the dispatcher's live map shows it. */
export const fieldLocation = {
  /** Sent at once, or kept on the phone with its time when there is no signal (see `local/gps.ts`). */
  record: (input: LocationInput) => recordReading(input),
};

/** A saved file (installation or job) as a Blob. `thumb` asks for the small version used in grids. */
export const attachments = {
  blob: async (id: string, thumb = false) => {
    // A photo taken without a signal is shown from the phone until the server has it (then it has a real id).
    if (isLocalId(id)) {
      const saved = await fileStore.read(id);
      if (saved) return saved;
      const real = await resolveId(id);
      if (isLocalId(real)) throw new ApiError("This photo is not on the phone.", 404);
      id = real;
    }
    return requestBlob(`/attachments/${id}`, { inline: 1, thumb: thumb ? 1 : undefined });
  },
};
