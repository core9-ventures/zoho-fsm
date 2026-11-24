import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { fieldInstallations } from "../api";
import { AuthImage } from "../components/AuthImage";
import { useAsync } from "../data/useAsync";
import { formatDateTime, formatDay } from "../lib/format";
import { INSTALLATION_SLOTS, INSTALLATION_TEMP_SLOTS } from "@/modules/installations/installations.schema";
import { LoadError, Spinner } from "../ui/kit";

const SLOT_LABEL: Record<string, string> = Object.fromEntries(
  [...INSTALLATION_SLOTS, ...INSTALLATION_TEMP_SLOTS].map((s) => [s.key, s.label]),
);

/** A completed installation, read only. To change it the technician asks the office to put it on hold. */
export function InstallationView() {
  const { id = "" } = useParams();
  const { data: i, error, loading, reload } = useAsync(() => fieldInstallations.get(id), [id]);

  useEffect(() => window.scrollTo(0, 0), []);

  if (!i) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;
  // A held record is carried on in the form.
  if (i.status === "ON_HOLD") return <Navigate to={`/new-installation/${i.id}`} replace />;

  const rows: [string, string | null][] = [
    ["Company", i.customerName],
    ["Date", formatDay(i.installDate)],
    ["Device type", i.deviceType],
    ["Device ID", i.deviceId],
    ["SIM No.", i.simNo],
    ["Location", i.location],
    ["Notes", i.notes],
  ];

  return (
    <div className="space-y-4">
      <div>
        <Link to="/my-jobs" className="text-muted-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" /> My jobs
        </Link>
        <h1 className="text-xl font-semibold">{i.vehicleNo}</h1>
        <p className="text-muted-foreground text-sm">Completed. To change it, ask the dispatcher to put it on hold.</p>
      </div>

      <dl className="bg-card grid grid-cols-[7rem_1fr] gap-y-2 rounded-xl border p-4 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        {i.fill && (
          <>
            <dt className="text-muted-foreground">Filled in at</dt>
            <dd>
              {i.fill.lat.toFixed(5)}, {i.fill.lng.toFixed(5)} · {formatDateTime(i.fill.at)}
            </dd>
          </>
        )}
      </dl>

      <section className="bg-card space-y-3 rounded-xl border p-4">
        <h2 className="font-semibold">Photos</h2>
        {i.files.length + i.photos.length === 0 ? (
          <p className="text-muted-foreground text-sm">No photos.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {[...i.files, ...i.photos].map((f) => (
              <div key={f.id} className="space-y-1">
                <p className="truncate text-xs font-medium">{f.slot ? (SLOT_LABEL[f.slot] ?? f.slot) : f.kind === "VIDEO" ? "Device video" : "Other photo"}</p>
                {f.kind === "VIDEO" ? (
                  <p className="bg-muted text-muted-foreground flex aspect-[4/3] items-center justify-center rounded-md text-xs">Video saved</p>
                ) : (
                  <AuthImage id={f.id} className="aspect-[4/3] w-full rounded-md object-cover" />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
