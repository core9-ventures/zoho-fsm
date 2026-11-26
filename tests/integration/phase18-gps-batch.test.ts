/**
 * Offline Phase 4: GPS readings collected without a signal arrive in one batch with their own times
 * (POST /api/v1/field/location/batch). Runs against the seeded dev database and removes what it creates.
 */
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as batchRoute } from "@/app/api/v1/field/location/batch/route";
import { prismaBase } from "@/lib/db";
import { authService } from "@/modules/auth";

const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const password = process.env.SEED_PASSWORD ?? "";
const marker = 31.234567; // a longitude no real reading has: lets the test find and remove its own rows

let techId = "";
let techToken = "";
let officeToken = "";

const post = (token: string, body: unknown, headers: Record<string, string> = {}) =>
  batchRoute(
    new NextRequest("http://localhost/api/v1/field/location/batch", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    }),
    { params: Promise.resolve({}) },
  );

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const point = (recordedAt: string, latitude = 24.5) => ({ latitude, longitude: marker, accuracy: 12, recordedAt });
const mine = () => owner.technicianLocation.findMany({ where: { technicianId: techId, longitude: marker }, orderBy: { recordedAt: "asc" } });

beforeAll(async () => {
  techId = (await owner.user.findFirstOrThrow({ where: { email: "tech1@demo.local" } })).id;
  techToken = (await authService.loginForTokens("tech1@demo.local", password, "127.0.0.1")).accessToken;
  officeToken = (await authService.loginForTokens("dispatcher@demo.local", password, "127.0.0.1")).accessToken;
});

afterAll(async () => {
  await owner.technicianLocation.deleteMany({ where: { technicianId: techId, longitude: marker } });
  await owner.idempotencyKey.deleteMany({ where: { userId: techId, key: { startsWith: "t-gps" } } });
  await owner.$disconnect();
  await prismaBase.$disconnect();
});

describe("Offline Phase 4 — GPS batch", () => {
  it("saves each reading with the time it was taken", async () => {
    const t1 = ago(3 * 3600_000);
    const t2 = ago(2 * 3600_000);
    const res = await post(techToken, { points: [point(t1, 24.1), point(t2, 24.2)] });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { data: { saved: number } }).data.saved).toBe(2);
    const rows = await mine();
    expect(rows.map((r) => r.recordedAt.toISOString())).toEqual([t1, t2]);
    expect(rows.map((r) => Number(r.latitude))).toEqual([24.1, 24.2]);
  });

  it("moves a time in the future to now and drops readings older than a week", async () => {
    const res = await post(techToken, {
      points: [point(new Date(Date.now() + 3600_000).toISOString(), 24.3), point(ago(8 * 24 * 3600_000), 24.4)],
    });
    const data = ((await res.json()) as { data: { saved: number; skipped: number } }).data;
    expect(data).toEqual({ saved: 1, skipped: 1 });
    const rows = await mine();
    const future = rows.find((r) => Number(r.latitude) === 24.3)!;
    expect(future.recordedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(rows.some((r) => Number(r.latitude) === 24.4)).toBe(false);
  });

  it("the same batch sent twice with one Idempotency-Key is saved once", async () => {
    const body = { points: [point(ago(60_000), 24.5)] };
    const headers = { "idempotency-key": "t-gps-once" };
    expect((await post(techToken, body, headers)).status).toBe(201);
    const again = await post(techToken, body, headers);
    expect(again.headers.get("idempotent-replay")).toBe("true");
    expect((await mine()).filter((r) => Number(r.latitude) === 24.5)).toHaveLength(1);
  });

  it("refuses office users, empty batches, bad values and too many readings", async () => {
    expect((await post(officeToken, { points: [point(ago(1000))] })).status).toBe(403);
    expect((await post(techToken, { points: [] })).status).toBe(400);
    expect((await post(techToken, { points: [{ latitude: 95, longitude: 1, recordedAt: ago(1000) }] })).status).toBe(400);
    expect((await post(techToken, { points: [{ latitude: 1, longitude: 1, recordedAt: "yesterday" }] })).status).toBe(400);
    const many = Array.from({ length: 201 }, () => point(ago(1000)));
    expect((await post(techToken, { points: many })).status).toBe(400);
  });
});
