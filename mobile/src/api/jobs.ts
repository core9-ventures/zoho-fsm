import type { FieldJobDetail, FieldJobList, LocationInput, TransitionInput } from "./jobTypes";
import { jobsCache } from "../local/cache";
import { readThrough } from "../local/readThrough";
import { http, requestBlob } from "./http";

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
  /** on-my-way, start, hold (with a reason), resume, complete. */
  transition: (id: string, input: TransitionInput) => http.post<unknown>(`/field/jobs/${id}/transition`, input),
  addNote: (id: string, text: string) => http.post<null>(`/field/jobs/${id}/notes`, { text }),
  setChecklist: (id: string, itemId: string, isDone: boolean) =>
    http.put<null>(`/field/jobs/${id}/checklist/${itemId}`, { isDone }),
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
