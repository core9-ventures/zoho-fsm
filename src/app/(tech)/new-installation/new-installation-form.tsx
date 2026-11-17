"use client";

import { useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, Plus } from "lucide-react";
import { Field, NativeSelect } from "@/components/forms/field";
import { LocationField } from "@/components/forms/location-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createInstallationAction } from "@/modules/installations/installations.actions";
import {
  DEVICE_TYPES,
  INSTALLATION_CHECKLIST as CHECKLIST,
  type CustomerChoice,
} from "@/modules/installations/installations.schema";
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

export function NewInstallationForm({ customers }: { customers: CustomerChoice[] }) {
  const [vehicleNo, setVehicleNo] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [company, setCompany] = useState("");
  const [date, setDate] = useState(today());
  const [location, setLocation] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [deviceType, setDeviceType] = useState("");
  const [simNo, setSimNo] = useState("");
  const [checked, setChecked] = useState<string[]>([...CHECKLIST]);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [photosKey, setPhotosKey] = useState(0);
  const [busy, setBusy] = useState(false);
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
    setPhotosKey((k) => k + 1);
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
        res = await createInstallationAction({
          customerId: company,
          vehicleNo,
          deviceId,
          simNo,
          installDate: date,
          location,
          latitude: pin ? pin.lat.toFixed(6) : "",
          longitude: pin ? pin.lng.toFixed(6) : "",
          deviceType: deviceType as (typeof DEVICE_TYPES)[number],
          hasTempSensor: files.current.temp,
          checklist: checked as (typeof CHECKLIST)[number][],
          notes,
        });
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

      <InstallationPhotos
        key={photosKey}
        onChange={(list, temp) => {
          files.current = { list, temp };
        }}
      />

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
    </form>
  );
}
