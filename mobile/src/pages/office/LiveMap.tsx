import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { liveApi, type LiveTechnician } from "../../api";
import { useAsync } from "../../data/useAsync";
import { Badge, LoadError, Spinner } from "../../ui/kit";
import { PageHeader } from "../../ui/parts";

const STALE_MS = 15 * 60_000;
const REFRESH_MS = 30_000;

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
};

/** Names and job titles come from the database: never put them into HTML unescaped. */
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** A round, colored pin with the technician's initials; faded when the position is old. */
const pin = (t: LiveTechnician, stale: boolean) =>
  L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="width:34px;height:34px;border-radius:9999px;background:${/^#[0-9a-fA-F]{3,8}$/.test(t.color) ? t.color : "#3b82f6"};color:#fff;display:flex;align-items:center;justify-content:center;font:600 12px system-ui;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);opacity:${stale ? 0.45 : 1}">${esc(initials(t.name))}</div>`,
  });

/** Where the technicians are now. Positions come from the field app while it is open; faded pins are older than 15 minutes. */
export function LiveMap() {
  const { data, error, loading, reload } = useAsync(() => liveApi.technicians());
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const [, tick] = useState(0);

  // Refresh by itself while the screen is open.
  useEffect(() => {
    const t = setInterval(() => {
      void reload();
      tick((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  // Create the map once.
  useEffect(() => {
    if (!holder.current || map.current) return;
    const m = L.map(holder.current, { zoomControl: true, attributionControl: true }).setView([30.3753, 69.3451], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Put the pins on the map.
  useEffect(() => {
    if (!map.current || !layer.current || !data) return;
    layer.current.clearLayers();
    const points: L.LatLngTuple[] = [];
    for (const t of data) {
      if (!t.location) continue;
      const stale = Date.now() - new Date(t.location.recordedAt).getTime() > STALE_MS;
      const at: L.LatLngTuple = [t.location.latitude, t.location.longitude];
      points.push(at);
      L.marker(at, { icon: pin(t, stale), title: t.name })
        .bindPopup(`<strong>${esc(t.name)}</strong><br/>${t.job ? esc(`${t.job.number} · ${t.job.title}`) : "No job right now"}<br/>${ago(t.location.recordedAt)}`)
        .addTo(layer.current);
    }
    if (points.length > 0 && !fitted.current) {
      map.current.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
      fitted.current = true;
    }
  }, [data]);

  const located = data?.filter((t) => t.location) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="Live map" subtitle={data ? `${located.length} of ${data.length} technicians have a position` : undefined} />
      {error && !data && <LoadError error={error} onRetry={() => void reload()} />}

      <div ref={holder} className="isolate h-[45vh] min-h-64 w-full overflow-hidden rounded-xl border" aria-label="Map of technician positions" />

      {loading && !data ? (
        <Spinner />
      ) : (
        <ul className="space-y-2">
          {(data ?? []).map((t) => {
            const stale = t.location ? Date.now() - new Date(t.location.recordedAt).getTime() > STALE_MS : true;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={!t.location}
                  onClick={() => t.location && map.current?.flyTo([t.location.latitude, t.location.longitude], 16)}
                  className="bg-card flex w-full items-center gap-3 rounded-xl border p-3 text-left disabled:opacity-70"
                >
                  <span className="size-3 shrink-0 rounded-full" style={{ background: t.color, opacity: stale ? 0.4 : 1 }} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {t.job ? `${t.job.number} · ${t.job.title}` : "No job right now"}
                    </span>
                  </span>
                  {t.location ? <Badge tone={stale ? "muted" : "green"}>{ago(t.location.recordedAt)}</Badge> : <Badge>No position</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
