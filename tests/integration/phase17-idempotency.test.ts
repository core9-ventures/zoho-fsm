/**
 * Offline Phase 3: a write call sent twice with the same Idempotency-Key is applied once (the phone's outbox
 * retries a change when the answer got lost). Runs against the seeded dev database and removes what it creates.
 */
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as notesRoute } from "@/app/api/v1/field/jobs/[id]/notes/route";
import { POST as transitionRoute } from "@/app/api/v1/field/jobs/[id]/transition/route";
import { createDb, prismaBase, tenantContext, type AppDb } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { authService } from "@/modules/auth";
import { schedulingService } from "@/modules/scheduling";
import { workOrdersService } from "@/modules/work-orders";

const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const stamp = Date.now().toString(36);
const password = process.env.SEED_PASSWORD ?? "";

let dispatcher: CurrentUser;
let techA: CurrentUser;
let token = "";
let workOrderId = "";
let db: AppDb;

const asUser = (u: { id: string; role: string; companyId: string | null; fullName: string; email: string }) =>
  ({ id: u.id, role: u.role, companyId: u.companyId, fullName: u.fullName, email: u.email, via: "session" }) as CurrentUser;

const call = (
  handler: typeof notesRoute,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  handler(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    }),
    { params: Promise.resolve({ id: workOrderId }) },
  );

beforeAll(async () => {
  const d = await owner.user.findFirstOrThrow({ where: { email: "dispatcher@demo.local" } });
  dispatcher = asUser(d);
  db = createDb(tenantContext(d.companyId!, d.id));
  techA = asUser(await owner.user.findFirstOrThrow({ where: { email: "tech1@demo.local" } }));
  const customer = await owner.customer.findFirstOrThrow({ where: { companyId: d.companyId!, deletedAt: null } });
  const wo = await workOrdersService.create(db, dispatcher, {
    customerId: customer.id,
    addressId: "",
    assetId: "",
    title: `Idempotency ${stamp}`,
    description: "",
    priority: "MEDIUM",
    dueDate: "",
    checklistTemplateId: "",
  });
  workOrderId = wo.id;
  const day = new Date(Date.now() + 2 * 24 * 3600_000).toISOString().slice(0, 10);
  await schedulingService.schedule(db, dispatcher, wo.id, { technicianId: techA.id, start: `${day}T09:00`, durationMin: 60 });
  token = (await authService.loginForTokens("tech1@demo.local", password, "127.0.0.1")).accessToken;
});

afterAll(async () => {
  const where = { workOrderId };
  await owner.idempotencyKey.deleteMany({ where: { userId: techA.id, key: { startsWith: `t-${stamp}` } } });
  await owner.auditLog.deleteMany({ where: { entityId: workOrderId } });
  await owner.timeSheet.deleteMany({ where: { appointment: where } });
  await owner.appointment.deleteMany({ where });
  await owner.workOrderStatusChange.deleteMany({ where });
  await owner.workOrderChecklistItem.deleteMany({ where });
  await owner.workOrderNote.deleteMany({ where });
  await owner.workOrder.deleteMany({ where: { id: workOrderId } });
  await owner.$disconnect();
  await prismaBase.$disconnect();
});

describe("Offline Phase 3 — Idempotency-Key", () => {
  it("the same key sent twice saves the note once and returns the first answer", async () => {
    const path = `/api/v1/field/jobs/${workOrderId}/notes`;
    const headers = { "idempotency-key": `t-${stamp}-note` };
    const first = await call(notesRoute, path, { text: "only once" }, headers);
    expect(first.status).toBe(201);
    expect(first.headers.get("idempotent-replay")).toBeNull();

    const second = await call(notesRoute, path, { text: "only once" }, headers);
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replay")).toBe("true");
    expect(await second.json()).toEqual(await first.json());

    const notes = await owner.workOrderNote.count({ where: { workOrderId, text: "only once" } });
    expect(notes).toBe(1);
  });

  it("without a key every call runs", async () => {
    const path = `/api/v1/field/jobs/${workOrderId}/notes`;
    await call(notesRoute, path, { text: "twice" });
    await call(notesRoute, path, { text: "twice" });
    expect(await owner.workOrderNote.count({ where: { workOrderId, text: "twice" } })).toBe(2);
  });

  it("a refusal is remembered too: the retry gets the same refusal without running again", async () => {
    const path = `/api/v1/field/jobs/${workOrderId}/transition`;
    const headers = { "idempotency-key": `t-${stamp}-bad` };
    // "resume" is not allowed on a scheduled job.
    const first = await call(transitionRoute, path, { action: "resume" }, headers);
    expect(first.status).toBe(409);
    const second = await call(transitionRoute, path, { action: "resume" }, headers);
    expect(second.status).toBe(409);
    expect(second.headers.get("idempotent-replay")).toBe("true");
  });

  it("a status change sent twice with one key moves the job once", async () => {
    const path = `/api/v1/field/jobs/${workOrderId}/transition`;
    const headers = { "idempotency-key": `t-${stamp}-start` };
    expect((await call(transitionRoute, path, { action: "start" }, headers)).status).toBe(200);
    // Without the key this second "start" would be refused (the job is already in progress).
    const again = await call(transitionRoute, path, { action: "start" }, headers);
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replay")).toBe("true");
    const changes = await owner.workOrderStatusChange.count({ where: { workOrderId, toStatus: "IN_PROGRESS" } });
    expect(changes).toBe(1);
  });

  it("the same key on a different call is refused", async () => {
    const headers = { "idempotency-key": `t-${stamp}-note` };
    const res = await call(transitionRoute, `/api/v1/field/jobs/${workOrderId}/transition`, { action: "complete" }, headers);
    expect(res.status).toBe(422);
  });

  it("another user can use the same key without clashing", async () => {
    const other = await authService.loginForTokens("tech2@demo.local", password, "127.0.0.1");
    const res = await notesRoute(
      new NextRequest(`http://localhost/api/v1/field/jobs/${workOrderId}/notes`, {
        method: "POST",
        body: JSON.stringify({ text: "x" }),
        headers: { authorization: `Bearer ${other.accessToken}`, "content-type": "application/json", "idempotency-key": `t-${stamp}-note` },
      }),
      { params: Promise.resolve({ id: workOrderId }) },
    );
    // tech2 is not assigned to this job (refused as JOB_REASSIGNED), but the key itself did not collide.
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("JOB_REASSIGNED");
    await owner.idempotencyKey.deleteMany({ where: { key: `t-${stamp}-note` } });
  });
});
