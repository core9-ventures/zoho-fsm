/**
 * New installations recorded by technicians.
 *  - The input is validated (required fields, SIM digits, device type, coordinates in pairs).
 *  - A technician sees only their own records; the office sees all of them.
 *  - Photos: a labeled photo holds one file per phase (a new one replaces it); a phase holds one video.
 * Runs against the seeded dev database (Demo company) and removes what it creates.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/auth";
import { createDb, prismaBase, tenantContext, type AppDb } from "@/lib/db";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import {
  createInstallationSchema,
  holdInstallationSchema,
  installationListQuerySchema,
  installationsService,
  INSTALLATION_CHECKLIST,
  type HoldInstallationInput,
  type InstallationInput,
} from "@/modules/installations";
import { TINY_PNG } from "../helpers/images";

const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const stamp = Date.now().toString(36).toUpperCase();

let companyId: string;
let customerId: string;
let dispatcher: CurrentUser;
let techA: CurrentUser;
let techB: CurrentUser;
let db: AppDb;
let dbA: AppDb;
let dbB: AppDb;
const ids: string[] = [];

const asUser = (u: { id: string; role: string; companyId: string | null; fullName: string; email: string }) =>
  ({
    id: u.id,
    role: u.role,
    customRoleId: null,
    customRoleName: null,
    permissions: [],
    companyId: u.companyId,
    fullName: u.fullName,
    email: u.email,
    via: "session",
  }) as CurrentUser;

const photo = (n: number) => new File([TINY_PNG], `p${n}.png`, { type: "image/png" });
const video = () => new File([Buffer.from("00000018667479706d703432", "hex")], "v.mp4", { type: "video/mp4" });

let seq = 0;
const input = (over: Partial<Record<keyof InstallationInput, unknown>> = {}) =>
  createInstallationSchema.parse({
    customerId,
    vehicleNo: ` jv-${stamp} `,
    deviceId: `DEV-${stamp}-${++seq}`,
    simNo: "0300 1234567",
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

async function make(
  as: CurrentUser = techA,
  d: AppDb = dbA,
  over: Partial<Record<keyof InstallationInput, unknown>> = {},
) {
  const r = await installationsService.create(d, as, input(over));
  ids.push(r.id);
  return r.id;
}

beforeAll(async () => {
  const d = await owner.user.findFirstOrThrow({ where: { email: "dispatcher@demo.local" } });
  const a = await owner.user.findFirstOrThrow({ where: { email: "tech1@demo.local" } });
  const b = await owner.user.findFirstOrThrow({ where: { email: "tech2@demo.local" } });
  companyId = d.companyId!;
  dispatcher = asUser(d);
  techA = asUser(a);
  techB = asUser(b);
  db = createDb(tenantContext(companyId, d.id));
  dbA = createDb(tenantContext(companyId, a.id));
  dbB = createDb(tenantContext(companyId, b.id));
  customerId = (await owner.customer.findFirstOrThrow({ where: { companyId, deletedAt: null } })).id;
});

afterAll(async () => {
  const files = await owner.attachment.findMany({ where: { entityId: { in: ids } }, select: { storageKey: true } });
  for (const f of files) await rm(path.resolve(process.env.UPLOAD_DIR ?? "./uploads", f.storageKey), { force: true });
  await owner.attachment.deleteMany({ where: { entityId: { in: ids } } });
  await owner.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await owner.installation.deleteMany({ where: { id: { in: ids } } });
  await owner.$disconnect();
  await prismaBase.$disconnect();
});

describe("validation", () => {
  it("requires the main fields and a known device type", () => {
    const bad = createInstallationSchema.safeParse({ vehicleNo: "", deviceType: "Toaster" });
    expect(bad.success).toBe(false);
  });
  it("accepts digits only in the SIM number", () => {
    expect(createInstallationSchema.safeParse({ ...input(), simNo: "abc" }).success).toBe(false);
  });
  it("needs latitude and longitude together", () => {
    const r = createInstallationSchema.safeParse({ ...input(), latitude: "31.5", longitude: "" });
    expect(r.success).toBe(false);
  });
  it("rejects a date that does not exist", () => {
    expect(createInstallationSchema.safeParse({ ...input(), installDate: "2026-13-45" }).success).toBe(false);
  });
});

describe("saving and reading", () => {
  it("saves the record with an upper-case vehicle number and the pin", async () => {
    const id = await make(techA, dbA, { latitude: "31.520400", longitude: "74.358700" });
    const got = await installationsService.get(dbA, techA, id);
    expect(got.vehicleNo).toBe(`JV-${stamp}`);
    expect(got.latitude).toBeCloseTo(31.5204, 4);
    expect(got.checklist).toHaveLength(INSTALLATION_CHECKLIST.length);
    expect(got.installDate).toBe("2026-11-04");
  });

  it("refuses a company that is not in this tenant", async () => {
    await expect(installationsService.create(dbA, techA, input({ customerId: "nope" }))).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("a technician sees only their own records, the office sees all", async () => {
    const mine = await make(techA, dbA);
    const q = installationListQuerySchema.parse({ search: stamp });
    const a = await installationsService.list(dbA, techA, q);
    const b = await installationsService.list(dbB, techB, q);
    const office = await installationsService.list(db, dispatcher, q);
    expect(a.items.map((i) => i.id)).toContain(mine);
    expect(b.items.map((i) => i.id)).not.toContain(mine);
    expect(office.items.map((i) => i.id)).toContain(mine);
    await expect(installationsService.get(dbB, techB, mine)).rejects.toBeInstanceOf(NotFoundError);
    await expect(installationsService.canOpen(dbB, techB, mine)).resolves.toBe(false);
    await expect(installationsService.canOpen(db, dispatcher, mine)).resolves.toBe(true);
  });
});

describe("editing", () => {
  it("office can correct every field; unknown ids are refused", async () => {
    const id = await make();
    await installationsService.update(
      db,
      id,
      input({
        vehicleNo: `ab-${stamp}`,
        deviceType: "GPS tracker",
        notes: "fixed",
        checklist: ["Sim"],
        latitude: "31.1",
        longitude: "74.2",
      }),
    );
    const got = await installationsService.get(db, dispatcher, id);
    expect(got.vehicleNo).toBe(`AB-${stamp}`);
    expect(got.deviceType).toBe("GPS tracker");
    expect(got.checklist).toEqual(["Sim"]);
    expect(got.notes).toBe("fixed");
    await expect(installationsService.update(db, "nope", input())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the list returns photo previews", async () => {
    const id = await make();
    await installationsService.addFile(dbA, techA, id, photo(1));
    const r = await installationsService.list(dbA, techA, installationListQuerySchema.parse({ search: stamp }));
    const row = r.items.find((x) => x.id === id)!;
    expect(row.fileCount).toBe(1);
    expect(row.thumbs).toHaveLength(1);
  });
});

describe("photos and video", () => {
  it("keeps one file per label: a new photo replaces the old", async () => {
    const id = await make();
    await installationsService.addFile(dbA, techA, id, photo(1), { slot: "FRONT" });
    await installationsService.addFile(dbA, techA, id, photo(2), { slot: "FRONT" });
    await installationsService.addFile(dbA, techA, id, photo(3), { slot: "CABIN_1" });
    const got = await installationsService.get(dbA, techA, id);
    expect(got.files.filter((m) => m.slot === "FRONT")).toHaveLength(1);
    expect(got.files.find((m) => m.slot === "FRONT")!.fileName).toBe("p2.jpg");
    expect(got.files).toHaveLength(2);
  });

  it("holds one video (a new one replaces it) and no labeled video", async () => {
    const id = await make();
    await installationsService.addFile(dbA, techA, id, video());
    await installationsService.addFile(dbA, techA, id, video());
    const got = await installationsService.get(dbA, techA, id);
    expect(got.files.filter((m) => m.kind === "VIDEO")).toHaveLength(1);
    await expect(installationsService.addFile(dbA, techA, id, video(), { slot: "FRONT" })).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("refuses an unknown label, and stores unlabeled photos as other photos", async () => {
    const id = await make();
    await expect(installationsService.addFile(dbA, techA, id, photo(1), { slot: "BOGUS" })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    await installationsService.addFile(dbA, techA, id, photo(3));
    const got = await installationsService.get(dbA, techA, id);
    expect(got.photos).toHaveLength(1);
    expect(got.files).toHaveLength(0);
  });

  it("another technician cannot add or remove files, and a removed file disappears", async () => {
    const id = await make();
    await expect(installationsService.addFile(dbB, techB, id, photo(1))).rejects.toBeInstanceOf(NotFoundError);
    const f = await installationsService.addFile(dbA, techA, id, photo(1));
    await expect(installationsService.removeFile(dbB, techB, id, f.id)).rejects.toBeInstanceOf(NotFoundError);
    await installationsService.removeFile(db, dispatcher, id, f.id);
    expect((await installationsService.get(dbA, techA, id)).photos).toHaveLength(0);
  });

  it("deleting the record hides it", async () => {
    const id = await make();
    await installationsService.remove(db, id);
    await expect(installationsService.get(db, dispatcher, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("company sites", () => {
  it("lists each company's saved sites for the location dropdown", async () => {
    const options = await installationsService.customerOptions(db);
    const site = await owner.serviceAddress.findFirstOrThrow({ where: { companyId, deletedAt: null } });
    const company = options.find((o) => o.id === site.customerId)!;
    expect(company.sites.map((s) => s.id)).toContain(site.id);
  });
});

describe("unique device", () => {
  it("refuses a Device ID that is already installed, whatever its letter case", async () => {
    const device = `UNIQ-${stamp}`;
    await make(techA, dbA, { deviceId: device });
    await expect(make(techB, dbB, { deviceId: device.toLowerCase() })).rejects.toBeInstanceOf(ConflictError);
    await expect(installationsService.create(dbA, techA, input({ deviceId: ` ${device} ` }))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("lets a record keep its own Device ID when edited, and frees it when deleted", async () => {
    const device = `FREE-${stamp}`;
    const id = await make(techA, dbA, { deviceId: device });
    await installationsService.update(db, id, input({ deviceId: device, notes: "same device" }));
    await installationsService.remove(db, id);
    await make(techA, dbA, { deviceId: device });
  });
});

describe("hold", () => {
  const holdInput = (over: Partial<Record<keyof HoldInstallationInput, unknown>> = {}) =>
    holdInstallationSchema.parse({
      customerId: "",
      vehicleNo: "",
      deviceId: "",
      simNo: "",
      installDate: "2026-11-04",
      location: "",
      latitude: "",
      longitude: "",
      deviceType: "",
      hasTempSensor: false,
      checklist: [],
      notes: "",
      holdReason: "Waiting for the customer",
      ...over,
    });

  it("needs a reason to hold", () => {
    expect(holdInstallationSchema.safeParse({ ...holdInput(), holdReason: "   " }).success).toBe(false);
  });

  it("accepts a completely empty form", async () => {
    const r = await installationsService.hold(dbA, techA, holdInput());
    ids.push(r.id);
    const got = await installationsService.get(dbA, techA, r.id);
    expect(got.status).toBe("ON_HOLD");
    expect(got.holdReason).toBe("Waiting for the customer");
    expect(got.customerId).toBeNull();
    expect(got.vehicleNo).toBe("");
  });

  it("keeps what was filled in, and appears in the held list of its technician only", async () => {
    const r = await installationsService.hold(
      dbA,
      techA,
      holdInput({ customerId, vehicleNo: ` hold-${stamp} `, notes: "half done" }),
    );
    ids.push(r.id);
    const mine = await installationsService.list(dbA, techA, installationListQuerySchema.parse({ status: "ON_HOLD" }));
    expect(mine.items.map((i) => i.id)).toContain(r.id);
    const others = await installationsService.list(dbB, techB, installationListQuerySchema.parse({ status: "ON_HOLD" }));
    expect(others.items.map((i) => i.id)).not.toContain(r.id);
    const done = await installationsService.list(dbA, techA, installationListQuerySchema.parse({ status: "COMPLETED" }));
    expect(done.items.map((i) => i.id)).not.toContain(r.id);
    await expect(installationsService.get(dbB, techB, r.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("can be held again, then completed; completing checks every required field", async () => {
    const r = await installationsService.hold(dbA, techA, holdInput({ vehicleNo: `again-${stamp}` }));
    ids.push(r.id);
    await installationsService.hold(dbA, techA, holdInput({ vehicleNo: `again-${stamp}`, notes: "second save" }), r.id);
    expect((await installationsService.get(dbA, techA, r.id)).notes).toBe("second save");

    // The form refuses to complete without the required fields.
    expect(createInstallationSchema.safeParse({ ...holdInput(), customerId: "" }).success).toBe(false);

    await installationsService.completeHeld(dbA, techA, r.id, input({ vehicleNo: `again-${stamp}` }));
    const got = await installationsService.get(dbA, techA, r.id);
    expect(got.status).toBe("COMPLETED");
    expect(got.customerId).toBe(customerId);
  });

  it("a completed record can no longer be held, completed again or have its photos removed by the technician", async () => {
    const id = await make(techA, dbA);
    await expect(installationsService.hold(dbA, techA, holdInput(), id)).rejects.toBeInstanceOf(ConflictError);
    await expect(installationsService.completeHeld(dbA, techA, id, input())).rejects.toBeInstanceOf(ConflictError);
    const file = await installationsService.addFile(dbA, techA, id, photo(1), { slot: "FRONT" });
    await expect(installationsService.removeFile(dbA, techA, id, file.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("a held record keeps its photos and lets the technician remove one", async () => {
    const r = await installationsService.hold(dbA, techA, holdInput());
    ids.push(r.id);
    const file = await installationsService.addFile(dbA, techA, r.id, photo(2), { slot: "FRONT" });
    expect((await installationsService.get(dbA, techA, r.id)).files).toHaveLength(1);
    await installationsService.removeFile(dbA, techA, r.id, file.id);
    expect((await installationsService.get(dbA, techA, r.id)).files).toHaveLength(0);
  });

  it("refuses to hold with a Device ID that is already installed, but an empty one is fine", async () => {
    const device = `HOLDDEV-${stamp}`;
    await make(techA, dbA, { deviceId: device });
    await expect(installationsService.hold(dbB, techB, holdInput({ deviceId: device }))).rejects.toBeInstanceOf(
      ConflictError,
    );
    const a = await installationsService.hold(dbB, techB, holdInput());
    const b = await installationsService.hold(dbB, techB, holdInput());
    ids.push(a.id, b.id);
  });
});
