/** A position read from the phone. */
export type Fix = { lat: number; lng: number; accuracy: number };

export type GeoResult = { fix: Fix } | { error: "blocked" | "unavailable" | "unsupported" };

/** The last position the phone gave (from a form, or from the background reading every minute) and when. */
let lastFix: { fix: Fix; at: number } | null = null;
/** A saved position this recent is accepted when a new one cannot be had (indoors, airplane mode, cold GPS). */
const LAST_FIX_MAX_AGE_MS = 10 * 60_000;

export const rememberFix = (fix: Fix) => {
  lastFix = { fix, at: Date.now() };
};

type Attempt = { fix: Fix } | { error: "blocked" | "unavailable" };

function attempt(timeout: number, enableHighAccuracy: boolean, maximumAge: number): Promise<Attempt> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      (err) => resolve({ error: err.code === err.PERMISSION_DENIED ? "blocked" : "unavailable" }),
      { enableHighAccuracy, timeout, maximumAge },
    );
  });
}

/**
 * Reads where the phone is right now. Fails with a reason: "blocked" when the technician refused location (or the
 * phone's location is off), "unavailable" when no position came in time.
 *
 * A fresh GPS fix can take a long time indoors or in airplane mode (the phone has no network to help it), so when
 * the fresh attempt fails the phone tries a quick, less exact reading, and then the last position it knew if that is
 * at most 10 minutes old. Only if all of that fails does the technician see an error.
 */
export async function readPosition(timeoutMs: number, highAccuracy = true): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { error: "unsupported" };
  const fresh = await attempt(timeoutMs, highAccuracy, 0);
  if ("fix" in fresh) {
    rememberFix(fresh.fix);
    return fresh;
  }
  if (fresh.error === "blocked") return fresh;
  const quick = await attempt(4_000, false, LAST_FIX_MAX_AGE_MS);
  if ("fix" in quick) {
    rememberFix(quick.fix);
    return quick;
  }
  if (lastFix && Date.now() - lastFix.at <= LAST_FIX_MAX_AGE_MS) return { fix: lastFix.fix };
  return { error: "unavailable" };
}

export const GEO_MESSAGE: Record<"blocked" | "unavailable" | "unsupported", string> = {
  blocked: "Location is blocked. Turn on location and allow it for FieldServe in your phone settings.",
  unavailable: "Could not get your location. Move to an open area and try again.",
  unsupported: "This phone cannot share its location.",
};

/** Straight-line distance between two points, in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
