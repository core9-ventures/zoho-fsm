import { useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, RefreshCw, Square, SwitchCamera, Video, X } from "lucide-react";
import { useToast } from "../ui/toast";
import { canOpenCamera } from "./CameraCapture";
import { VIDEO_AUDIO_BITRATE, VIDEO_BITRATE, VIDEO_HEIGHT, VIDEO_MAX_SECONDS, VIDEO_WIDTH } from "@/modules/work-orders/evidence";

/** Whether a video can be recorded inside the page. */
export const canRecordVideo = () => canOpenCamera() && typeof MediaRecorder !== "undefined";

/** MP4 plays everywhere; WebM is the fallback. */
function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((t) => MediaRecorder.isTypeSupported(t));
}

/** A clip recorded in the page often has no length in its header; seeking far past the end makes the phone work it out. */
function showFirstFrame(v: HTMLVideoElement) {
  if (Number.isFinite(v.duration)) return;
  const back = () => {
    v.removeEventListener("timeupdate", back);
    v.currentTime = 0;
    void v.play().catch(() => undefined);
  };
  v.addEventListener("timeupdate", back);
  v.currentTime = 1e101;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const extOf = (type: string) => (type.includes("mp4") ? "mp4" : "webm");

/**
 * The app's own video recorder, the same as on the web portal: 720p at a fixed bit rate, stops by itself at
 * `maxSeconds`. The technician checks the clip, then "Use video" saves it (`onShot` returns whether it worked).
 */
export function VideoRecorder({
  open,
  onClose,
  title,
  onShot,
  maxSeconds = VIDEO_MAX_SECONDS,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onShot: (file: File) => Promise<boolean>;
  maxSeconds?: number;
}) {
  const toast = useToast();
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [attempt, setAttempt] = useState(0);
  const [cameras, setCameras] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const release = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  // Open the camera and microphone (again after a retake or a camera switch); release them when done.
  useEffect(() => {
    if (!open || clip) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    (async () => {
      if (!canRecordVideo()) {
        setError("Video cannot be recorded here. Use the phone's camera app instead.");
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: VIDEO_WIDTH, max: VIDEO_WIDTH },
            height: { ideal: VIDEO_HEIGHT, max: VIDEO_WIDTH },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: true,
        });
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (live.current) {
          live.current.srcObject = s;
          void live.current.play().catch(() => undefined);
        }
        setReady(true);
        const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) setCameras(all.filter((d) => d.kind === "videoinput").length);
      } catch {
        if (!cancelled) setError("The camera or microphone is blocked. Allow access for FieldServe in the phone's settings, or use the phone's camera app.");
      }
    })();
    return () => {
      cancelled = true;
      release();
    };
  }, [open, facing, attempt, clip]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close only reads refs and the latest clip
  }, [open, clip]);

  if (!open) return null;

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };

  const start = () => {
    const s = stream.current;
    if (!s || recording) return;
    const mime = pickMime();
    const r = new MediaRecorder(s, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: VIDEO_BITRATE,
      audioBitsPerSecond: VIDEO_AUDIO_BITRATE,
    });
    recorder.current = r;
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    r.onstop = () => {
      setRecording(false);
      const blob = new Blob(chunks.current, { type: r.mimeType || mime || "video/webm" });
      if (blob.size === 0) return void toast.error("Nothing was recorded. Try again.");
      setClip({ blob, url: URL.createObjectURL(blob) });
    };
    r.start(1000);
    setSeconds(0);
    setRecording(true);
    timer.current = setInterval(() => {
      setSeconds((n) => {
        if (n + 1 >= maxSeconds) {
          stop();
          toast.success(`Stopped at ${maxSeconds} seconds, the longest this video can be.`);
        }
        return n + 1;
      });
    }, 1000);
  };

  const retake = () => {
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null);
    setAttempt((n) => n + 1);
  };

  const use = async () => {
    if (!clip) return;
    setSaving(true);
    const type = clip.blob.type.split(";")[0] || "video/webm";
    const ok = await onShot(new File([clip.blob], `video-${Date.now()}.${extOf(type)}`, { type }));
    setSaving(false);
    if (ok) {
      URL.revokeObjectURL(clip.url);
      onClose();
    }
  };

  function close() {
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    release();
    if (clip) URL.revokeObjectURL(clip.url);
    onClose();
  }

  const mb = clip ? (clip.blob.size / 1024 / 1024).toFixed(1) : "";
  const barButton = "flex items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-medium disabled:opacity-60";

  return (
    <div role="dialog" aria-modal="true" aria-label={`Video: ${title}`} className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <div className="flex items-center gap-2 px-4 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
        {recording && (
          <span className="flex items-center gap-1.5 text-xs tabular-nums">
            <span className="size-2 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
            {clock(seconds)} / {clock(maxSeconds)}
          </span>
        )}
        <button type="button" onClick={close} aria-label="Close video recorder" className="rounded-full p-2 active:bg-white/15">
          <X className="size-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <Video className="size-10 text-white/60" />
            <p className="max-w-xs text-sm text-white/80">{error}</p>
            <input
              ref={fallback}
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setSaving(true);
                const ok = await onShot(f);
                setSaving(false);
                if (ok) onClose();
              }}
            />
            <button type="button" className={`${barButton} bg-white/20`} onClick={() => fallback.current?.click()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} Open phone camera
            </button>
            <p className="max-w-xs text-xs text-white/60">Keep it under {maxSeconds} seconds.</p>
          </div>
        ) : clip ? (
          <video
            key={clip.url}
            src={clip.url}
            controls
            playsInline
            autoPlay
            preload="auto"
            className="size-full object-contain"
            onLoadedMetadata={(e) => showFirstFrame(e.currentTarget)}
          />
        ) : (
          <>
            <video ref={live} muted playsInline className="size-full object-contain" />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="size-8 animate-spin text-white/70" />
              </div>
            )}
          </>
        )}
      </div>

      {!error && (
        <div className="flex items-center justify-between gap-4 px-6 pt-5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}>
          {clip ? (
            <>
              <button type="button" className={`${barButton} bg-white/20`} onClick={retake} disabled={saving}>
                <RefreshCw className="size-4" /> Retake
              </button>
              <span className="text-xs text-white/70 tabular-nums">{mb} MB</span>
              <button type="button" className={`${barButton} bg-white text-black`} onClick={() => void use()} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Use video
              </button>
            </>
          ) : (
            <>
              <div className="w-20" />
              {recording ? (
                <button type="button" onClick={stop} aria-label="Stop recording" className="flex size-[72px] items-center justify-center rounded-full border-4 border-white">
                  <Square className="size-7 fill-red-500 text-red-500" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={start}
                  disabled={!ready}
                  aria-label="Start recording"
                  className="flex size-[72px] items-center justify-center rounded-full border-4 border-white disabled:opacity-50"
                >
                  <span className="size-14 rounded-full bg-red-500" />
                </button>
              )}
              <div className="flex w-20 justify-end">
                {cameras > 1 && !recording && (
                  <button
                    type="button"
                    onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
                    aria-label="Switch camera"
                    className="rounded-full p-3 active:bg-white/15"
                  >
                    <SwitchCamera className="size-6" />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
