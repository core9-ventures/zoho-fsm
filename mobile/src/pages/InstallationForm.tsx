import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Eraser, LocateFixed, PauseCircle, X } from "lucide-react";
import { useBlocker, useNavigate } from "react-router-dom";
import {
  ApiError,
  fieldInstallations,
  type CustomerChoice,
  type HoldInstallationInput,
  type InstallationDetail,
  type InstallationInput,
} from "../api";
import { PhotoGrid, type PhotoItem } from "../components/PhotoGrid";
import { GEO_MESSAGE, readPosition, type Fix } from "../lib/geo";
import { todayLocal } from "../lib/format";
import {
  DEVICE_TYPES,
  INSTALLATION_CHECKLIST as CHECKLIST,
  INSTALLATION_SLOTS,
  INSTALLATION_VIDEO_SECONDS,
  createInstallationSchema,
} from "@/modules/installations/installations.schema";
import { Button, Field, Modal, inputClass } from "../ui/kit";
import { useToast } from "../ui/toast";

type FieldKey = "vehicleNo" | "deviceId" | "company" | "date" | "location" | "deviceType" | "simNo" | "notes";
type Errors = Partial<Record<FieldKey, string>>;

/** Where the server's (and the shared schema's) field names show up on this form. */
const FIELD_OF: Record<string, FieldKey> = {
  vehicleNo: "vehicleNo",
  deviceId: "deviceId",
  customerId: "company",
  installDate: "date",
  location: "location",
  latitude: "location",
  longitude: "location",
  deviceType: "deviceType",
  simNo: "simNo",
  notes: "notes",
};

const OTHER_PHOTO_LIMIT = 15;

type Pin = { lat: number; lng: number } | null;

/**
 * The new installation form, and (with `held`) the form of a record that was put on hold.
 * Add Record completes it, Put on hold saves it with a reason, and leaving with unsaved work asks first.
 */
