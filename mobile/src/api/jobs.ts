import type { FieldJobDetail, FieldJobList, LocationInput, TransitionInput } from "./jobTypes";
import { jobsCache } from "../local/cache";
import { newLocalId, write, type WriteResult } from "../local/outbox";
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
  /** A before or after photo: `phase` is BEFORE or AFTER and `slot` is the label of the box. */
  uploadFile: (id: string, file: Blob, fileName: string, fields: { phase: "BEFORE" | "AFTER"; slot?: string }) => {
    const form = new FormData();
    form.set("file", file, fileName);
    form.set("phase", fields.phase);
    if (fields.slot) form.set("slot", fields.slot);
    return http.upload<unknown>(`/field/jobs/${id}/attachments`, form);
  },
  deleteFile: (id: string, attachmentId: string) => http.delete<null>(`/field/jobs/${id}/files/${attachmentId}`),
};

/** One GPS reading; the dispatcher's live map shows it. */
export const fieldLocation = {
  record: (input: LocationInput) => http.post<null>("/field/location", input),
};

/** A saved file (installation or job) as a Blob. `thumb` asks for the small version used in grids. */
export const attachments = {
  blob: (id: string, thumb = false) => requestBlob(`/attachments/${id}`, { inline: 1, thumb: thumb ? 1 : undefined }),
};
