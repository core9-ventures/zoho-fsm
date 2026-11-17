import { z } from "zod";
import { pagedQuerySchema } from "@/lib/pagination";
import { idParam, latitudeText, longitudeText, optionalText, requiredText } from "@/lib/validation";
import type { MediaDto } from "@/modules/work-orders/work-orders.schema";

/** The device kinds an installer can pick (kept as text in the database, so the list can grow without a migration). */
export const DEVICE_TYPES = ["DMS camera", "GPS tracker", "Dashcam", "Temperature sensor kit"] as const;

/** The service checklist of a new installation; every item is ticked by default on the form. */
export const INSTALLATION_CHECKLIST = [
  "Verify Camera Angles",
  "Memory Card",
  "Sim",
  "Network Connection",
  "GPS Connection",
  "Wire Piping",
  "DSM Wire Check",
  "Power Wire Check",
  "Configuration",
  "Change Sim",
  "Check Back Camera",
  "Temperature Sensor",
  "Probe",
  "Seal All Connections",
] as const;

/** The labeled photos of an installation: one photo per label, taking it again replaces it. */
export const INSTALLATION_SLOTS = [
  { key: "FRONT", label: "Front" },
  { key: "CABIN_1", label: "Cabin (1)" },
  { key: "METER_1", label: "Meter (1)" },
  { key: "CONNECTION", label: "Connection" },
  { key: "VEHICLE_MAIN", label: "I Vehicle Main" },
  { key: "VEHICLE_ADAS", label: "I Vehicle ADAS" },
  { key: "VEHICLE_DSM", label: "I Vehicle DSM" },
  { key: "CABIN_2", label: "Cabin (2)" },
  { key: "METER_2", label: "Meter (2)" },
] as const;

/** Two more labels when a temperature sensor is installed. */
export const INSTALLATION_TEMP_SLOTS = [
  { key: "TEMP_PROBE", label: "Temp Probe Photo" },
  { key: "TEMP_SENSOR", label: "Temp Sensor Photo" },
] as const;

/** The labels to show: the standard ones, plus the temperature pair when a sensor is installed. */
export const installationSlots = (hasTempSensor: boolean) => [
  ...INSTALLATION_SLOTS,
  ...(hasTempSensor ? INSTALLATION_TEMP_SLOTS : []),
];

export const isInstallationSlot = (key: string) =>
  [...INSTALLATION_SLOTS, ...INSTALLATION_TEMP_SLOTS].some((s) => s.key === key);

/** The one optional video of an installation is at most this long. */
export const INSTALLATION_VIDEO_SECONDS = 10;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Enter a real date.");

export const createInstallationSchema = z
  .object({
    customerId: idParam,
    vehicleNo: requiredText(30, "Vehicle number"),
    deviceId: requiredText(60, "Device ID"),
    /** Phone number of the SIM; optional. */
    simNo: optionalText(30).regex(/^[0-9+\-\s()]*$/, "Use digits, spaces, + and - only."),
    installDate: day,
    location: requiredText(200, "Location"),
    latitude: latitudeText,
    longitude: longitudeText,
    deviceType: z.enum(DEVICE_TYPES, { errorMap: () => ({ message: "Choose the device type." }) }),
    hasTempSensor: z.boolean(),
    checklist: z.array(z.enum(INSTALLATION_CHECKLIST)).max(INSTALLATION_CHECKLIST.length),
    notes: optionalText(2000),
  })
  .refine((v) => (v.latitude === "") === (v.longitude === ""), {
    message: "Give both latitude and longitude, or neither.",
    path: ["latitude"],
  });
export type InstallationInput = z.infer<typeof createInstallationSchema>;

export const installationListQuerySchema = pagedQuerySchema.pick({ page: true, pageSize: true, search: true }).extend({
  customerId: idParam.optional(),
  from: day.optional(),
  to: day.optional(),
});
export type InstallationListQuery = z.infer<typeof installationListQuerySchema>;

export type InstallationListItem = {
  id: string;
  vehicleNo: string;
  deviceId: string;
  customerName: string;
  deviceType: string;
  location: string;
  installDate: string;
  createdBy: string | null;
  createdAt: string;
  /** Photos and videos attached so far. */
  fileCount: number;
  /** Ids of the first few photos, shown as small previews in the list. */
  thumbs: string[];
};

export type InstallationDetail = Omit<InstallationListItem, "fileCount" | "thumbs"> & {
  customerId: string;
  simNo: string | null;
  latitude: number | null;
  longitude: number | null;
  hasTempSensor: boolean;
  checklist: string[];
  notes: string | null;
  /** Labeled photos and the video. */
  files: MediaDto[];
  /** Other photos (no label). */
  photos: MediaDto[];
};

/** A saved site (service address) of a company; the location of an installation can be picked from these. */
export type SiteChoice = { id: string; label: string; lat: number | null; lng: number | null };
export type CustomerChoice = { id: string; name: string; sites: SiteChoice[] };
