"use client";

import { Camera, Images, Loader2, Pencil, Play, Plus, RefreshCw, TriangleAlert, Trash2, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Field, NativeSelect } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { CameraCapture, canOpenCamera } from "@/components/domain/camera-capture";
import { canRecordVideo, VideoRecorder } from "@/components/domain/video-recorder";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import {
  EVIDENCE_LIMITS,
  OTHER_PHOTO_LIMIT,
  ISSUE_STATUS_LABEL,
  ISSUE_STATUSES,
  ISSUE_SUGGESTIONS,
  PHASE_LABEL,
  slotsFor,
  VIDEO_MAX_SECONDS,
  type EvidenceKind,
  type EvidencePhaseValue,
  type IssueStatusValue,
} from "@/modules/work-orders/evidence";
import type { EvidenceDto, IssueDto, IssueInput, MediaDto } from "@/modules/work-orders/work-orders.schema";

/** What the office and the technician app each plug in; the screen itself is the same. */
export type EvidenceApi = {
  /** Multipart upload endpoint (fields: file, phase, issueId). */
  uploadUrl: string;
  addIssue: (input: IssueInput) => Promise<ActionResult<unknown>>;
  updateIssue: (issueId: string, input: IssueInput) => Promise<ActionResult<unknown>>;
  deleteIssue: (issueId: string) => Promise<ActionResult<unknown>>;
  deleteFile: (attachmentId: string) => Promise<ActionResult<unknown>>;
  /** The "Temperature sensor installed" switch. */
  setTempSensor: (on: boolean) => Promise<ActionResult<unknown>>;
  /** Optional: take a file without a server (the New installation preview keeps files in memory). */
  upload?: (file: File, fields: UploadFields) => Promise<{ ok: boolean; message?: string }>;
  /** Optional: called after a change instead of reloading the page from the server. */
  refresh?: () => void;
  /** Optional: where to show a stored file (defaults to the attachments endpoint). */
  fileUrl?: (id: string, thumb: boolean) => string;
};

export type UploadFields = { phase?: string; slot?: string; issueId?: string };

type Common = {
  api: EvidenceApi;
  /** Work order is locked: show only. */
  closed: boolean;
  /** The signed-in user (a technician may remove only their own files). */
  meId: string;
  /** Office users may remove any file; the server still checks their permission. */
  canDeleteAny: boolean;
  /** On a phone, open the camera straight away. */
  capture: boolean;
};

const mediaUrl = (id: string) => `/api/v1/attachments/${id}?inline=1`;
/** The small preview made on upload (the full file when there is none). Used in grids; a tap opens the full photo. */
const thumbUrl = (id: string) => `/api/v1/attachments/${id}?inline=1&thumb=1`;

/** Sends one file to the backend of the screen: a server endpoint, or the in-memory one of a preview. */
async function postFile(
  api: EvidenceApi,
  file: File,
  fields: UploadFields,
): Promise<{ ok: boolean; message?: string }> {
  if (api.upload) return api.upload(file, fields);
  const body = new FormData();
  body.append("file", file);
  for (const [key, value] of Object.entries(fields)) if (value) body.append(key, value);
  const res = await fetch(api.uploadUrl, { method: "POST", body }).catch(() => null);
  const json = (await res?.json().catch(() => ({}))) as { message?: string } | undefined;
  return { ok: !!res?.ok, message: json?.message };
}

/** Shows what changed: reloads from the server, or runs the own refresh of a preview. */
function useRefresh(api: EvidenceApi) {
  const router = useRouter();
  return () => (api.refresh ? api.refresh() : router.refresh());
}

const urlOf = (api: EvidenceApi, id: string, thumb = false) =>
  api.fileUrl ? api.fileUrl(id, thumb) : thumb ? thumbUrl(id) : mediaUrl(id);

