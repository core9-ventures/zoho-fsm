/** A position read from the phone. */
export type Fix = { lat: number; lng: number; accuracy: number };

export type GeoResult = { fix: Fix } | { error: "blocked" | "unavailable" | "unsupported" };

/**
 * Reads where the phone is right now. Fails with a reason: "blocked" when the technician refused location (or the
 * phone's location is off), "unavailable" when no position came in time.
 */
export function readPosition(timeoutMs: number, highAccuracy = true): Promise<GeoResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({ error: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      (err) => resolve({ error: err.code === err.PERMISSION_DENIED ? "blocked" : "unavailable" }),
      { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 0 },
    );
  });
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
