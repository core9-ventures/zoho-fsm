"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Eraser, Loader2, PauseCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Field, NativeSelect } from "@/components/forms/field";
import { LocationField } from "@/components/forms/location-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  completeInstallationAction,
  createInstallationAction,
  discardHeldInstallationAction,
  holdInstallationAction,
} from "@/modules/installations/installations.actions";
import {
  DEVICE_TYPES,
  INSTALLATION_CHECKLIST as CHECKLIST,
  type CustomerChoice,
  type InstallationDetail,
} from "@/modules/installations/installations.schema";
import { HeldPhotos } from "./held-photos";
import { InstallationPhotos, type PendingFile } from "./installation-photos";

const today = () => new Date().toISOString().slice(0, 10);

type FieldKey = "vehicleNo" | "deviceId" | "company" | "date" | "location" | "deviceType" | "simNo";
type Errors = Partial<Record<FieldKey, string>>;

/** Maps the server's field names to the form's. */
const SERVER_FIELD: Record<string, FieldKey> = {
  vehicleNo: "vehicleNo",
  deviceId: "deviceId",
  customerId: "company",
  installDate: "date",
  location: "location",
  deviceType: "deviceType",
  simNo: "simNo",
};

/**
 * The new installation form. With `held` it carries on with a record that was put on hold: the fields are
 * filled in, its photos are already saved, and Add Record completes that same record.
 */
