"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { SlotListCard, type EvidenceApi } from "@/components/domain/evidence-section";
import { Field, NativeSelect } from "@/components/forms/field";
import { LocationField } from "@/components/forms/location-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteInstallationFileAction, updateInstallationAction } from "@/modules/installations/installations.actions";
import {
  DEVICE_TYPES,
  INSTALLATION_CHECKLIST as CHECKLIST,
  INSTALLATION_VIDEO_SECONDS,
  INSTALLATION_SLOTS,
  type CustomerChoice,
  type InstallationDetail,
} from "@/modules/installations/installations.schema";

type Errors = Record<string, string>;

/** Every detail of an installation, editable, with the photo area (add, replace, remove). */
export function InstallationEditor({
  installation: i,
  customers,
}: {
  installation: InstallationDetail;
  customers: CustomerChoice[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customerId, setCustomerId] = useState(i.customerId ?? "");
  const [vehicleNo, setVehicleNo] = useState(i.vehicleNo);
  const [deviceId, setDeviceId] = useState(i.deviceId);
  const [simNo, setSimNo] = useState(i.simNo ?? "");
  const [installDate, setInstallDate] = useState(i.installDate);
  const [location, setLocation] = useState(i.location);
  const [latitude, setLatitude] = useState(i.latitude == null ? "" : String(i.latitude));
  const [longitude, setLongitude] = useState(i.longitude == null ? "" : String(i.longitude));
  const [deviceType, setDeviceType] = useState(i.deviceType);
  const [checked, setChecked] = useState<string[]>(i.checklist);
  const [notes, setNotes] = useState(i.notes ?? "");
  const [errors, setErrors] = useState<Errors>({});

  const [showChecklist, setShowChecklist] = useState(false);
  const pin =
    latitude.trim() !== "" &&
    longitude.trim() !== "" &&
    !Number.isNaN(Number(latitude)) &&
    !Number.isNaN(Number(longitude))
      ? { lat: Number(latitude), lng: Number(longitude) }
      : null;
  const allChecked = checked.length === CHECKLIST.length;

  const api: EvidenceApi = useMemo(
    () => ({
      uploadUrl: `/api/v1/installations/${i.id}/files`,
      deleteFile: (attachmentId) => deleteInstallationFileAction(i.id, attachmentId),
      setTempSensor: async () => ({ ok: true, data: undefined }),
      addIssue: async () => ({ ok: false, error: "Issues are not part of an installation." }),
      updateIssue: async () => ({ ok: false, error: "Issues are not part of an installation." }),
      deleteIssue: async () => ({ ok: false, error: "Issues are not part of an installation." }),
    }),
    [i.id],
  );

  function save(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateInstallationAction(i.id, {
        customerId,
        vehicleNo,
        deviceId,
        simNo,
        installDate,
        location,
        latitude,
        longitude,
        deviceType: deviceType as (typeof DEVICE_TYPES)[number],
        hasTempSensor: i.hasTempSensor,
        checklist: checked as (typeof CHECKLIST)[number][],
        notes,
      });
      if (!res.ok) {
        const next: Errors = {};
        for (const [k, msgs] of Object.entries(res.fieldErrors ?? {})) if (msgs[0]) next[k] = msgs[0];
        setErrors(next);
        toast.error(res.error);
        return;
      }
      setErrors({});
      toast.success("Installation saved.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} noValidate className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Vehicle No." htmlFor="vehicleNo" error={errors.vehicleNo}>
            <Input id="vehicleNo" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
          </Field>
          <Field label="Device ID" htmlFor="deviceId" error={errors.deviceId}>
            <Input id="deviceId" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />
          </Field>
          <Field label="Company Name" htmlFor="company" error={errors.customerId}>
            <NativeSelect id="company" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Date" htmlFor="date" error={errors.installDate}>
            <Input id="date" type="date" value={installDate} onChange={(e) => setInstallDate(e.target.value)} />
          </Field>
          <LocationField
            value={location}
            onChange={setLocation}
            pin={pin}
            onPin={(p) => {
              setLatitude(p ? p.lat.toFixed(6) : "");
              setLongitude(p ? p.lng.toFixed(6) : "");
            }}
            sites={customers.find((c) => c.id === customerId)?.sites ?? []}
            sitesEmpty="This company has no saved sites"
            error={errors.location}
            className="sm:col-span-2"
          />
          <Field label="Latitude" htmlFor="lat" error={errors.latitude}>
            <Input id="lat" inputMode="decimal" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
          </Field>
          <Field label="Longitude" htmlFor="lng" error={errors.longitude}>
            <Input id="lng" inputMode="decimal" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
          </Field>
          <Field label="Device type" htmlFor="deviceType" error={errors.deviceType}>
            <NativeSelect id="deviceType" value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
              {DEVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="SIM No." htmlFor="simNo" error={errors.simNo}>
            <Input id="simNo" value={simNo} onChange={(e) => setSimNo(e.target.value)} />
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
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {CHECKLIST.map((item, n) => (
              <label key={item} htmlFor={`check-${n}`} className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  id={`check-${n}`}
                  checked={checked.includes(item)}
                  onCheckedChange={(v) =>
                    setChecked((list) => (v === true ? [...list, item] : list.filter((x) => x !== item)))
                  }
                  className="mt-0.5"
                />
                <span>{item}</span>
              </label>
            ))}
          </CardContent>
        )}
      </Card>

      <SlotListCard
        files={i.files}
        slots={INSTALLATION_SLOTS}
        video={{ label: "Device", maxSeconds: INSTALLATION_VIDEO_SECONDS }}
        api={api}
        closed={false}
        meId=""
        canDeleteAny
        otherPhotos={i.photos.map((p) => ({ id: p.id, fileName: p.fileName, authorId: p.authorId }))}
        title="Installation photos"
      />

      <Field label="Notes" htmlFor="notes" error={errors.notes}>
        <Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