export function InstallationForm({ customers, held }: { customers: CustomerChoice[]; held?: InstallationDetail }) {
  const navigate = useNavigate();
  const toast = useToast();

  const [vehicleNo, setVehicleNo] = useState(held?.vehicleNo ?? "");
  const [deviceId, setDeviceId] = useState(held?.deviceId ?? "");
  const [company, setCompany] = useState(held?.customerId ?? "");
  const [date, setDate] = useState(held?.installDate ?? todayLocal());
  const [location, setLocation] = useState(held?.location ?? "");
  const [pin, setPin] = useState<Pin>(
    held?.latitude != null && held?.longitude != null ? { lat: held.latitude, lng: held.longitude } : null,
  );
  const [deviceType, setDeviceType] = useState(held?.deviceType ?? "");
  const [simNo, setSimNo] = useState(held?.simNo ?? "");
  const [checked, setChecked] = useState<string[]>(held ? held.checklist : [...CHECKLIST]);
  const [notes, setNotes] = useState(held?.notes ?? "");
  const [showChecklist, setShowChecklist] = useState(false);

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  // Photos. A new form keeps them on the phone until Add Record; a held record's photos are saved at once.
  const [local, setLocal] = useState<PhotoItem[]>([]);
  const [remote, setRemote] = useState<PhotoItem[]>(() => remoteItems(held));
  const items = held ? remote : local;
  const localRef = useRef<PhotoItem[]>([]);
  localRef.current = local;
  useEffect(
    () => () => {
      for (const p of localRef.current) if (p.local) URL.revokeObjectURL(p.local.url);
    },
    [],
  );

  // Hold dialog
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState(held?.holdBy ? "" : (held?.holdReason ?? ""));
  const [reasonError, setReasonError] = useState("");
  const [clearOpen, setClearOpen] = useState(false);

  // ---- Leaving with unsaved information: ask to put it on hold (or discard) first. ----
  const snapshot = JSON.stringify([vehicleNo, deviceId, company, date, location, pin, deviceType, simNo, checked, notes]);
  const initial = useRef<string | null>(null);
  if (initial.current === null) initial.current = snapshot;
  const dirty = snapshot !== initial.current || (!held && local.length > 0);
  const allowLeave = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname,
  );
  const leaveOpen = blocker.state === "blocked" && !holdOpen;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Finished (saved, held or discarded): go on to where the technician was heading, or home. */
  function goOn() {
    allowLeave.current = true;
    if (blocker.state === "blocked") blocker.proceed();
    else navigate("/my-jobs");
  }

  const sites = useMemo(() => customers.find((c) => c.id === company)?.sites ?? [], [customers, company]);

  function reset() {
    setVehicleNo("");
    setDeviceId("");
    setCompany("");
    setDate(todayLocal());
    setLocation("");
    setPin(null);
    setDeviceType("");
    setSimNo("");
    setChecked([...CHECKLIST]);
    setNotes("");
    setReason("");
    for (const p of localRef.current) if (p.local) URL.revokeObjectURL(p.local.url);
    setLocal([]);
    setErrors({});
    setFormError(null);
    initial.current = JSON.stringify(["", "", "", todayLocal(), "", null, "", "", [...CHECKLIST], ""]);
  }

  const values = () => ({
    vehicleNo,
    deviceId,
    simNo,
    installDate: date,
    location,
    latitude: pin ? pin.lat.toFixed(6) : "",
    longitude: pin ? pin.lng.toFixed(6) : "",
    hasTempSensor: false,
    checklist: checked as (typeof CHECKLIST)[number][],
    notes,
  });

  // ---- Location of the installation: a saved site of the company, typed text, or the phone's position. ----
  async function useMyLocation() {
    setLocating(true);
    const res = await readPosition(15_000);
    setLocating(false);
    if ("error" in res) return toast.error(GEO_MESSAGE[res.error]);
    setPin({ lat: res.fix.lat, lng: res.fix.lng });
    if (!location.trim()) setLocation(`${res.fix.lat.toFixed(6)}, ${res.fix.lng.toFixed(6)}`);
  }

  // ---- Photos ----
  async function refreshRemote() {
    if (!held) return;
    setRemote(remoteItems(await fieldInstallations.get(held.id)));
  }

  async function addPhoto(slot: string | null, file: File) {
    if (held) {
      await fieldInstallations.uploadFile(held.id, file, file.name, slot ?? undefined);
      await refreshRemote();
      return;
    }
    const entry: PhotoItem = {
      key: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      slot,
      kind: "PHOTO",
      name: file.name,
      local: { file, url: URL.createObjectURL(file) },
    };
    setLocal((list) => {
      // A labeled box holds one photo: a new one replaces the old.
      const gone = slot ? list.filter((p) => p.slot === slot) : [];
      for (const g of gone) if (g.local) URL.revokeObjectURL(g.local.url);
      if (!slot && list.filter((p) => !p.slot && p.kind === "PHOTO").length >= OTHER_PHOTO_LIMIT) {
        URL.revokeObjectURL(entry.local!.url);
        toast.error(`You can add up to ${OTHER_PHOTO_LIMIT} other photos.`);
        return list;
      }
      return [...list.filter((p) => !gone.includes(p)), entry];
    });
  }

  async function addVideo(file: File) {
    if (held) {
      await fieldInstallations.uploadFile(held.id, file, file.name);
      await refreshRemote();
      return;
    }
    const entry: PhotoItem = {
      key: `local-video-${Date.now()}`,
      slot: null,
      kind: "VIDEO",
      name: file.name,
      local: { file, url: URL.createObjectURL(file) },
    };
    setLocal((list) => {
      for (const g of list.filter((p) => p.kind === "VIDEO")) if (g.local) URL.revokeObjectURL(g.local.url);
      return [...list.filter((p) => p.kind !== "VIDEO"), entry];
    });
  }

  async function removePhoto(item: PhotoItem) {
    if (held && item.remoteId) {
      await fieldInstallations.deleteFile(held.id, item.remoteId);
      await refreshRemote();
      return;
    }
    if (item.local) URL.revokeObjectURL(item.local.url);
    setLocal((list) => list.filter((p) => p.key !== item.key));
  }

  /** Uploads the photos chosen on a new form once its record exists. Returns how many failed. */
  async function uploadLocal(id: string) {
    let failed = 0;
    for (const p of local) {
      if (!p.local) continue;
      try {
        await fieldInstallations.uploadFile(id, p.local.file, p.local.file.name, p.slot ?? undefined);
      } catch {
        failed++;
      }
    }
    return failed;
  }

  // ---- Errors from the server go to the matching field. ----
  function showServerError(e: unknown) {
    if (e instanceof ApiError) {
      const next: Errors = {};
      for (const [k, msgs] of Object.entries(e.fieldErrors)) {
        const f = FIELD_OF[k];
        if (f && msgs[0]) next[f] = msgs[0];
      }
      setErrors(next);
      setFormError(e.message);
      toast.error(e.message);
    } else {
      setFormError("Something went wrong. Please try again.");
    }
  }

  // ---- Add Record ----
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Errors = {};
    if (!vehicleNo.trim()) next.vehicleNo = "Enter the vehicle number.";
    if (!deviceId.trim()) next.deviceId = "Enter the device ID.";
    if (!company) next.company = "Choose a company.";
    if (!date) next.date = "Choose the date.";
    if (!location.trim()) next.location = "Enter the location.";
    if (!deviceType) next.deviceType = "Choose the device type.";
    if (!simNo.trim()) next.simNo = "Enter the SIM number.";

    // The same rules as the server (SIM digits, coordinates, lengths).
    const parsed = createInstallationSchema.safeParse({
      ...values(),
      customerId: company || "x",
      deviceType,
      fill: null,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const f = FIELD_OF[String(issue.path[0])];
        if (f && !next[f]) next[f] = issue.message;
      }
    }
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) {
      toast.error("Check the fields marked in red.");
      return;
    }

    setBusy(true);
    try {
      // Where the technician is when saving: the office checks they were on site.
      const pos = await readPosition(15_000);
      if ("error" in pos) {
        const message = `${GEO_MESSAGE[pos.error]} It is needed to record that you are on site.`;
        setFormError(message);
        toast.error(message);
        return;
      }
      const input: InstallationInput = {
        ...values(),
        customerId: company,
        deviceType: deviceType as (typeof DEVICE_TYPES)[number],
        fill: { lat: pos.fix.lat, lng: pos.fix.lng, accuracy: pos.fix.accuracy },
      };
      if (held) {
        const res = await fieldInstallations.complete(held.id, input);
        toast.success(
          res.queued
            ? `Record for ${vehicleNo.trim().toUpperCase()} saved on this phone. It is sent when you have a signal.`
            : `Record for ${vehicleNo.trim().toUpperCase()} saved.`,
        );
        goOn();
        return;
      }
      const { id, queued } = await fieldInstallations.create(input);
      if (queued) {
        if (local.length > 0) toast.error("Photos could not be saved without a signal. Take them again once you are online.");
        toast.success(`Record for ${vehicleNo.trim().toUpperCase()} saved on this phone. It is sent when you have a signal.`);
      } else {
        const failed = await uploadLocal(id);
        if (failed > 0) toast.error(`${failed} file${failed === 1 ? "" : "s"} could not be uploaded. The record itself is saved.`);
        else toast.success(`Record for ${vehicleNo.trim().toUpperCase()} saved.`);
      }
      reset();
      goOn();
    } catch (err) {
      showServerError(err);
    } finally {
      setBusy(false);
    }
  }

  // ---- Put on hold (a reason is required) ----
  async function putOnHold() {
    if (!reason.trim()) {
      setReasonError("Tell us why you are putting it on hold.");
      return;
    }
    setReasonError("");
    setBusy(true);
    try {
      const pos = await readPosition(8_000);
      const fix: Fix | null = "fix" in pos ? pos.fix : null;
      const input: HoldInstallationInput = {
        ...values(),
        customerId: company,
        deviceType: deviceType as (typeof DEVICE_TYPES)[number] | "",
        holdReason: reason,
        fill: fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null,
      };
      if (held) {
        const res = await fieldInstallations.updateHeld(held.id, input);
        toast.success(res.queued ? "Put on hold on this phone. It is sent when you have a signal." : "Put on hold.");
        goOn();
        return;
      }
      const { id, queued } = await fieldInstallations.hold(input);
      if (queued) {
        if (local.length > 0) toast.error("Photos could not be saved without a signal. Take them again once you are online.");
        toast.success("Put on hold on this phone. It is sent when you have a signal.");
      } else {
        const failed = await uploadLocal(id);
        if (failed > 0) toast.error(`${failed} file${failed === 1 ? "" : "s"} could not be uploaded to the held record.`);
        else toast.success("Put on hold. Find it under On hold on My jobs.");
      }
      reset();
      setHoldOpen(false);
      goOn();
    } catch (err) {
      setHoldOpen(false);
      showServerError(err);
    } finally {
      setBusy(false);
    }
  }

  // ---- Clear all ----
  async function clearAll() {
    setClearOpen(false);
    if (held) {
      // On a held record this deletes the record itself (and its photos).
      setBusy(true);
      try {
        const res = await fieldInstallations.discard(held.id);
        toast.success(res.queued ? "Deleted on this phone. It is removed from the server when you have a signal." : "Held installation deleted.");
        goOn();
      } catch (err) {
        showServerError(err);
      } finally {
        setBusy(false);
      }
      return;
    }
    reset();
  }

  const allChecked = checked.length === CHECKLIST.length;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {formError && (
        <p role="alert" className="border-destructive/50 text-destructive rounded-md border px-3 py-2 text-sm">
          {formError}
        </p>
      )}

      <section className="bg-card space-y-4 rounded-xl border p-4">
        <h2 className="font-semibold">Add new record</h2>
        <Field label="Vehicle No." htmlFor="vehicleNo" error={errors.vehicleNo}>
          <input id="vehicleNo" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} autoCapitalize="characters" aria-invalid={!!errors.vehicleNo} className={inputClass} />
        </Field>
        <Field label="Device ID" htmlFor="deviceId" error={errors.deviceId}>
          <input id="deviceId" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} autoCapitalize="characters" aria-invalid={!!errors.deviceId} className={inputClass} />
        </Field>
        <Field label="Company Name" htmlFor="company" error={errors.company}>
          <select id="company" value={company} onChange={(e) => setCompany(e.target.value)} aria-invalid={!!errors.company} className={inputClass}>
            <option value="">Choose a company…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date" htmlFor="date" error={errors.date}>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date} className={inputClass} />
        </Field>

        <Field label="Location" htmlFor="location" error={errors.location}>
          <div className="space-y-2">
            <select
              aria-label="Saved company sites"
              value=""
              disabled={sites.length === 0}
              onChange={(e) => {
                const site = sites.find((x) => x.id === e.target.value);
                if (!site) return;
                setLocation(site.label);
                setPin(site.lat != null && site.lng != null ? { lat: site.lat, lng: site.lng } : null);
              }}
              className={inputClass}
            >
              <option value="">
                {sites.length > 0 ? "Choose one of the company's sites…" : company ? "This company has no saved sites" : "Choose a company first"}
              </option>
              {sites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input id="location" placeholder="e.g. Lahore" value={location} onChange={(e) => setLocation(e.target.value)} aria-invalid={!!errors.location} className={`${inputClass} flex-1`} />
              {pin && (
                <button
                  type="button"
                  aria-label="Remove pin"
                  onClick={() => {
                    setPin(null);
                    setLocation("");
                  }}
                  className="rounded-md border px-3"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Button variant="outline" busy={locating} onClick={() => void useMyLocation()} className="w-full">
              <LocateFixed className="size-4" /> {pin ? "Update pin to my location" : "Use my location"}
            </Button>
            {pin && (
              <p className="text-muted-foreground text-xs tabular-nums">
                Pinned at {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}
              </p>
            )}
          </div>
        </Field>

        <Field label="Device type" htmlFor="deviceType" error={errors.deviceType}>
          <select id="deviceType" value={deviceType} onChange={(e) => setDeviceType(e.target.value)} aria-invalid={!!errors.deviceType} className={inputClass}>
            <option value="">Choose the device type…</option>
            {DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="SIM No." htmlFor="simNo" error={errors.simNo} hint="10 to 15 digits.">
          <input id="simNo" type="tel" inputMode="tel" placeholder="0300 1234567" value={simNo} onChange={(e) => setSimNo(e.target.value)} autoComplete="off" aria-invalid={!!errors.simNo} className={inputClass} />
        </Field>
      </section>

      <section className="bg-card rounded-xl border">
        <div className="flex items-center justify-between gap-2 p-4">
          <button type="button" onClick={() => setShowChecklist((v) => !v)} aria-expanded={showChecklist} className="flex items-center gap-2 text-left">
            <ChevronDown className={`size-4 transition-transform ${showChecklist ? "" : "-rotate-90"}`} />
            <span className="font-semibold">
              Service checklist{" "}
              <span className="text-muted-foreground text-sm font-normal">
                ({checked.length}/{CHECKLIST.length})
              </span>
            </span>
          </button>
          {showChecklist && (
            <Button variant="outline" onClick={() => setChecked(allChecked ? [] : [...CHECKLIST])} className="px-3 py-1.5">
              {allChecked ? "Clear all" : "Select all"}
            </Button>
          )}
        </div>
        {showChecklist && (
          <div className="grid grid-cols-1 gap-3 border-t p-4">
            {CHECKLIST.map((item, n) => (
              <label key={item} htmlFor={`check-${n}`} className="flex items-center gap-3 text-sm">
                <input
                  id={`check-${n}`}
                  type="checkbox"
                  checked={checked.includes(item)}
                  onChange={(e) => setChecked((list) => (e.target.checked ? [...list, item] : list.filter((x) => x !== item)))}
                  className="size-5"
                />
                {item}
              </label>
            ))}
          </div>
        )}
      </section>

      <PhotoGrid
        title="Installation photos"
        slots={INSTALLATION_SLOTS}
        items={items}
        video={{ label: "Device", maxSeconds: INSTALLATION_VIDEO_SECONDS }}
        other={{ max: OTHER_PHOTO_LIMIT }}
        hint={held ? "Photos of a held record are saved as soon as you take them." : "Tap a box to take a photo. Retake replaces it."}
        onPhoto={addPhoto}
        onVideo={addVideo}
        onRemove={removePhoto}
      />

      <Field label="Notes" htmlFor="notes" error={errors.notes}>
        <textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </Field>

      <div className="flex flex-col gap-2 pb-2">
        <Button type="submit" busy={busy && !holdOpen}>
          Add Record
        </Button>
        <Button variant="outline" onClick={() => setHoldOpen(true)} disabled={busy}>
          <PauseCircle className="size-4" /> Put on hold
        </Button>
        <Button variant="ghost" onClick={() => setClearOpen(true)} disabled={busy} className="text-muted-foreground">
          <Eraser className="size-4" /> Clear all
        </Button>
      </div>

      {/* Put on hold: a reason is required */}
      <Modal
        open={holdOpen}
        title="Put on hold"
        description="Tell us why. You can finish this installation later from My jobs, under On hold."
        onClose={() => !busy && setHoldOpen(false)}
        footer={
          <>
            <Button onClick={() => void putOnHold()} busy={busy}>
              Put on hold
            </Button>
            <Button variant="outline" onClick={() => setHoldOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="hold-reason" error={reasonError}>
          <textarea
            id="hold-reason"
            rows={3}
            maxLength={300}
            placeholder="e.g. Waiting for the customer"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (reasonError) setReasonError("");
            }}
            className={inputClass}
          />
        </Field>
      </Modal>

      {/* Leaving with unsaved information */}
      <Modal
        open={leaveOpen}
        title="Leave this installation?"
        description="You have information that is not saved. Put it on hold to finish later, or leave and lose it."
        onClose={() => blocker.state === "blocked" && blocker.reset()}
        footer={
          <>
            <Button onClick={() => setHoldOpen(true)}>Put on hold</Button>
            <Button variant="outline" onClick={() => blocker.state === "blocked" && blocker.reset()}>
              Keep editing
            </Button>
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                allowLeave.current = true;
                if (blocker.state === "blocked") blocker.proceed();
              }}
            >
              Leave without saving
            </Button>
          </>
        }
      />

      {/* Clear all */}
      <Modal
        open={clearOpen}
        title={held ? "Delete this held installation?" : "Clear the form?"}
        description={
          held
            ? "Clear all will delete this held installation and its photos. This cannot be undone."
            : "Everything you entered, including the photos, will be removed."
        }
        onClose={() => setClearOpen(false)}
        footer={
          <>
            <Button variant="danger" onClick={() => void clearAll()}>
              {held ? "Delete it" : "Clear all"}
            </Button>
            <Button variant="outline" onClick={() => setClearOpen(false)}>
              Cancel
            </Button>
          </>
        }
      />
    </form>
  );
}

/** A held record's saved files as grid items. */
function remoteItems(d?: InstallationDetail): PhotoItem[] {
  if (!d) return [];
  return [...d.files, ...d.photos].map((f) => ({
    key: f.id,
    remoteId: f.id,
    slot: f.slot,
    kind: f.kind === "VIDEO" ? "VIDEO" : "PHOTO",
    name: f.fileName,
  }));
}
