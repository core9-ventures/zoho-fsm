import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { attachments } from "../api";

// Pictures already fetched in this session (small thumbnails), so scrolling back does not download them again.
const cache = new Map<string, string>();

/**
 * A saved photo. The server only serves photos to a signed-in user, and an <img> tag cannot send the sign-in
 * header, so the picture is fetched with the app's HTTP client and shown from memory.
 */
export function AuthImage({ id, thumb = true, alt = "", className = "" }: { id: string; thumb?: boolean; alt?: string; className?: string }) {
  const key = `${id}:${thumb ? "t" : "f"}`;
  const [src, setSrc] = useState<string | null>(cache.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const known = cache.get(key);
    if (known) {
      setSrc(known);
      return;
    }
    let cancelled = false;
    setFailed(false);
    attachments
      .blob(id, thumb)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        cache.set(key, url);
        if (!cancelled) setSrc(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id, thumb, key]);

  if (failed) {
    return (
      <div className={`bg-muted text-muted-foreground flex items-center justify-center ${className}`} role="img" aria-label="Photo could not load">
        <ImageOff className="size-5" />
      </div>
    );
  }
  if (!src) return <div className={`bg-muted animate-pulse ${className}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

/** Forget everything fetched (when someone signs out). */
export function clearImageCache() {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}
