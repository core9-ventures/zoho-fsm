import { useRef, useState } from "react";
import { Camera, Loader2, Play, RotateCcw, Trash2, Video } from "lucide-react";
import { attachments } from "../api";
import { shrinkPhoto, videoSeconds } from "../lib/photo";
import { useToast } from "../ui/toast";
import { AuthImage } from "./AuthImage";

/** One photo or video of the grid: already on the server (`remoteId`) or chosen on the phone and waiting (`local`). */
export type PhotoItem = {
  key: string;
  slot: string | null;
  kind: "PHOTO" | "VIDEO";
  name: string;
  remoteId?: string;
  local?: { file: File; url: string };
};

type Slot = { key: string; label: string };

type Props = {
  title: string;
  /** One labeled box each; a new photo replaces the old one. */
  slots: readonly Slot[];
  items: PhotoItem[];
  /** One short video (the Device video of an installation). */
  video?: { label: string; maxSeconds: number };
  /** Extra photos without a label. */
  other?: { max: number };
  disabled?: boolean;
  onPhoto: (slot: string | null, file: File) => Promise<void> | void;
  onVideo?: (file: File) => Promise<void> | void;
  onRemove: (item: PhotoItem) => Promise<void> | void;
  /** Shown under the title, e.g. how many labeled photos are still missing. */
  hint?: string;
};

/** Labeled photo boxes with the phone camera, a short video and "Other photos". Used by installations and jobs. */
export function PhotoGrid({ title, slots, items, video, other, disabled, onPhoto, onVideo, onRemove, hint }: Props) {
  const toast = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const bySlot = (slot: string) => items.find((i) => i.slot === slot && i.kind === "PHOTO");
  const videoItem = items.find((i) => i.kind === "VIDEO");
  const others = items.filter((i) => !i.slot && i.kind === "PHOTO");

  async function run(key: string, work: () => Promise<void> | void) {
    setBusyKey(key);
    try {
      await work();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the file.");
    } finally {
      setBusyKey(null);
    }
  }

  const photoChosen = (key: string, slot: string | null) => async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Choose a photo.");
    await run(key, async () => onPhoto(slot, await shrinkPhoto(file)));
  };

  const videoChosen = async (file: File) => {
    if (!video || !onVideo) return;
    if (!file.type.startsWith("video/")) return toast.error("Choose a video.");
    const seconds = await videoSeconds(file);
    if (seconds != null && seconds > video.maxSeconds + 0.5)
      return toast.error(`The video can be at most ${video.maxSeconds} seconds. Record a shorter one.`);
    await run("video", () => onVideo(file));
  };

  return (
    <section className="bg-card space-y-3 rounded-xl border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-muted-foreground text-xs">
          {items.filter((i) => i.slot || i.kind === "VIDEO").length}/{slots.length + (video ? 1 : 0)}
        </span>
      </div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}

      <div className="grid grid-cols-2 gap-3">
        {slots.map((s) => (
          <Tile
            key={s.key}
            label={s.label}
            item={bySlot(s.key)}
            busy={busyKey === s.key}
            disabled={disabled}
            accept="image/*"
            onFile={photoChosen(s.key, s.key)}
            onRemove={(i) => run(s.key, () => onRemove(i))}
          />
        ))}
        {video && onVideo && (
          <Tile
            label={`${video.label} video (max ${video.maxSeconds}s)`}
            item={videoItem}
            busy={busyKey === "video"}
            disabled={disabled}
            accept="video/*"
            isVideo
            onFile={videoChosen}
            onRemove={(i) => run("video", () => onRemove(i))}
          />
        )}
      </div>

      {other && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Other photos <span className="text-muted-foreground font-normal">({others.length}/{other.max})</span>
          </p>
          {others.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {others.map((o) => (
                <div key={o.key} className="relative">
                  <Thumb item={o} className="aspect-square w-full rounded-md object-cover" />
                  {!disabled && (
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => void run(o.key, () => onRemove(o))}
                      className="absolute top-1 right-1 rounded-md bg-black/70 p-1.5 text-white"
                    >
                      {busyKey === o.key ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!disabled && others.length < other.max && (
            <PickButton
              accept="image/*"
              busy={busyKey === "other"}
              onFile={photoChosen("other", null)}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed py-3 text-sm font-medium"
            >
              <Camera className="size-4" /> Add another photo
            </PickButton>
          )}
        </div>
      )}
    </section>
  );
}

function Thumb({ item, className }: { item: PhotoItem; className: string }) {
  if (item.local) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.local.url} alt={item.name} className={className} />;
  }
  return <AuthImage id={item.remoteId!} alt={item.name} className={className} />;
}

/** A button that opens the phone's camera (or the file chooser on a computer). */
function PickButton({
  accept,
  onFile,
  busy,
  className,
  children,
  label,
}: {
  accept: string;
  onFile: (file: File) => void;
  busy?: boolean;
  className: string;
  children: React.ReactNode;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        aria-label={label}
        onClick={() => input.current?.click()}
        className={`${className} disabled:opacity-60`}
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : children}
      </button>
    </>
  );
}

function Tile({
  label,
  item,
  busy,
  disabled,
  accept,
  isVideo,
  onFile,
  onRemove,
}: {
  label: string;
  item?: PhotoItem;
  busy: boolean;
  disabled?: boolean;
  accept: string;
  isVideo?: boolean;
  onFile: (file: File) => void;
  onRemove: (item: PhotoItem) => void;
}) {
  const Icon = isVideo ? Video : Camera;
  return (
    <div className="space-y-1.5">
      <p className="truncate text-xs font-medium">{label}</p>
      {item ? (
        <div className="space-y-1.5">
          {isVideo ? <VideoPreview item={item} /> : <Thumb item={item} className="aspect-[4/3] w-full rounded-md object-cover" />}
          {!disabled && (
            <div className="grid grid-cols-2 gap-1.5">
              <PickButton
                accept={accept}
                busy={busy}
                onFile={onFile}
                label={`Retake ${label}`}
                className="bg-muted flex items-center justify-center gap-1 rounded-md py-2 text-xs font-medium"
              >
                <RotateCcw className="size-3.5" /> Retake
              </PickButton>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(item)}
                aria-label={`Delete ${label}`}
                className="bg-muted text-destructive flex items-center justify-center gap-1 rounded-md py-2 text-xs font-medium disabled:opacity-60"
              >
                <Trash2 className="size-3.5" /> Delete
              </button>
            </div>
          )}
        </div>
      ) : (
        <PickButton
          accept={accept}
          busy={busy}
          onFile={onFile}
          label={`Add ${label}`}
          className="text-muted-foreground flex aspect-[4/3] w-full items-center justify-center rounded-md border-2 border-dashed"
        >
          <Icon className="size-7" />
        </PickButton>
      )}
    </div>
  );
}

/** A saved video is fetched when tapped (it needs the sign-in header); a chosen one plays straight away. */
function VideoPreview({ item }: { item: PhotoItem }) {
  const [url, setUrl] = useState<string | null>(item.local?.url ?? null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  if (url) return <video src={url} controls playsInline className="aspect-[4/3] w-full rounded-md bg-black object-contain" />;
  return (
    <button
      type="button"
      onClick={async () => {
        setLoading(true);
        try {
          setUrl(URL.createObjectURL(await attachments.blob(item.remoteId!, false)));
        } catch {
          toast.error("Could not load the video.");
        } finally {
          setLoading(false);
        }
      }}
      className="bg-muted flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-md text-xs font-medium"
    >
      {loading ? <Loader2 className="size-6 animate-spin" /> : <Play className="size-6" />}
      Play video
    </button>
  );
}
