"use client";

import { SlotListCard, type EvidenceApi } from "@/components/domain/evidence-section";
import { INSTALLATION_SLOTS, INSTALLATION_VIDEO_SECONDS } from "@/modules/installations/installations.schema";
import type { MediaDto } from "@/modules/work-orders/work-orders.schema";

/** Nothing is uploaded or removed here, so the photo area never calls this. */
const readOnlyApi: EvidenceApi = {
  uploadUrl: "",
  deleteFile: async () => ({ ok: false, error: "This record can only be changed by the office." }),
  setTempSensor: async () => ({ ok: false, error: "This record can only be changed by the office." }),
  addIssue: async () => ({ ok: false, error: "Not available." }),
  updateIssue: async () => ({ ok: false, error: "Not available." }),
  deleteIssue: async () => ({ ok: false, error: "Not available." }),
};

/** The photos of one installation, shown without any way to change them. */
export function ReadOnlyPhotos({ files, photos }: { files: MediaDto[]; photos: MediaDto[] }) {
  return (
    <SlotListCard
      files={files}
      slots={INSTALLATION_SLOTS}
      video={{ label: "Device", maxSeconds: INSTALLATION_VIDEO_SECONDS }}
      api={readOnlyApi}
      closed
      meId=""
      canDeleteAny={false}
      otherPhotos={photos.map((p) => ({ id: p.id, fileName: p.fileName, authorId: p.authorId }))}
      title="Installation photos"
    />
  );
}
