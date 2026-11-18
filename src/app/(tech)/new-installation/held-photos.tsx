"use client";

import { useMemo } from "react";
import { SlotListCard, type EvidenceApi } from "@/components/domain/evidence-section";
import { deleteMyInstallationFileAction } from "@/modules/installations/installations.actions";
import { INSTALLATION_SLOTS, INSTALLATION_VIDEO_SECONDS } from "@/modules/installations/installations.schema";
import type { MediaDto } from "@/modules/work-orders/work-orders.schema";

/**
 * The photo area of an installation that is on hold. Its files are already saved on the server, so a photo
 * is uploaded the moment it is taken and removed right away (unlike a brand-new form, which waits).
 */
export function HeldPhotos({ id, files, photos }: { id: string; files: MediaDto[]; photos: MediaDto[] }) {
  const api: EvidenceApi = useMemo(
    () => ({
      uploadUrl: `/api/v1/field/installations/${id}/files`,
      deleteFile: (attachmentId) => deleteMyInstallationFileAction(id, attachmentId),
      setTempSensor: async () => ({ ok: true, data: undefined }),
      addIssue: async () => ({ ok: false, error: "Not available." }),
      updateIssue: async () => ({ ok: false, error: "Not available." }),
      deleteIssue: async () => ({ ok: false, error: "Not available." }),
    }),
    [id],
  );
  return (
    <SlotListCard
      files={files}
      slots={INSTALLATION_SLOTS}
      video={{ label: "Device", maxSeconds: INSTALLATION_VIDEO_SECONDS }}
      api={api}
      closed={false}
      meId=""
      canDeleteAny
      otherPhotos={photos.map((p) => ({ id: p.id, fileName: p.fileName, authorId: p.authorId }))}
      capture
      title="Installation photos"
    />
  );
}
