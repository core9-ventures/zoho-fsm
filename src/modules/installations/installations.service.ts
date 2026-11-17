import "server-only";
import { Prisma } from "@prisma/client";
import type {
  CustomerChoice,
  SiteChoice,
  InstallationDetail,
  InstallationInput,
  InstallationListItem,
  InstallationListQuery,
} from "./installations.schema";
import type { CurrentUser } from "@/lib/auth";
import type { AppDb } from "@/lib/db";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { paged, toSkipTake, type PagedResult } from "@/lib/pagination";
import { baseType, deleteStoredFile, nameForType, safeFileName, saveFile } from "@/lib/storage";
import { nullIfEmpty } from "@/lib/validation";
import { isInstallationSlot } from "./installations.schema";
import { mediaKindOf } from "@/modules/work-orders";
import type { MediaDto } from "@/modules/work-orders/work-orders.schema";

const ENTITY = "INSTALLATION";
/** Extra photos (not before/after proof) one installation can hold. */
const OTHER_PHOTO_LIMIT = 15;

const companyOf = (actor: CurrentUser) => {
  if (!actor.companyId) throw new ForbiddenError("This action needs a company account.");
  return actor.companyId;
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

function mediaOf(a: {
  id: string;
  fileName: string;
  kind: string;
  contentType: string | null;
  slot: string | null;
  createdAt: Date;
  createdById: string | null;
}): MediaDto {
  return {
    id: a.id,
    fileName: a.fileName,
    kind: a.kind as MediaDto["kind"],
    contentType: a.contentType,
    slot: a.slot,
    createdAt: a.createdAt.toISOString(),
    author: null,
    authorId: a.createdById,
  };
}

async function mineOrThrow(db: AppDb, actor: CurrentUser, id: string) {
  const row = await db.installation.findFirst({ where: { id }, select: { id: true, createdById: true } });
  // A technician sees only the installations they recorded.
  if (!row || (actor.role === "TECHNICIAN" && row.createdById !== actor.id))
    throw new NotFoundError("Installation", id);
  return row;
}

async function customerOrThrow(db: AppDb, customerId: string) {
  const customer = await db.customer.findFirst({ where: { id: customerId }, select: { id: true } });
  if (!customer) throw new BadRequestError("Choose a company.", { customerId: ["Choose a company."] });
}

/** A device can be installed once: refuse a Device ID that another (not deleted) installation already uses. */
async function deviceFreeOrThrow(db: AppDb, deviceId: string, exceptId?: string) {
  const used = await db.installation.findFirst({
    where: {
      deviceId: { equals: deviceId.trim(), mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { vehicleNo: true, installDate: true },
  });
  if (!used) return;
  const message = `Device ${deviceId.trim()} is already installed on vehicle ${used.vehicleNo} (${day(used.installDate)}).`;
  throw new ConflictError(message, { deviceId: [message] });
}

function dataOf(input: InstallationInput) {
  return {
    customerId: input.customerId,
    vehicleNo: input.vehicleNo.toUpperCase(),
    deviceId: input.deviceId,
    simNo: nullIfEmpty(input.simNo),
    installDate: new Date(`${input.installDate}T00:00:00Z`),
    location: input.location,
    latitude: input.latitude === "" ? null : new Prisma.Decimal(Number(input.latitude).toFixed(6)),
    longitude: input.longitude === "" ? null : new Prisma.Decimal(Number(input.longitude).toFixed(6)),
    deviceType: input.deviceType,
    hasTempSensor: input.hasTempSensor,
    checklist: [...new Set(input.checklist)],
    notes: nullIfEmpty(input.notes),
  };
}

export const installationsService = {
  async customerOptions(db: AppDb): Promise<CustomerChoice[]> {
    const [customers, addresses] = await Promise.all([
      db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
      db.serviceAddress.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          customerId: true,
          label: true,
          addressLine: true,
          city: true,
          latitude: true,
          longitude: true,
        },
        take: 3000,
      }),
    ]);
    const sites = new Map<string, SiteChoice[]>();
    for (const a of addresses) {
      const text = [a.label, a.addressLine, a.city].filter(Boolean).join(", ");
      sites.set(a.customerId, [
        ...(sites.get(a.customerId) ?? []),
        { id: a.id, label: text, lat: num(a.latitude), lng: num(a.longitude) },
      ]);
    }
    return customers.map((c) => ({ ...c, sites: sites.get(c.id) ?? [] }));
  },

  async create(db: AppDb, actor: CurrentUser, input: InstallationInput): Promise<{ id: string }> {
    const companyId = companyOf(actor);
    await customerOrThrow(db, input.customerId);
    await deviceFreeOrThrow(db, input.deviceId);
    return db.installation.create({ data: { companyId, ...dataOf(input) }, select: { id: true } });
  },

  /** Office staff correct a saved record. */
  async update(db: AppDb, id: string, input: InstallationInput): Promise<{ id: string }> {
    const row = await db.installation.findFirst({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundError("Installation", id);
    await customerOrThrow(db, input.customerId);
    await deviceFreeOrThrow(db, input.deviceId, id);
    return db.installation.update({ where: { id }, data: dataOf(input), select: { id: true } });
  },

  async list(db: AppDb, actor: CurrentUser, q: InstallationListQuery): Promise<PagedResult<InstallationListItem>> {
    const where: Prisma.InstallationWhereInput = {
      ...(actor.role === "TECHNICIAN" ? { createdById: actor.id } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.from || q.to
        ? {
            installDate: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { vehicleNo: { contains: q.search, mode: "insensitive" } },
              { deviceId: { contains: q.search, mode: "insensitive" } },
              { location: { contains: q.search, mode: "insensitive" } },
              { customer: { name: { contains: q.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.installation.findMany({
        where,
        orderBy: [{ installDate: "desc" }, { createdAt: "desc" }],
        ...toSkipTake(q),
        include: { customer: { select: { name: true } } },
      }),
      db.installation.count({ where }),
    ]);
    const photos = rows.length
      ? await db.attachment.findMany({
          where: { entityType: ENTITY, entityId: { in: rows.map((r) => r.id) } },
          orderBy: { createdAt: "asc" },
          select: { id: true, entityId: true, kind: true },
        })
      : [];
    const byId = new Map<string, typeof photos>();
    for (const p of photos) byId.set(p.entityId, [...(byId.get(p.entityId) ?? []), p]);
    const authors = await db.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))] } },
      select: { id: true, fullName: true },
    });
    const nameOf = new Map(authors.map((a) => [a.id, a.fullName]));
    return paged(
      rows.map((r) => ({
        id: r.id,
        vehicleNo: r.vehicleNo,
        deviceId: r.deviceId,
        customerName: r.customer.name,
        deviceType: r.deviceType,
        location: r.location,
        installDate: day(r.installDate),
        createdBy: r.createdById ? (nameOf.get(r.createdById) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        fileCount: (byId.get(r.id) ?? []).length,
        thumbs: (byId.get(r.id) ?? [])
          .filter((p) => p.kind === "PHOTO")
          .slice(0, 4)
          .map((p) => p.id),
      })),
      total,
      q,
    );
  },

  async get(db: AppDb, actor: CurrentUser, id: string): Promise<InstallationDetail> {
    await mineOrThrow(db, actor, id);
    const r = await db.installation.findFirstOrThrow({
      where: { id },
      include: { customer: { select: { name: true } } },
    });
    const files = await db.attachment.findMany({
      where: { entityType: ENTITY, entityId: id },
      orderBy: { createdAt: "asc" },
    });
    const author = r.createdById
      ? await db.user.findFirst({ where: { id: r.createdById }, select: { fullName: true } })
      : null;
    return {
      id: r.id,
      customerId: r.customerId,
      vehicleNo: r.vehicleNo,
      deviceId: r.deviceId,
      customerName: r.customer.name,
      deviceType: r.deviceType,
      location: r.location,
      installDate: day(r.installDate),
      createdBy: author?.fullName ?? null,
      createdAt: r.createdAt.toISOString(),
      simNo: r.simNo,
      latitude: num(r.latitude),
      longitude: num(r.longitude),
      hasTempSensor: r.hasTempSensor,
      checklist: r.checklist,
      notes: r.notes,
      files: files.filter((f) => f.slot !== null || f.kind === "VIDEO").map(mediaOf),
      photos: files.filter((f) => f.slot === null && f.kind === "PHOTO").map(mediaOf),
    };
  },

  /**
   * Adds one photo or video. A labeled photo and the video each hold one file (a new one replaces the old);
   * a photo without a label goes under "Other photos", 15 at most.
   */
  async addFile(db: AppDb, actor: CurrentUser, id: string, file: File, opts: { slot?: string } = {}) {
    const companyId = companyOf(actor);
    await mineOrThrow(db, actor, id);
    const kind = mediaKindOf(baseType(file.type));
    if (!kind) throw new BadRequestError("Use a photo or a video.", { file: ["Use a photo or a video."] });
    const slot = opts.slot || undefined;
    if (slot && !isInstallationSlot(slot))
      throw new BadRequestError("Unknown photo label.", { slot: ["Unknown label."] });
    if (slot && kind !== "PHOTO")
      throw new BadRequestError("A labeled box takes a photo, not a video.", { file: ["Use a photo."] });
    if (!slot && kind === "PHOTO") {
      const have = await db.attachment.count({
        where: { entityType: ENTITY, entityId: id, kind: "PHOTO", slot: null },
      });
      if (have >= OTHER_PHOTO_LIMIT) {
        const message = `This installation already has ${OTHER_PHOTO_LIMIT} other photos.`;
        throw new ConflictError(message, { file: [message] });
      }
    }

    const stored = await saveFile(companyId, file, { compress: true });
    try {
      const created = await db.attachment.create({
        data: {
          companyId,
          entityType: ENTITY,
          entityId: id,
          fileName: nameForType(safeFileName(file.name), stored.contentType),
          storageKey: stored.key,
          thumbKey: stored.thumbKey ?? null,
          contentType: stored.contentType,
          sizeBytes: stored.size,
          kind,
          slot: slot ?? null,
        },
        select: { id: true, fileName: true },
      });
      // Taking a labeled photo (or the video) again replaces the old one.
      if (slot || kind === "VIDEO") {
        await db.attachment.deleteMany({
          where: {
            entityType: ENTITY,
            entityId: id,
            id: { not: created.id },
            ...(slot ? { slot } : { kind: "VIDEO" }),
          },
        });
      }
      return created;
    } catch (e) {
      await deleteStoredFile(stored.key);
      if (stored.thumbKey) await deleteStoredFile(stored.thumbKey);
      throw e;
    }
  },

  async removeFile(db: AppDb, actor: CurrentUser, id: string, attachmentId: string) {
    await mineOrThrow(db, actor, id);
    const a = await db.attachment.findFirst({ where: { id: attachmentId, entityType: ENTITY, entityId: id } });
    if (!a) throw new NotFoundError("Attachment", attachmentId);
    await db.attachment.delete({ where: { id: attachmentId } });
  },

  async remove(db: AppDb, id: string) {
    const row = await db.installation.findFirst({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundError("Installation", id);
    await db.installation.delete({ where: { id } });
  },

  /** Used by the file route: may this user open files of this installation? */
  async canOpen(db: AppDb, actor: CurrentUser, id: string) {
    const row = await db.installation.findFirst({ where: { id }, select: { createdById: true } });
    return !!row && (actor.role !== "TECHNICIAN" || row.createdById === actor.id);
  },
};
