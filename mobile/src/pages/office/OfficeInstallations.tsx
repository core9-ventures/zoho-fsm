import { useState } from "react";
import { MapPin, PauseCircle } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { officeInstallations, type InstallationDetail as Detail, type InstallationListItem } from "../../api";
import { AuthImage } from "../../components/AuthImage";
import { ListScreen } from "../../components/ListScreen";
import { PutOnHoldDialog } from "../../components/PutOnHoldDialog";
import { useAsync } from "../../data/useAsync";
import { formatDateTime, formatDay } from "../../lib/format";
import { distanceKm } from "../../lib/geo";
import { Badge, Button, LoadError, Spinner } from "../../ui/kit";
import { KV, PageHeader, Section } from "../../ui/parts";
import { INSTALLATION_SLOTS, INSTALLATION_TEMP_SLOTS } from "@/modules/installations/installations.schema";

const SLOT_LABEL: Record<string, string> = Object.fromEntries([...INSTALLATION_SLOTS, ...INSTALLATION_TEMP_SLOTS].map((s) => [s.key, s.label]));

/** Installations of every technician. A completed one can be put back on hold from here or from its page. */
export function OfficeInstallations() {
  const [version, setVersion] = useState(0);
  const [target, setTarget] = useState<{ id: string; vehicleNo: string } | null>(null);

  return (
    <>
      <ListScreen<InstallationListItem>
        title="Installations"
        subtitle={(n) => `${n} found`}
        searchPlaceholder="Search vehicle, device ID, location, company"
        version={version}
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "", label: "All" },
              { value: "COMPLETED", label: "Completed" },
              { value: "ON_HOLD", label: "On hold" },
            ],
          },
        ]}
        fetchPage={(q) => officeInstallations.list(q)}
        itemKey={(i) => i.id}
        empty="No installations yet."
        renderItem={(i) => (
          <div className="bg-card space-y-2 rounded-xl border p-3">
            <Link to={`/installations/${i.id}`} className="block space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{i.vehicleNo || "(no vehicle no.)"}</p>
                {i.status === "ON_HOLD" ? <Badge tone="amber">On hold</Badge> : <Badge tone="green">Completed</Badge>}
              </div>
              <p className="text-muted-foreground text-sm">{[i.customerName, i.deviceType].filter(Boolean).join(" · ")}</p>
              <p className="text-muted-foreground text-xs">
                {[formatDay(i.installDate), i.deviceId, i.createdBy].filter(Boolean).join(" · ")}
              </p>
              {i.status === "ON_HOLD" && i.holdReason && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {i.holdBy ? `Put on hold by ${i.holdBy}: ` : "Reason: "}
                  {i.holdReason}
                </p>
              )}
              {i.thumbs.length > 0 && (
                <div className="flex gap-1.5 pt-1">
                  {i.thumbs.map((t) => (
                    <AuthImage key={t} id={t} className="size-12 rounded-md object-cover" />
                  ))}
                </div>
              )}
            </Link>
            {i.status === "COMPLETED" && (
              <Button variant="outline" onClick={() => setTarget({ id: i.id, vehicleNo: i.vehicleNo })} className="w-full py-2">
                <PauseCircle className="size-4" /> Put on hold
              </Button>
            )}
          </div>
        )}
      />
      <PutOnHoldDialog
        installation={target}
        onClose={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
          setVersion((v) => v + 1);
        }}
      />
    </>
  );
}

function FillLine({ label, pt, detail }: { label: string; pt: { lat: number; lng: number; accuracy: number | null; at: string }; detail: Detail }) {
  const away = detail.latitude != null && detail.longitude != null ? distanceKm(pt.lat, pt.lng, detail.latitude, detail.longitude) : null;
  return (
    <p className="text-sm">
      <span className="font-medium">{label}</span> at {pt.lat.toFixed(5)}, {pt.lng.toFixed(5)}
      {pt.accuracy != null ? ` (within ${pt.accuracy} m)` : ""} · {formatDateTime(pt.at)}
      {away != null && (
        <span className={away > 1 ? "font-medium text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
          {" · "}
          {away < 0.1 ? "at the install location" : `${away.toFixed(1)} km from the install location`}
        </span>
      )}{" "}
      <a href={`https://www.google.com/maps/search/?api=1&query=${pt.lat},${pt.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs underline">
        <MapPin className="size-3" /> View where
      </a>
    </p>
  );
}

/** One installation: details, where the technician filled it in (old and new), photos, and Put on hold. */
export function OfficeInstallationDetail() {
  const { id = "" } = useParams();
  const { data: i, error, loading, reload } = useAsync(() => officeInstallations.get(id), [id]);
  const [target, setTarget] = useState<{ id: string; vehicleNo: string } | null>(null);

  if (!i) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;

  return (
    <div className="space-y-4">
      <PageHeader title={i.vehicleNo || "(no vehicle no.)"} subtitle={[i.customerName, formatDay(i.installDate)].join(" · ")} back={{ to: "/installations", label: "Installations" }} />
      <div className="flex flex-wrap items-center gap-2">
        {i.status === "ON_HOLD" ? <Badge tone="amber">On hold</Badge> : <Badge tone="green">Completed</Badge>}
        {i.createdBy && <span className="text-muted-foreground text-xs">recorded by {i.createdBy}</span>}
      </div>
      {i.status === "ON_HOLD" && i.holdReason && (
        <p className="rounded-md border border-amber-500/60 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          {i.holdBy ? `Put on hold by ${i.holdBy}${i.holdAt ? ` on ${formatDateTime(i.holdAt)}` : ""}: ` : "On hold because: "}
          {i.holdReason}
        </p>
      )}

      {i.status === "COMPLETED" && (
        <Button variant="outline" onClick={() => setTarget({ id: i.id, vehicleNo: i.vehicleNo })}>
          <PauseCircle className="size-4" /> Put on hold
        </Button>
      )}

      <Section>
        <KV
          rows={[
            ["Device type", i.deviceType],
            ["Device ID", i.deviceId],
            ["SIM No.", i.simNo],
            ["Location", i.location],
            ["Notes", i.notes],
          ]}
        />
      </Section>

      {(i.fill || i.fillHistory.length > 0) && (
        <Section title="Where it was filled in">
          {i.fillHistory.map((h, n) => (
            <FillLine key={h.at} label={`Earlier fill-in ${n + 1}`} pt={h} detail={i} />
          ))}
          {i.fill && <FillLine label={i.fillHistory.length > 0 ? "Latest fill-in" : "Filled in"} pt={i.fill} detail={i} />}
        </Section>
      )}

      <Section title="Photos">
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
      </Section>

      <PutOnHoldDialog
        installation={target}
        onClose={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
          void reload();
        }}
      />
    </div>
  );
}