export function NewInstallationForm({ customers, held }: { customers: CustomerChoice[]; held?: InstallationDetail }) {
  const router = useRouter();
  const [vehicleNo, setVehicleNo] = useState(held?.vehicleNo ?? "");
  const [deviceId, setDeviceId] = useState(held?.deviceId ?? "");
  const [company, setCompany] = useState(held?.customerId ?? "");
  const [date, setDate] = useState(held?.installDate ?? today());
  const [location, setLocation] = useState(held?.location ?? "");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    held?.latitude != null && held?.longitude != null ? { lat: held.latitude, lng: held.longitude } : null,
  );
  const [deviceType, setDeviceType] = useState(held?.deviceType ?? "");
  const [simNo, setSimNo] = useState(held?.simNo ?? "");
  const [checked, setChecked] = useState<string[]>(held ? held.checklist : [...CHECKLIST]);
  const [notes, setNotes] = useState(held?.notes ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [photosKey, setPhotosKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState(held?.holdReason ?? "");
  const [reasonError, setReasonError] = useState("");
  const files = useRef<{ list: PendingFile[]; temp: boolean }>({ list: [], temp: false });

  const toggle = (item: string, on: boolean) =>
    setChecked((list) => (on ? [...list, item] : list.filter((x) => x !== item)));

  const [showChecklist, setShowChecklist] = useState(false);
  const allChecked = checked.length === CHECKLIST.length;

  function reset() {
    setVehicleNo("");
    setDeviceId("");
    setCompany("");
    setDate(today());
    setLocation("");
    setPin(null);
    setDeviceType("");
    setSimNo("");
    setChecked([...CHECKLIST]);
    setNotes("");
    setReason("");
    setPhotosKey((k) => k + 1);
  }

  /** Empties every field (and the photos of a new form). The photos of a held record stay saved. */
  async function clearAll() {
    if (held) {
      // On a held record this deletes the record itself (and its photos with it).
      if (!window.confirm("Clear all will delete this held installation and its photos. This cannot be undone. Continue?"))
        return;
      setBusy(true);
      try {
        const res = await discardHeldInstallationAction(held.id).catch(() => null);
        if (!res || !res.ok) {
          setFormError(res ? res.error : "Could not reach the server. Check your connection and try again.");
          return;
        }
        toast.success("Held installation deleted.");
        allowLeave.current = true;
        router.push("/my-jobs");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!window.confirm("Clear everything you filled in on this form?")) return;
    reset();
    setErrors({});
    setFormError(null);
    setAdded(null);
    setWarning(null);
  }

  const values = () => ({
    vehicleNo,
    deviceId,
    simNo,
    installDate: date,
    location,
    latitude: pin ? pin.lat.toFixed(6) : "",
    longitude: pin ? pin.lng.toFixed(6) : "",
    hasTempSensor: files.current.temp,
    checklist: checked as (typeof CHECKLIST)[number][],
    notes,
  });

  // ---- Leaving the page with unsaved information: ask to hold it (or discard) first. ----
  const snapshot = JSON.stringify([vehicleNo, deviceId, company, date, location, pin, deviceType, simNo, checked, notes]);
  const initialSnapshot = useRef<string | null>(null);
  if (initialSnapshot.current === null) initialSnapshot.current = snapshot;
  const dirty = snapshot !== initialSnapshot.current || photoCount > 0;
  /** Where the technician was heading: a link, or "back" for the browser/phone back button. */
  const pending = useRef<string | null>(null);
  const allowLeave = useRef(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      if (allowLeave.current) return;
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (allowLeave.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      pending.current = url.pathname + url.search + url.hash;
      setLeaveOpen(true);
    };
    // One extra history entry lets the back button be caught without leaving the page.
    window.history.pushState(null, "", window.location.href);
    const onPop = () => {
      if (allowLeave.current) return;
      window.history.pushState(null, "", window.location.href);
      pending.current = "back";
      setLeaveOpen(true);
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  /** Goes where the technician was heading (or to My jobs). */
  function goOn() {
    allowLeave.current = true;
    const to = pending.current;
    pending.current = null;
    if (to === "back") window.history.go(-2);
    else router.push(to ?? "/my-jobs");
  }

  /** Saves the form as it is (nothing required) so the technician can come back to it from My jobs. */
  async function hold() {
    if (busy) return;
    const holdReason = reason.trim();
    if (!holdReason) {
      setReasonError("Please give a reason.");
      return;
    }
    setReasonError("");
    setBusy(true);
    setErrors({});
    setFormError(null);
    setWarning(null);
    try {
      let res: Awaited<ReturnType<typeof holdInstallationAction>>;
      try {
        res = await holdInstallationAction(held?.id ?? null, {
          ...values(),
          holdReason,
          customerId: company,
          deviceType: deviceType as (typeof DEVICE_TYPES)[number] | "",
        });
      } catch {
        setFormError("Could not reach the server. Check your connection and try again.");
        return;
      }
      if (!res.ok) {
        const server: Errors = {};
        for (const [k, msgs] of Object.entries(res.fieldErrors ?? {})) {
          const f = SERVER_FIELD[k];
          if (f && msgs[0]) server[f] = msgs[0];
        }
        setErrors(server);
        setFormError(res.error);
        return;
      }
      if (held) {
        toast.success("Put on hold.");
        goOn();
        return;
      }
      let failed = 0;
      for (const f of files.current.list) if (!(await upload(res.data.id, f))) failed++;
      if (failed > 0) toast.error(`${failed} file${failed === 1 ? "" : "s"} could not be uploaded to the held record.`);
      toast.success("Put on hold. Find it under On hold on My jobs.");
      reset();
      goOn();
    } finally {
      setBusy(false);
      setHoldOpen(false);
    }
  }

  async function upload(id: string, f: PendingFile) {
    const body = new FormData();
    body.set("file", f.file);
    if (f.slot) body.set("slot", f.slot);
    const res = await fetch(`/api/v1/field/installations/${id}/files`, { method: "POST", body }).catch(() => null);
    return !!res?.ok;
  }

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
    const simDigits = simNo.replace(/\D/g, "").length;
    if (simNo.trim() && (simDigits < 10 || simDigits > 15)) next.simNo = "A SIM number has 10 to 15 digits.";
    setErrors(next);
    setFormError(null);
    setWarning(null);
    if (Object.keys(next).length > 0) {
      setAdded(null);
      return;
    }
    setBusy(true);
    try {
      let res: Awaited<ReturnType<typeof createInstallationAction>>;
      try {
        const input = { ...values(), customerId: company, deviceType: deviceType as (typeof DEVICE_TYPES)[number] };
        res = held ? await completeInstallationAction(held.id, input) : await createInstallationAction(input);
      } catch {
        // The server restarted or the sign-in ended while saving; nothing was lost on the form.
        setFormError(
          "Could not reach the server. Check your connection, reload the page if it keeps happening, and try again.",
        );
        setAdded(null);
        return;
      }
      if (!res.ok) {
        const server: Errors = {};
        for (const [k, msgs] of Object.entries(res.fieldErrors ?? {})) {
          const f = SERVER_FIELD[k];
          if (f && msgs[0]) server[f] = msgs[0];
        }
        setErrors(server);
        setFormError(res.error);
        setAdded(null);
        return;
      }
      if (held) {
        toast.success(`Record for ${vehicleNo.trim().toUpperCase()} saved.`);
        router.push("/my-jobs");
        return;
      }
      let failed = 0;
      for (const f of files.current.list) if (!(await upload(res.data.id, f))) failed++;
      if (failed > 0)
        setWarning(`${failed} file${failed === 1 ? "" : "s"} could not be uploaded. The record itself is saved.`);
      setAdded(vehicleNo.trim().toUpperCase());
      reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {added && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <p>
            Record for <span className="font-medium">{added}</span> saved.
            {warning && <span className="text-destructive block">{warning}</span>}
          </p>
        </div>
      )}
      {formError && (
        <div role="alert" className="border-destructive/40 bg-destructive/10 rounded-md border p-3 text-sm">
          {formError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" /> Add new record
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Vehicle No." htmlFor="vehicleNo" error={errors.vehicleNo}>
            <Input
              id="vehicleNo"
              placeholder="e.g. JV-7219"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              autoCapitalize="characters"
            />
          </Field>
          <Field label="Device ID" htmlFor="deviceId" error={errors.deviceId}>
            <Input
              id="deviceId"
              placeholder="e.g. DEV12345"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            />
          </Field>
          <Field label="Company Name" htmlFor="company" error={errors.company}>
            <NativeSelect id="company" value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">Select company</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Date" htmlFor="date" error={errors.date}>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <LocationField
            key={photosKey}
            value={location}
            onChange={setLocation}
            pin={pin}
            onPin={setPin}
            sites={customers.find((c) => c.id === company)?.sites ?? []}
            sitesEmpty={company ? "This company has no saved sites" : "Choose a company first"}
            error={errors.location}
            className="sm:col-span-2"
          />
          <Field label="Device type" htmlFor="deviceType" error={errors.deviceType}>
            <NativeSelect id="deviceType" value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
              <option value="">Select device type</option>
              {DEVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="SIM No." htmlFor="simNo" error={errors.simNo}>
            <Input
              id="simNo"
              type="tel"
              inputMode="tel"
              placeholder="800-123-4567"
              value={simNo}
              onChange={(e) => setSimNo(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowChecklist((v) => !v)}
            aria-expanded={showChecklist}
            className="flex items-center gap-2 text-left"
          >
            <ChevronDown className={`size-4 transition-transform ${showChecklist ? "" : "-rotate-90"}`} />
            <CardTitle className="text-base">
              Service checklist{" "}
              <span className="text-muted-foreground text-sm font-normal">
                ({checked.length}/{CHECKLIST.length})
              </span>
            </CardTitle>
          </button>
          {showChecklist && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setChecked(allChecked ? [] : [...CHECKLIST])}
            >
              {allChecked ? "Clear all" : "Select all"}
            </Button>
          )}
        </CardHeader>
        {showChecklist && (
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {CHECKLIST.map((item, i) => (
                <label key={item} htmlFor={`check-${i}`} className="flex cursor-pointer items-start gap-2 text-sm">
                  <Checkbox
                    id={`check-${i}`}
                    checked={checked.includes(item)}
                    onCheckedChange={(v) => toggle(item, v === true)}
                    className="mt-0.5"
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {held ? (
        <HeldPhotos id={held.id} files={held.files} photos={held.photos} />
      ) : (
        <InstallationPhotos
          key={photosKey}
          onChange={(list, temp) => {
            files.current = { list, temp };
            setPhotoCount(list.length);
          }}
        />
      )}

      <Field label="Notes" htmlFor="notes">
        <Textarea
          id="notes"
          rows={4}
          placeholder="Write note here"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        {busy ? "Saving…" : "Add Record"}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={() => {
            pending.current = null;
            setHoldOpen(true);
          }}
          disabled={busy}
        >
          <PauseCircle /> Hold
        </Button>
        <Button type="button" variant="outline" onClick={clearAll} disabled={busy}>
          <Eraser /> Clear all
        </Button>
      </div>
      <p className="text-muted-foreground text-center text-xs">
        Hold saves what you filled in so far. Find it under On hold on My jobs and carry on later.
      </p>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave this installation?</DialogTitle>
            <DialogDescription>
              You have information that is not saved. Finish it and press Add Record, put it on hold to carry on
              later, or leave and lose it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                pending.current = null;
                setLeaveOpen(false);
              }}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-destructive"
              onClick={() => {
                setLeaveOpen(false);
                goOn();
              }}
            >
              Leave without saving
            </Button>
            <Button
              type="button"
              onClick={() => {
                setLeaveOpen(false);
                setHoldOpen(true);
              }}
            >
              Put on hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={holdOpen} onOpenChange={(o) => !busy && setHoldOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Put this installation on hold</DialogTitle>
            <DialogDescription>
              Tell the office why, for example waiting for the customer or the device is not available.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="hold-reason" error={reasonError}>
            <Textarea id="hold-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setHoldOpen(false)}>
              Back
            </Button>
            <Button type="button" disabled={busy} onClick={hold}>
              {busy && <Loader2 className="animate-spin" />} Put on hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
