import { useEffect, useRef, useState } from "react";
import { MapPin, MapPinOff } from "lucide-react";
import { fieldLocation } from "../api";
import { useToast } from "../ui/toast";

const EVERY_MS = 60_000;

/**
 * Header pin + background reporting for technicians. Sharing is always on (there is no switch): while the app is
 * open and visible, the phone's position is sent every minute so the dispatcher's live map stays current. If the
 * phone blocks location the pin turns red and says how to allow it.
 */
export function LocationSharing() {
  const toast = useToast();
  const [status, setStatus] = useState<"waiting" | "ok" | "blocked">("waiting");
  const warned = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const send = () => {
      if (document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition(
        (p) => {
          setStatus("ok");
          warned.current = false;
          void fieldLocation
            .record({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy: p.coords.accuracy,
              speed: p.coords.speed != null && p.coords.speed >= 0 ? p.coords.speed : null,
              heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
            })
            .catch(() => {
              /* no signal right now: the next reading goes out in a minute */
            });
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setStatus("blocked");
            if (!warned.current) {
              warned.current = true;
              toast.error("Location is blocked, so the dispatcher cannot see you. Allow it in your phone settings.");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocked = status === "blocked";
  return (
    <button
      type="button"
      onClick={() =>
        toast[blocked ? "error" : "success"](
          blocked
            ? "Location is blocked. Allow location for FieldServe in your phone settings."
            : "Location sharing is required and always on.",
        )
      }
      aria-label={blocked ? "Location is blocked." : "Location sharing is on (required)."}
      className={`rounded-md p-2 ${blocked ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
    >
      {blocked ? <MapPinOff className="size-5" /> : <MapPin className="size-5" />}
    </button>
  );
}