/** Plain-language count: "2 of 4 photos · no video yet". */
function countText(items: MediaDto[]) {
  const photos = items.filter((m) => m.kind === "PHOTO").length;
  const videos = items.filter((m) => m.kind === "VIDEO").length;
  return `${photos}/${EVIDENCE_LIMITS.PHOTO} photos · ${videos}/${EVIDENCE_LIMITS.VIDEO} video`;
}

/** One slot: the Before or the After proof of the reported problem, or of one issue. */
function MediaSlot({
  phase,
  issueId,
  items: all,
  videoOnly = false,
  ...c
}: Common & { phase: EvidencePhaseValue; issueId?: string; items: MediaDto[]; videoOnly?: boolean }) {
  const refresh = useRefresh(c.api);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // In video-only mode (the reported problem's labeled photos live elsewhere) only videos show here.
  const items = videoOnly ? all.filter((m) => m.kind === "VIDEO") : all;
  const have = (k: EvidenceKind) => items.filter((m) => m.kind === k).length;
  const [cam, setCam] = useState(false);
  const [rec, setRec] = useState(false);
  const [cameraOk, setCameraOk] = useState(false);
  useEffect(() => setCameraOk(canOpenCamera()), []);
  const takePhoto = async (file: File): Promise<boolean> => {
    const res = await postFile(c.api, file, { phase, issueId });
    if (!res.ok) {
      toast.error(`${res.message ?? "upload failed. Check your connection and try again."}`);
      return false;
    }
    refresh();
    return true;
  };

  const send = async (files: FileList | null, kind: EvidenceKind) => {
    if (!files?.length) return;
    const room = EVIDENCE_LIMITS[kind] - have(kind);
    const list = Array.from(files);
    if (list.length > room)
      toast.error(
        room > 0
          ? `Only ${room} more ${kind === "PHOTO" ? "photo" : "video"} fits here; the rest were skipped.`
          : `This section is full. Remove one first.`,
      );
    setBusy(true);
    let ok = 0;
    for (const file of list.slice(0, Math.max(0, room))) {
      const res = await postFile(c.api, file, { phase, issueId });
      if (res.ok) ok++;
      else toast.error(`${file.name}: ${res.message ?? "upload failed. Check your connection and try again."}`);
    }
    setBusy(false);
    for (const ref of [photoInput, videoInput]) if (ref.current) ref.current.value = "";
    if (ok) {
      toast.success(`${ok} file${ok === 1 ? "" : "s"} uploaded.`);
      refresh();
    }
  };

  const remove = async (m: MediaDto) => {
    const res = await c.api.deleteFile(m.id);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Removed.");
    refresh();
  };

  return (
    <div className="space-y-2">
      {rec && (
        <VideoRecorder open title={`${PHASE_LABEL[phase]} video`} onClose={() => setRec(false)} onShot={takePhoto} />
      )}
      {cam && (
        <CameraCapture
          open
          mode="multi"
          title={`${PHASE_LABEL[phase]} photos`}
          room={Math.max(0, EVIDENCE_LIMITS.PHOTO - have("PHOTO"))}
          onClose={() => setCam(false)}
          onShot={takePhoto}
        />
      )}
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">{videoOnly ? `${PHASE_LABEL[phase]} video` : PHASE_LABEL[phase]}</h4>
        <span className="text-muted-foreground text-xs">
          {videoOnly ? `${have("VIDEO")}/${EVIDENCE_LIMITS.VIDEO} video` : countText(items)}
        </span>
      </div>
      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {items.map((m) => (
            <figure key={m.id} className="relative overflow-hidden rounded-md border">
              {m.kind === "VIDEO" ? (
                <video
                  src={urlOf(c.api, m.id)}
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-square w-full bg-black object-contain"
                />
              ) : (
                <a href={urlOf(c.api, m.id)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API URL, not optimisable */}
                  <img
                    src={urlOf(c.api, m.id, true)}
                    alt={`${PHASE_LABEL[phase]} photo`}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                </a>
              )}
              {!c.closed && (c.canDeleteAny || m.authorId === c.meId) && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute top-1 right-1 size-7"
                  aria-label={`Remove ${m.kind === "VIDEO" ? "video" : "photo"}`}
                  onClick={() => remove(m)}
                >
                  <Trash2 />
                </Button>
              )}
            </figure>
          ))}
        </div>
      )}
      {items.length === 0 && <p className="text-muted-foreground text-xs">Nothing added yet.</p>}
      {!c.closed && (
        <div className={videoOnly ? "grid grid-cols-1 gap-2" : "grid grid-cols-2 gap-2"}>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            multiple
            {...(c.capture ? { capture: "environment" as const } : {})}
            className="hidden"
            onChange={(e) => send(e.target.files, "PHOTO")}
          />
          <input
            ref={videoInput}
            type="file"
            accept="video/*"
            {...(c.capture ? { capture: "environment" as const } : {})}
            className="hidden"
            onChange={(e) => send(e.target.files, "VIDEO")}
          />
          {!videoOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || have("PHOTO") >= EVIDENCE_LIMITS.PHOTO}
              onClick={() => (c.capture && cameraOk ? setCam(true) : photoInput.current?.click())}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Camera />} Photo
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || have("VIDEO") >= EVIDENCE_LIMITS.VIDEO}
            onClick={() => (c.capture && canRecordVideo() ? setRec(true) : videoInput.current?.click())}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Video />} Video
          </Button>
        </div>
      )}
    </div>
  );
}

