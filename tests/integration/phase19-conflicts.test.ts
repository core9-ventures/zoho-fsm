/**
 * Offline Phase 5: what the server says to a change that was queued on a phone while the office changed the job or the
 * record. Every refusal carries a code the phone turns into a plain explanation, and edits to different fields of the
 * same installation are merged instead of overwritten.
 * Runs against the seeded dev database (Demo company) and removes what it creates.
 */
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as transitionRoute } from "@/app/api/v1/field/jobs/[id]/transition/route";
import type { CurrentUser } from "@/lib/auth";
import { createDb, prismaBase, tenantContext, type AppDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { authService } from "@/modules/auth";
import { fieldService } from "@/modules/field";
import {
  createInstallationSchema,
  holdInstallationSchema,
  installationsService,
  INSTALLATION_CHECKLIST,
  mergeWithServer,
} from "@/modules/installations";
import { schedulingService } from "@/modules/scheduling";
import { workOrdersService } from "@/modules/work-orders";

const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const stamp = Date.now().toString(36).toUpperCase();
const password = process.env.SEED_PASSWORD ?? "";

let dispatcher: CurrentUser;
let techA: CurrentUser;
let techB: CurrentUser;
let db: AppDb;
let dbA: AppDb;
let customerId: string;
const woIds: string[] = [];
const installIds: string[] = [];

const asUser = (u: { id: string; role: string; companyId: string | null; fullName: string; email: string }) =>
  ({ id: u.id, role: u.role, companyId: u.companyId, fullName: u.fullName, email: u.email, via: "session" }) as CurrentUser;

const day = new Date(Date.now() + 2 * 24 * 3600_000).toISOString().slice(0, 10);

let slot = 0;
async function makeJob(title: string) {
  const hour = String(6 + ++slot).padStart(2, "0");
  const wo = await workOrdersService.create(db, dispatcher, {
    customerId,
    addressId: "",
    assetId: "",
    title: `${title} ${stamp}`,
    description: "",
    priority: "MEDIUM",
    dueDate: "",
    checklistTemplateId: "",
  });
  woIds.push(wo.id);
  await schedulingService.schedule(db, dispatcher, wo.id, { technicianId: techA.id, start: `${day}T${hour}:00`, durationMin: 30 });
  return wo.id;
}

/** The error a call ends with (its machine-readable code and status). */
async function failure(work: Promise<unknown>) {
  try {
    await work;
  } catch (e) {
    if (e instanceof AppError) return { code: e.code, status: e.status, message: e.message };
    throw e;
  }
  throw new Error("The call was expected to fail.");
}

let seq = 0;
const form = (over: Record<string, unknown> = {}) => ({
  customerId,
  vehicleNo: `cf-${stamp}`,
  deviceId: `CF-${stamp}-${++seq}`,
  simNo: `03${stamp.replace(/\D/g, "").slice(-6).padStart(6, "0")}${String(seq).padStart(3, "0")}`,
  installDate: "2026-11-04",
  location: "Lahore",
  latitude: "",
  longitude: "",
  deviceType: "DMS camera",
  hasTempSensor: false,
  checklist: [...INSTALLATION_CHECKLIST],
  notes: "",
  ...over,
});

async function heldRecord(over: Record<string, unknown> = {}) {
  const input = holdInstallationSchema.parse({ ...form(over), holdReason: "No power at site", fill: null });
  const { id } = await installationsService.hold(dbA, techA, input);
  installIds.push(id);
  return { id, input };
}

beforeAll(async () => {
  const d = await owner.user.findFirstOrThrow({ where: { email: "dispatcher@demo.local" } });
  const a = await owner.user.findFirstOrThrow({ where: { email: "tech1@demo.local" } });
  const b = await owner.user.findFirstOrThrow({ where: { email: "tech2@demo.local" } });
  dispatcher = asUser(d);
  techA = asUser(a);
  techB = asUser(b);
  db = createDb(tenantContext(d.companyId!, d.id));
  dbA = createDb(tenantContext(d.companyId!, a.id));
  customerId = (await owner.customer.findFirstOrThrow({ where: { companyId: d.companyId!, deletedAt: null } })).id;
});

afterAll(async () => {
  const where = { workOrderId: { in: woIds } };
  await owner.auditLog.deleteMany({ where: { entityId: { in: [...woIds, ...installIds] } } });
  await owner.timeSheet.deleteMany({ where: { appointment: where } });
  await owner.appointment.deleteMany({ where });
  await owner.workOrderStatusChange.deleteMany({ where });
  await owner.workOrderChecklistItem.deleteMany({ where });
  await owner.workOrderNote.deleteMany({ where });
  await owner.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await owner.installation.deleteMany({ where: { id: { in: installIds } } });
  await owner.$disconnect();
  await prismaBase.$disconnect();
});

describe("Offline Phase 5 — jobs changed by the office", () => {
  it("a job the office cancelled: JOB_CANCELLED", async () => {
    const id = await makeJob("Cancelled");
    await workOrdersService.changeStatus(db, dispatcher, id, { status: "CANCELLED", reason: "Customer called" });
    const e = await failure(fieldService.transition(dbA, techA, id, { action: "start" }));
    expect(e).toMatchObject({ code: "JOB_CANCELLED", status: 409 });
    expect(e.message).toMatch(/cancelled by the office/);
    // A note or a checklist tick queued for the same job is refused for the same reason.
    expect((await failure(fieldService.addNote(dbA, techA, id, "arrived"))).code).toBe("JOB_CANCELLED");
  });

  it("a job given to another technician: JOB_REASSIGNED", async () => {
    const id = await makeJob("Reassigned");
    await schedulingService.schedule(db, dispatcher, id, { technicianId: techB.id, start: `${day}T22:00`, durationMin: 30 });
    const e = await failure(fieldService.transition(dbA, techA, id, { action: "start" }));
    expect(e).toMatchObject({ code: "JOB_REASSIGNED", status: 409 });
    expect(e.message).toMatch(/another technician/);
  });

  it("a job that is already completed: JOB_ALREADY_COMPLETED", async () => {
    const id = await makeJob("Completed");
    await fieldService.transition(dbA, techA, id, { action: "start" });
    await fieldService.transition(dbA, techA, id, { action: "complete" });
    expect((await failure(fieldService.transition(dbA, techA, id, { action: "start" }))).code).toBe("JOB_ALREADY_COMPLETED");
  });

  it("a job whose status moved on: JOB_STATUS_CHANGED", async () => {
    const id = await makeJob("Moved");
    await fieldService.transition(dbA, techA, id, { action: "start" });
    // The technician's phone still thinks the job is scheduled and sends "on my way".
    const e = await failure(fieldService.transition(dbA, techA, id, { action: "on-my-way" }));
    expect(e).toMatchObject({ code: "JOB_STATUS_CHANGED", status: 409 });
  });

  it("a job the office deleted: JOB_DELETED", async () => {
    const id = await makeJob("Deleted");
    await owner.workOrder.update({ where: { id }, data: { deletedAt: new Date() } });
    const e = await failure(fieldService.addNote(dbA, techA, id, "hello"));
    expect(e).toMatchObject({ code: "JOB_DELETED", status: 404 });
  });

  it("the code reaches the phone in the response body", async () => {
    const id = await makeJob("Envelope");
    await workOrdersService.changeStatus(db, dispatcher, id, { status: "CANCELLED", reason: "x" });
    const token = (await authService.loginForTokens("tech1@demo.local", password, "127.0.0.1")).accessToken;
    const res = await transitionRoute(
      new NextRequest(`http://localhost/api/v1/field/jobs/${id}/transition`, {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { success: boolean; code: string; message: string };
    expect(body).toMatchObject({ success: false, code: "JOB_CANCELLED" });
  });
});

describe("Offline Phase 5 — installations changed by the office", () => {
  it("a record the office deleted: INSTALLATION_NOT_FOUND", async () => {
    const { id, input } = await heldRecord();
    await installationsService.remove(db, id);
    expect((await failure(installationsService.hold(dbA, techA, input, id))).code).toBe("INSTALLATION_NOT_FOUND");
  });

  it("a record that is already completed: INSTALLATION_ALREADY_COMPLETED", async () => {
    const { id } = await heldRecord();
    await installationsService.completeHeld(
      dbA,
      techA,
      id,
      createInstallationSchema.parse({ ...form(), deviceId: `CF-${stamp}-x${++seq}`, fill: { lat: 31.5, lng: 74.3, accuracy: 10 } }),
    );
    const again = holdInstallationSchema.parse({ ...form(), holdReason: "again", fill: null });
    expect((await failure(installationsService.hold(dbA, techA, again, id))).code).toBe("INSTALLATION_ALREADY_COMPLETED");
  });

  it("different fields changed on both sides: both changes survive (hold)", async () => {
    const original = form({ location: "Lahore depot", notes: "" });
    const { id } = await heldRecord(original);
    // The office fixes the location while the technician is offline.
    await installationsService.update(
      db,
      id,
      createInstallationSchema.parse({ ...original, location: "Lahore, Gate 4", fill: { lat: 31.5, lng: 74.3, accuracy: 10 } }),
    );
    // The technician (offline) wrote a note, starting from the original values.
    const edited = holdInstallationSchema.parse({
      ...original,
      notes: "Camera mounted",
      holdReason: "Waiting for SIM",
      fill: null,
      base: original,
    });
    const saved = await installationsService.hold(dbA, techA, edited, id);
    expect(saved.merged).toEqual(["location"]);
    const now = await owner.installation.findUniqueOrThrow({ where: { id } });
    expect(now.location).toBe("Lahore, Gate 4"); // the office's fix kept
    expect(now.notes).toBe("Camera mounted"); // the technician's note kept
    expect(now.holdReason).toBe("Waiting for SIM");
  });

  it("different fields changed on both sides: both changes survive (complete)", async () => {
    const original = form({ location: "Karachi", notes: "" });
    const { id } = await heldRecord(original);
    await installationsService.update(
      db,
      id,
      createInstallationSchema.parse({ ...original, vehicleNo: "FIXED-1", fill: { lat: 31.5, lng: 74.3, accuracy: 10 } }),
    );
    const finishing = createInstallationSchema.parse({
      ...original,
      notes: "Done",
      fill: { lat: 31.52, lng: 74.35, accuracy: 15 },
      base: original,
    });
    const saved = await installationsService.completeHeld(dbA, techA, id, finishing);
    expect(saved.merged).toEqual(["vehicleNo"]);
    const now = await owner.installation.findUniqueOrThrow({ where: { id } });
    expect(now).toMatchObject({ vehicleNo: "FIXED-1", notes: "Done", status: "COMPLETED" });
  });

  it("when both changed the same field the technician's value wins", async () => {
    const original = form({ location: "Multan" });
    const { id } = await heldRecord(original);
    await installationsService.update(
      db,
      id,
      createInstallationSchema.parse({ ...original, location: "Multan (office)", fill: { lat: 31.5, lng: 74.3, accuracy: 10 } }),
    );
    const edited = holdInstallationSchema.parse({ ...original, location: "Multan, Site B", holdReason: "x", fill: null, base: original });
    const saved = await installationsService.hold(dbA, techA, edited, id);
    expect(saved.merged).toEqual([]);
    expect((await owner.installation.findUniqueOrThrow({ where: { id } })).location).toBe("Multan, Site B");
  });

  it("without `base` the change is applied as sent (nothing to merge)", async () => {
    const original = form({ location: "Quetta" });
    const { id } = await heldRecord(original);
    await installationsService.update(
      db,
      id,
      createInstallationSchema.parse({ ...original, location: "Quetta (office)", fill: { lat: 31.5, lng: 74.3, accuracy: 10 } }),
    );
    const edited = holdInstallationSchema.parse({ ...original, holdReason: "x", fill: null });
    await installationsService.hold(dbA, techA, edited, id);
    expect((await owner.installation.findUniqueOrThrow({ where: { id } })).location).toBe("Quetta");
  });
});

describe("mergeWithServer", () => {
  const base = {
    customerId: "c1", vehicleNo: "AB-1", deviceId: "D1", simNo: "", installDate: "2026-11-04", location: "L",
    latitude: "", longitude: "", deviceType: "DMS camera", hasTempSensor: false, checklist: ["A", "B"], notes: "",
  };

  it("keeps the server's value for every field the technician left alone", () => {
    const server = { ...base, location: "L2", checklist: ["B", "A", "C"] };
    const mine = { ...base, notes: "hi" };
    const r = mergeWithServer(server, base, mine);
    expect(r.input.location).toBe("L2");
    expect(r.input.checklist).toEqual(["B", "A", "C"]);
    expect(r.input.notes).toBe("hi");
    expect(r.merged.sort()).toEqual(["checklist", "location"]);
  });

  it("ignores case and spacing when it decides whether a field was touched", () => {
    const r = mergeWithServer({ ...base, vehicleNo: "NEW-9" }, base, { ...base, vehicleNo: " ab-1 " });
    expect(r.input.vehicleNo).toBe("NEW-9");
  });

  it("changes nothing when the server did not change", () => {
    const r = mergeWithServer(base, base, { ...base, notes: "x" });
    expect(r.merged).toEqual([]);
    expect(r.input).toEqual({ ...base, notes: "x" });
  });
});
