"use client";

import { LocateFixed, MapPin, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Field, NativeSelect } from "@/components/forms/field";
import { PickerMap, type LatLng } from "@/components/maps";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Where the map opens until a pin is dropped (Lahore, like the placeholder). */
const FALLBACK_CENTER: LatLng = { lat: 31.5204, lng: 74.3587 };

const coordsText = (p: LatLng) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

/**
 * The Location field: type a place name, or pick the spot on a map. Picking fills the field with the
 * coordinates of the pin (the text stays editable, so a name like "Lahore" can still be typed over it).
 */
export type SavedSite = { id: string; label: string; lat: number | null; lng: number | null };

export function LocationField({
  value,
  onChange,
  pin,
  onPin,
  sites,
  sitesEmpty = "No saved sites",
  error,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The pinned point (controlled by the form, so it can be saved and reloaded). */
  pin: LatLng | null;
  /** Called with the pinned point, or null when the pin is removed. */
  onPin: (pin: LatLng | null) => void;
  /** Saved sites of the chosen company; picking one fills the location (and the pin, when it has coordinates). */
  sites?: SavedSite[];
  /** Text of the dropdown while it has nothing to offer (no company chosen, or the company has no saved sites). */
  sitesEmpty?: string;
  error?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<LatLng | null>(null);
  const [open, setOpen] = useState(false);

  const openPicker = () => {
    setDraft(pin);
    setOpen(true);
  };
  const usePin = () => {
    if (draft) {
      onPin(draft);
      onChange(coordsText(draft));
    }
    setOpen(false);
  };
  const locate = () => {
    if (!navigator.geolocation) return toast.error("This browser cannot share its location.");
    navigator.geolocation.getCurrentPosition(
      (p) => setDraft({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => toast.error("Location permission was denied or unavailable."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <Field label="Location" htmlFor="location" error={error} className={className}>
      {sites && (
        <NativeSelect
          aria-label="Saved company sites"
          value=""
          disabled={sites.length === 0}
          onChange={(e) => {
            const site = sites.find((x) => x.id === e.target.value);
            if (!site) return;
            onChange(site.label);
            onPin(site.lat != null && site.lng != null ? { lat: site.lat, lng: site.lng } : null);
          }}
        >
          <option value="">{sites.length > 0 ? "Choose one of the company's sites…" : sitesEmpty}</option>
          {sites.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </NativeSelect>
      )}
      <div className="flex gap-2">
        <Input
          id="location"
          placeholder="e.g. Lahore"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        <Button type="button" variant="outline" onClick={openPicker} aria-label="Pick location on map">
          <MapPin /> <span className="hidden sm:inline">{pin ? "Move pin" : "Map"}</span>
        </Button>
        {pin && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove pin"
            onClick={() => {
              onPin(null);
              onChange("");
            }}
          >
            <X />
          </Button>
        )}
      </div>
      {pin && <p className="text-muted-foreground text-xs tabular-nums">Pinned at {coordsText(pin)}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pick the location on the map</DialogTitle>
            <DialogDescription>Tap the map to drop the pin, then drag it to the exact spot.</DialogDescription>
          </DialogHeader>
          <div className="isolate h-[55vh] min-h-72">
            <PickerMap value={draft} onChange={setDraft} fallbackCenter={FALLBACK_CENTER} />
          </div>
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className="text-muted-foreground text-xs tabular-nums">{draft ? coordsText(draft) : "No pin yet"}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={locate}>
                <LocateFixed /> My location
              </Button>
              <Button type="button" onClick={usePin} disabled={!draft}>
                Use this pin
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Field>
  );
}
