import type { EvidenceDto } from "@/modules/work-orders/work-orders.schema";

/**
 * What the job endpoints return. These mirror `src/modules/field/field.schema.ts` on the server (that file
 * cannot be imported here because it pulls in the whole server); keep the two in step when the server changes.
 */
export type WorkOrderStatus = "NEW" | "SCHEDULED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CLOSED" | "CANCELLED" | string;
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT" | string;

export const FIELD_ACTIONS = ["on-my-way", "start", "hold", "resume", "complete"] as const;
export type FieldAction = (typeof FIELD_ACTIONS)[number];

export const FIELD_ACTION_LABEL: Record<FieldAction, string> = {
  "on-my-way": "On my way",
  start: "Start work",
  hold: "Put on hold",
  resume: "Resume work",
  complete: "Complete job",
};

export type LocationInput = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
};

export type TransitionInput = { action: FieldAction; reason?: string; location?: LocationInput | null };

export type FieldJob = {
  workOrderId: string;
  number: string;
  title: string;
  status: WorkOrderStatus;
  visitStatus: string;
  priority: Priority;
  customerName: string;
  customerPhone: string | null;
  siteLabel: string | null;
  assetName: string | null;
  /** "yyyy-MM-dd" in the company zone. */
  day: string;
  startTime: string;
  endTime: string;
};

export type FieldJobList = { today: string; timeZone: string; jobs: FieldJob[] };

export type FieldJobDetail = {
  id: string;
  number: string;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  priority: Priority;
  customer: { name: string; phone: string | null };
  address: { label: string | null; fullAddress: string; latitude: number | null; longitude: number | null } | null;
  assetName: string | null;
  visit: { day: string; startTime: string; endTime: string; status: string };
  actions: FieldAction[];
  checkedInAt: string | null;
  checklist: { id: string; text: string; isDone: boolean }[];
  notes: { id: string; text: string; author: string | null; createdAt: string; mine: boolean }[];
  /** A temperature sensor is installed: two more labeled photos are expected. */
  hasTempSensor: boolean;
  /** Before/after proof of the reported problem. */
  evidence: EvidenceDto;
  meId: string;
  closed: boolean;
};

/** A technician on the live map (mirrors `LiveTechnician` in the server's field.schema). */
export type LiveTechnician = {
  id: string;
  name: string;
  color: string;
  location: { latitude: number; longitude: number; recordedAt: string; accuracy: number | null } | null;
  job: { number: string; title: string; customerName: string; status: string } | null;
};
