"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SlotListCard, type EvidenceApi, type OtherPhoto } from "@/components/domain/evidence-section";
import { INSTALLATION_SLOTS, INSTALLATION_VIDEO_SECONDS } from "@/modules/installations/installations.schema";
import type { MediaDto } from "@/modules/work-orders/work-orders.schema";

const ME = "local";

type Stored = { meta: MediaDto; url: string; file: File };

/** A file chosen on the form, waiting to be uploaded once the record is saved. */
export type PendingFile = { file: File; slot: string | null };

/**
 * The photo area of a new installation: one box per label, one short video, and Other photos. Files wait in
 * this page's memory; the form uploads them after saving the record.
 */
export function InstallationPhotos({ onChange }: { onChange: (files: PendingFile[], hasTempSensor: boolean) => void }) {
  const [items, setItems] = useState<Stored[]>([]);
  const counter = useRef(0);
  const live = useRef<Stored[]>([]);
  live.current = items;

  useEffect(() => {
    onChange(
      items.map((s) => ({ file: s.file, slot: s.meta.slot })),
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Free the browser memory held by the previews when the area goes away.
  useEffect(
    () => () => {
      for (const s of live.current) URL.revokeObjectURL(s.url);
    },
    [],
  );

  const api: EvidenceApi = useMemo(
    () => ({
      uploadUrl: "",
      upload: async (file, fields) => {
        const kind = file.type.startsWith("video/") ? "VIDEO" : "PHOTO";
        const meta: MediaDto = {
          id: `local-${++counter.current}`,
          fileName: file.name,
          kind,
          contentType: file.type || null,
          slot: fields.slot ?? null,
          createdAt: new Date().toISOString(),
          author: null,
          authorId: ME,
        };
        const url = URL.createObjectURL(file);
        setItems((list) => {
          // A labeled box (or the video box) holds one file: a new one replaces the old.
          const replaced = list.filter((s) =>
            fields.slot ? s.meta.slot === fields.slot : kind === "VIDEO" && s.meta.kind === "VIDEO",
          );
          for (const r of replaced) URL.revokeObjectURL(r.url);
          return [...list.filter((s) => !replaced.includes(s)), { meta, url, file }];
        });
        return { ok: true };
      },
      fileUrl: (id) => live.current.find((s) => s.meta.id === id)?.url ?? "",
      deleteFile: async (id) => {
        const gone = live.current.find((s) => s.meta.id === id);
        if (gone) URL.revokeObjectURL(gone.url);
        setItems((list) => list.filter((s) => s.meta.id !== id));
        return { ok: true, data: undefined };
      },
      setTempSensor: async () => ({ ok: true, data: undefined }),
      addIssue: async () => ({ ok: false, error: "Issues are not part of a new installation." }),
      updateIssue: async () => ({ ok: false, error: "Issues are not part of a new installation." }),
      deleteIssue: async () => ({ ok: false, error: "Issues are not part of a new installation." }),
      refresh: () => {},
    }),
    [],
  );

  const otherPhotos: OtherPhoto[] = items
    .filter((s) => !s.meta.slot && s.meta.kind === "PHOTO")
    .map((s) => ({ id: s.meta.id, fileName: s.meta.fileName, authorId: ME }));

  return (
    <SlotListCard
      files={items.filter((s) => s.meta.slot || s.meta.kind === "VIDEO").map((s) => s.meta)}
      slots={INSTALLATION_SLOTS}
      video={{ label: "Device", maxSeconds: INSTALLATION_VIDEO_SECONDS }}
      api={api}
      closed={false}
      meId={ME}
      canDeleteAny
      otherPhotos={otherPhotos}
      capture
      title="Installation photos"
    />
  );
}