/** Length of a video file in seconds (0 when the browser cannot tell, so the file is let through). */
function videoSeconds(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (n: number) => {
      URL.revokeObjectURL(url);
      resolve(n);
    };
    v.preload = "metadata";
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => done(0);
    v.src = url;
  });
}

const ROW = "grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-3 sm:gap-x-5";

/**
 * One small box in the table: empty (tap to add), or the photo / video with a slim Retake and Remove bar.
 * A labeled box holds ONE photo; taking it again replaces the old one.
 */
function SlotCell({
  label,
  slot,
  phase,
  item,
  kind = "PHOTO",
  maxSeconds,
  big,
  ...c
}: Common & {
  /** Double-size box (installation photo list). */
  big?: boolean;
  label: string;
  slot?: string;
  /** Before / After for a work order; left out where a box is not tied to a phase (a new installation). */
  phase?: EvidencePhaseValue;
  item?: MediaDto;
  kind?: "PHOTO" | "VIDEO";
  /** Longest video this box accepts (checked on gallery files too). */
  maxSeconds?: number;
}) {
  const refresh = useRefresh(c.api);
  const input = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const name = phase ? `${label} ${PHASE_LABEL[phase].toLowerCase()}` : label;
  const Icon = kind === "VIDEO" ? Video : Camera;

  const upload = async (file: File): Promise<boolean> => {
    if (kind === "VIDEO" && maxSeconds && (await videoSeconds(file)) > maxSeconds + 0.5) {
      toast.error(`${name}: the video can be at most ${maxSeconds} seconds.`);
      return false;
    }
    setBusy(true);
    const res = await postFile(c.api, file, { phase, slot });
    setBusy(false);
    if (!res.ok) {
      toast.error(`${name}: ${res.message ?? "upload failed. Check your connection and try again."}`);
      return false;
    }
    toast.success(`${name} saved.`);
    refresh();
    return true;
  };

  const send = async (files: FileList | null) => {
    const file = files?.[0];
    if (file) await upload(file);
    for (const ref of [input, gallery]) if (ref.current) ref.current.value = "";
  };

  // A technician can use the app's own camera or choose a file from the gallery; the office picks a file.
  const [cam, setCam] = useState(false);
  const [rec, setRec] = useState(false);
  const openGallery = () => gallery.current?.click();
  const openCamera = () => {
    if (kind === "PHOTO" && canOpenCamera()) return setCam(true);
    if (kind === "VIDEO" && canRecordVideo()) return setRec(true);
    input.current?.click();
  };
  /** On a phone the box offers camera or gallery; elsewhere it goes straight to the file picker. */
  const withChoice = (trigger: React.ReactElement) =>
    c.capture ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onSelect={openCamera}>
            <Icon /> {kind === "VIDEO" ? "Record video" : "Take photo"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openGallery}>
            <Images /> Choose from gallery
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      trigger
    );
  const pick = c.capture ? undefined : openGallery;

  const remove = async () => {
    if (!item) return;
    const res = await c.api.deleteFile(item.id);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Removed.");
    refresh();
  };

  const bar = "flex size-6 items-center justify-center rounded text-white hover:bg-white/25 disabled:opacity-60";
  const CELL = big ? "h-16 w-full" : "size-[4.5rem]";

  return (
    <div className="flex justify-center">
      {item ? (
        <div className={cn(CELL, "relative overflow-hidden rounded-md border")}>
          <a
            href={urlOf(c.api, item.id)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${name}`}
            className="block size-full"
          >
            {kind === "VIDEO" ? (
              <>
                <video
                  src={urlOf(c.api, item.id)}
                  muted
                  playsInline
                  preload="metadata"
                  className="size-full object-cover"
                />
                <Play className="absolute inset-0 m-auto size-5 text-white drop-shadow" />
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- authenticated API URL, not optimisable
              <img src={urlOf(c.api, item.id, true)} alt={name} className="size-full object-cover" loading="lazy" />
            )}
          </a>
          {!c.closed && (
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-0.5 bg-black/55 px-0.5">
              {withChoice(
                <button type="button" className={bar} aria-label={`Retake ${name}`} disabled={busy} onClick={pick}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                </button>,
              )}
              {(c.canDeleteAny || item.authorId === c.meId) && (
                <button type="button" className={bar} aria-label={`Remove ${name}`} onClick={remove}>
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      ) : c.closed ? (
        <div className={cn(CELL, "rounded-md border border-dashed")} aria-label={`No ${name}`} />
      ) : (
        withChoice(
          <button
            type="button"
            disabled={busy}
            onClick={pick}
            aria-label={`Add ${name}`}
            className={cn(
              CELL,
              "border-primary/60 bg-primary/5 text-primary hover:bg-primary/10 flex items-center justify-center rounded-md border-2 border-dashed disabled:opacity-60",
            )}
          >
            {busy ? (
              <Loader2 className={big ? "size-7 animate-spin" : "size-6 animate-spin"} />
            ) : (
              <Icon className={big ? "size-7" : "size-6"} />
            )}
          </button>,
        )
      )}
      {cam && <CameraCapture open mode="single" title={name} onClose={() => setCam(false)} onShot={upload} />}
      {rec && <VideoRecorder open title={name} onClose={() => setRec(false)} onShot={upload} maxSeconds={maxSeconds} />}
      {/* Camera of the phone, used when the app's own camera is not available. */}
      <input
        ref={input}
        type="file"
        accept={kind === "VIDEO" ? "video/*" : "image/*"}
        {...(c.capture ? { capture: "environment" as const } : {})}
        className="hidden"
        onChange={(e) => send(e.target.files)}
      />
      {/* Gallery: any photo or video file saved on the device. */}
      <input
        ref={gallery}
        type="file"
        accept={kind === "VIDEO" ? "video/*" : "image/*"}
        className="hidden"
        onChange={(e) => send(e.target.files)}
      />
    </div>
  );
}

/** A photo kept under "Other photos". */
export type OtherPhoto = { id: string; fileName: string; authorId: string | null };

/**
 * "Other photos": anything else worth showing, up to 15 in total. Several can be picked at once.
 */
function OtherPhotos({ photos, ...c }: Common & { photos: OtherPhoto[] }) {
  const refresh = useRefresh(c.api);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [cam, setCam] = useState<{ room: number } | null>(null);
  const [cameraOk, setCameraOk] = useState(false);
  useEffect(() => setCameraOk(canOpenCamera()), []);
  const full = photos.length >= OTHER_PHOTO_LIMIT;
  const inApp = c.capture && cameraOk;

  /** Uploads one photo; returns whether it was saved. */
  const uploadOne = async (file: File): Promise<boolean> => {
    const res = await postFile(c.api, file, {});
    if (res.ok) return true;
    toast.error(`${file.name}: ${res.message ?? "upload failed. Check your connection and try again."}`);
    return false;
  };

  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = Math.max(0, OTHER_PHOTO_LIMIT - photos.length);
    const list = Array.from(files).slice(0, room);
    if (list.length < files.length)
      toast.error(
        room > 0
          ? `Only ${room} more photo${room === 1 ? "" : "s"} fit${room === 1 ? "s" : ""}; the rest were skipped.`
          : "This section is full. Remove a photo first.",
      );
    if (list.length === 0) return;
    setBusy(list.length);
    let ok = 0;
    for (const file of list) {
      if (await uploadOne(file)) ok++;
      setBusy((n) => n - 1);
    }
    if (input.current) input.current.value = "";
    if (ok) {
      toast.success(`${ok} photo${ok === 1 ? "" : "s"} added.`);
      refresh();
    }
  };

  const remove = async (p: OtherPhoto) => {
    const res = await c.api.deleteFile(p.id);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Removed.");
    refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">Other photos</h4>
        <span className="text-muted-foreground text-xs tabular-nums">
          {photos.length}/{OTHER_PHOTO_LIMIT}
        </span>
      </div>
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {photos.map((p) => (
            <div key={p.id} className="relative aspect-square overflow-hidden rounded-md border">
              <a href={urlOf(c.api, p.id)} target="_blank" rel="noreferrer" aria-label={`Open ${p.fileName}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API URL, not optimisable */}
                <img
                  src={urlOf(c.api, p.id, true)}
                  alt={p.fileName}
                  className="size-full object-cover"
                  loading="lazy"
                />
              </a>
              {!c.closed && (c.canDeleteAny || p.authorId === c.meId) && (
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => remove(p)}
                  className="absolute top-0.5 right-0.5 flex size-6 items-center justify-center rounded bg-black/55 text-white hover:bg-black/75"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!c.closed && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => send(e.target.files)}
          />
          <div className={inApp ? "grid grid-cols-2 gap-2" : undefined}>
            {inApp && (
              <Button
                type="button"
                size="sm"
                disabled={busy > 0 || full}
                onClick={() => setCam({ room: OTHER_PHOTO_LIMIT - photos.length })}
              >
                <Camera /> Open camera
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={busy > 0 || full}
              onClick={() => input.current?.click()}
            >
              {busy > 0 ? <Loader2 className="animate-spin" /> : <Camera />}
              {busy > 0
                ? `Uploading ${busy}…`
                : full
                  ? `Limit of ${OTHER_PHOTO_LIMIT} photos reached`
                  : inApp
                    ? "From gallery"
                    : photos.length === 0
                      ? "Add photos"
                      : "Add more photos"}
            </Button>
          </div>
          {cam && (
            <CameraCapture
              open
              mode="multi"
              title="Other photos"
              room={cam.room}
              onClose={() => setCam(null)}
              onShot={async (file) => {
                const ok = await uploadOne(file);
                if (ok) refresh();
                return ok;
              }}
            />
          )}
        </>
      )}
      {c.closed && photos.length === 0 && <p className="text-muted-foreground text-xs">No other photos.</p>}
    </div>
  );
}

/**
 * The reported problem's photos as one tidy table: a row for every label, a box under Before and one
 * under After, then the optional video. Counts above each column show what is still missing.
 */
function LabeledPhotos({
  evidence,
  hasTempSensor,
  slotLabels,
  ...c
}: Common & { evidence: EvidenceDto; hasTempSensor: boolean; slotLabels?: Record<string, string> }) {
  const wanted = slotsFor(hasTempSensor).map((s) => ({ ...s, label: slotLabels?.[s.key] ?? s.label }));
  const phases = [
    ["BEFORE", evidence.before],
    ["AFTER", evidence.after],
  ] as const;
  const done = (items: MediaDto[]) => wanted.filter((s) => items.some((m) => m.slot === s.key)).length;
  return (
    <div>
      <div className={cn(ROW, "pb-2")}>
        <span />
        {phases.map(([phase, items]) => (
          <div key={phase} className="text-center">
            <p className="text-sm font-medium">{PHASE_LABEL[phase]}</p>
            <p
              className={cn(
                "text-xs tabular-nums",
                done(items) === wanted.length ? "text-emerald-600" : "text-muted-foreground",
              )}
            >
              {done(items)}/{wanted.length}
            </p>
          </div>
        ))}
      </div>
      <div className="divide-y border-y">
        {wanted.map((s) => (
          <div key={s.key} className={cn(ROW, "py-2")}>
            <span className="text-sm">{s.label}</span>
            {phases.map(([phase, items]) => (
              <SlotCell
                key={phase}
                label={s.label}
                slot={s.key}
                phase={phase}
                item={items.find((m) => m.slot === s.key)}
                {...c}
              />
            ))}
          </div>
        ))}
        <div className={cn(ROW, "py-2")}>
          <span className="text-sm">
            Video <span className="text-muted-foreground">(optional, up to {VIDEO_MAX_SECONDS} s)</span>
          </span>
          {phases.map(([phase, items]) => (
            <SlotCell
              key={phase}
              label="Video"
              phase={phase}
              kind="VIDEO"
              item={items.find((m) => m.kind === "VIDEO")}
              {...c}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BeforeAfter({ evidence, issueId, ...c }: Common & { evidence: EvidenceDto; issueId?: string }) {
  return (
    <div className="@container">
      <div className="grid gap-4 @md:grid-cols-2">
        <MediaSlot phase="BEFORE" issueId={issueId} items={evidence.before} {...c} />
        <MediaSlot phase="AFTER" issueId={issueId} items={evidence.after} {...c} />
      </div>
    </div>
  );
}

const OTHER = "__other__";

function IssueDialog({
  open,
  onOpenChange,
  issue,
  api,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  issue?: IssueDto;
  api: EvidenceApi;
}) {
  const router = useRouter();
  const known = issue ? (ISSUE_SUGGESTIONS as readonly string[]).includes(issue.title) : true;
  const [pick, setPick] = useState<string>(issue ? (known ? issue.title : OTHER) : ISSUE_SUGGESTIONS[0]);
  const [custom, setCustom] = useState(issue && !known ? issue.title : "");
  const [details, setDetails] = useState(issue?.details ?? "");
  const [status, setStatus] = useState<IssueStatusValue>(issue?.status ?? "FOUND");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title = pick === OTHER ? custom.trim() : pick;

  const save = async () => {
    if (!title) return setError("Write what the issue is.");
    setError(null);
    setBusy(true);
    const input: IssueInput = { title, details, status };
    const res = issue ? await api.updateIssue(issue.id, input) : await api.addIssue(input);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(issue ? "Issue saved." : "Issue added. Now add its photos.");
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{issue ? "Edit issue" : "Another issue found"}</DialogTitle>
          <DialogDescription>
            Something you found on site besides the reported problem. Add its photos after saving.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="What is it?" htmlFor="is-pick">
            <NativeSelect id="is-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
              {ISSUE_SUGGESTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value={OTHER}>Other (write it yourself)</option>
            </NativeSelect>
          </Field>
          {pick === OTHER && (
            <Field label="Describe the issue" htmlFor="is-custom">
              <Input
                id="is-custom"
                maxLength={120}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="e.g. Rear camera cable cut"
              />
            </Field>
          )}
          <Field label="Details" htmlFor="is-details" hint="Optional">
            <Textarea id="is-details" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
          </Field>
          <Field label="Status" htmlFor="is-status">
            <NativeSelect id="is-status" value={status} onChange={(e) => setStatus(e.target.value as IssueStatusValue)}>
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ISSUE_STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} {issue ? "Save" : "Add issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueCard({ issue, ...c }: Common & { issue: IssueDto }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const setStatus = async (status: IssueStatusValue) => {
    const res = await c.api.updateIssue(issue.id, { title: issue.title, details: issue.details ?? "", status });
    if (!res.ok) return void toast.error(res.error);
    router.refresh();
  };
  const remove = async () => {
    if (!window.confirm(`Remove "${issue.title}" and its photos?`)) return;
    const res = await c.api.deleteIssue(issue.id);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Issue removed.");
    router.refresh();
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{issue.title}</p>
          {issue.details && <p className="text-muted-foreground text-sm whitespace-pre-wrap">{issue.details}</p>}
          {issue.author && <p className="text-muted-foreground text-xs">Found by {issue.author}</p>}
        </div>
        {c.closed ? (
          <span className="text-muted-foreground text-xs">{ISSUE_STATUS_LABEL[issue.status]}</span>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <NativeSelect
              aria-label="Issue status"
              className="h-8 w-auto text-xs"
              value={issue.status}
              onChange={(e) => setStatus(e.target.value as IssueStatusValue)}
            >
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ISSUE_STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Edit issue"
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Remove issue" onClick={remove}>
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
      <BeforeAfter evidence={issue.evidence} issueId={issue.id} {...c} />
      {editing && <IssueDialog open onOpenChange={setEditing} issue={issue} api={c.api} />}
    </div>
  );
}

type PhotosProps = {
  evidence: EvidenceDto;
  api: EvidenceApi;
  closed: boolean;
  meId: string;
  canDeleteAny: boolean;
  hasTempSensor: boolean;
  /** Ordinary photos of the job (not before/after proof). */
  otherPhotos: OtherPhoto[];
  capture?: boolean;
  /** Heading of the card (a work order shows the reported problem; a new installation says "Installation photos"). */
  title?: string;
  /** Rename some labeled photos on this screen only, by slot key (e.g. { BACK_CAMERA: "Vehicle app screenshot" }). */
  slotLabels?: Record<string, string>;
};

/**
 * The photo area of a job: temperature-sensor switch, the labeled Before / After table with video, and
 * Other photos. Shared by the work order, the technician app and the New installation form.
 */
export function PhotosCard({
  evidence,
  api,
  closed,
  meId,
  canDeleteAny,
  hasTempSensor,
  otherPhotos,
  capture = false,
  title = "Reported problem: before and after",
  slotLabels,
}: PhotosProps) {
  const refresh = useRefresh(api);
  const [tempBusy, setTempBusy] = useState(false);
  const c: Common = { api, closed, meId, canDeleteAny, capture };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="size-4" /> {title}
        </CardTitle>
        <p className="text-muted-foreground text-xs">Tap a box to add a photo. Retake replaces it.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-muted/40 flex items-center gap-3 rounded-md px-3 py-2">
          <Switch
            id="temp-sensor"
            checked={hasTempSensor}
            disabled={closed || tempBusy}
            onCheckedChange={async (on) => {
              setTempBusy(true);
              const res = await api.setTempSensor(on);
              setTempBusy(false);
              if (!res.ok) return void toast.error(res.error);
              refresh();
            }}
          />
          <Label htmlFor="temp-sensor" className="flex-1 text-sm font-normal">
            Temperature sensor installed
          </Label>
          <span className="text-muted-foreground hidden text-xs sm:inline">adds 2 photos</span>
        </div>
        <LabeledPhotos evidence={evidence} hasTempSensor={hasTempSensor} slotLabels={slotLabels} {...c} />
        <div className="border-t pt-4">
          <OtherPhotos photos={otherPhotos} {...c} />
        </div>
      </CardContent>
    </Card>
  );
}

/** A label of the one-photo-per-label list (new installation). */
export type SlotDef = { key: string; label: string };

type SlotListProps = {
  /** Every labeled photo and the video of the record (other photos go in `otherPhotos`). */
  files: MediaDto[];
  slots: readonly SlotDef[];
  /** Label and length limit of the single video box; leave out for no video. */
  video?: { label: string; maxSeconds: number };
  api: EvidenceApi;
  closed: boolean;
  meId: string;
  canDeleteAny: boolean;
  otherPhotos: OtherPhoto[];
  capture?: boolean;
  title?: string;
  /** Optional switch shown above the list (e.g. "Temperature sensor installed" that adds more labels). */
  header?: React.ReactNode;
};

/**
 * Photos of a record that has no before/after: one box for every label in a single list, one video box
 * with a length limit, then Other photos. Taking a box again replaces its file.
 */
export function SlotListCard({
  files,
  slots,
  video,
  api,
  closed,
  meId,
  canDeleteAny,
  otherPhotos,
  capture = false,
  title = "Photos",
  header,
}: SlotListProps) {
  const c: Common = { api, closed, meId, canDeleteAny, capture };
  const done = slots.filter((s) => files.some((m) => m.slot === s.key)).length;
  const ROW1 = "grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-3 rounded-lg border bg-card px-3 sm:gap-x-5";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="size-4" /> {title}
          <span
            className={cn(
              "ml-auto text-xs font-normal tabular-nums",
              done === slots.length ? "text-emerald-600" : "text-muted-foreground",
            )}
          >
            {done}/{slots.length}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">Tap a box to add a photo. Retake replaces it.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {header}
        <div className="space-y-2">
          {slots.map((s) => (
            <div key={s.key} className={cn(ROW1, "py-2.5")}>
              <span className="text-base font-semibold">{s.label}</span>
              <SlotCell big label={s.label} slot={s.key} item={files.find((m) => m.slot === s.key)} {...c} />
            </div>
          ))}
          {video && (
            <div className={cn(ROW1, "py-2.5")}>
              <span className="text-base font-semibold">
                {video.label} <span className="text-muted-foreground">(up to {video.maxSeconds} s)</span>
              </span>
              <SlotCell
                big
                label={video.label}
                kind="VIDEO"
                maxSeconds={video.maxSeconds}
                item={files.find((m) => m.kind === "VIDEO")}
                {...c}
              />
            </div>
          )}
        </div>
        <OtherPhotos photos={otherPhotos} {...c} />
      </CardContent>
    </Card>
  );
}

/**
 * Proof for a work order: Before / After photos and video of the reported problem, and a list of
 * other issues found on site, each with its own Before / After proof.
 */
export function EvidenceSection({
  evidence,
  issues,
  api,
  closed,
  meId,
  canDeleteAny,
  hasTempSensor,
  otherPhotos,
  capture = false,
}: {
  evidence: EvidenceDto;
  issues: IssueDto[];
  api: EvidenceApi;
  closed: boolean;
  meId: string;
  canDeleteAny: boolean;
  hasTempSensor: boolean;
  /** Ordinary photos of the job (not before/after proof). */
  otherPhotos: OtherPhoto[];
  capture?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const c: Common = { api, closed, meId, canDeleteAny, capture };

  return (
    <>
      <PhotosCard
        evidence={evidence}
        api={api}
        closed={closed}
        meId={meId}
        canDeleteAny={canDeleteAny}
        hasTempSensor={hasTempSensor}
        otherPhotos={otherPhotos}
        capture={capture}
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4" /> Other issues found ({issues.length})
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              Problems found on site besides the reported one. Each has its own before and after proof.
            </p>
          </div>
          {!closed && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus /> Add issue
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {issues.length === 0 && <p className="text-muted-foreground text-sm">No other issues recorded.</p>}
          {issues.map((i) => (
            <IssueCard key={i.id} issue={i} {...c} />
          ))}
        </CardContent>
      </Card>
      {adding && <IssueDialog open onOpenChange={setAdding} api={api} />}
    </>
  );
}
