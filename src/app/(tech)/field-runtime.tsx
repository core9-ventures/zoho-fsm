"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, MapPinOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recordLocationAction } from "@/modules/field/field.actions";

const EVERY_MS = 60_000;

/** Registers the service worker (production only) so the field app is installable and opens offline. */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      return;
    }
    // In development a worker left over from an earlier production run would serve stale code: remove it.
    navigator.serviceWorker
      .getRegistrations()
      .then((all) => all.forEach((r) => void r.unregister()))
      .catch(() => {});
  }, []);
  return null;
}

/**
 * Header indicator + background reporting. Sharing is always on for a technician (there is no switch):
 * while the app is open and visible, the phone's position is sent every minute so the dispatcher's live
 * map stays current. If the browser blocks location the pin turns red and says how to allow it.
 */
export function LocationSharing() {
  const [status, setStatus] = useState<"waiting" | "ok" | "blocked">("waiting");
  const warned = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const send = () => {
      if (document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition(
        (p) => {
          setStatus("ok");
          void recordLocationAction({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            speed: p.coords.speed != null && p.coords.speed >= 0 ? p.coords.speed : null,
            heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
          });
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setStatus("blocked");
            if (!warned.current) {
              warned.current = true;
              toast.error("Location is blocked. Allow location for this site in your browser settings; it is required.");
            }
          }
        },
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 30_000 },
      );
    };
    send();
    const t = setInterval(send, EVERY_MS);
    document.addEventListener("visibilitychange", send);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", send);
    };
  }, []);

  const blocked = status === "blocked";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() =>
        toast(
          blocked
            ? "Location is blocked. Allow location for this site in your browser settings, then reload."
            : "Location sharing is required and always on.",
        )
      }
      aria-label={blocked ? "Location is blocked. Allow it in browser settings." : "Location sharing is on (required)."}
      className={blocked ? "text-red-600" : "text-emerald-600"}
    >
      {blocked ? <MapPinOff /> : <MapPin />}
    </Button>
  );
}
