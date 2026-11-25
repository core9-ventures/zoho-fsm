/**
 * What the mobile app calls: token sign-in, then the installation endpoints with a bearer token.
 * Calls the route handlers directly (like the app would over HTTP), so roles, permissions and
 * validation are all exercised. Runs against the seeded dev database and removes what it creates.
 */
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { prismaBase } from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authService } from "@/modules/auth";
import { DELETE as discardRoute, GET as getRoute } from "@/app/api/v1/field/installations/[id]/route";
import { POST as holdNewRoute } from "@/app/api/v1/field/installations/hold/route";
import { PUT as holdUpdateRoute } from "@/app/api/v1/field/installations/[id]/hold/route";
import { POST as completeRoute } from "@/app/api/v1/field/installations/[id]/complete/route";
import { POST as officeHoldRoute } from "@/app/api/v1/installations/[id]/hold/route";
import { GET as officeGetRoute } from "@/app/api/v1/installations/[id]/route";
import { GET as listPlansRoute } from "@/app/api/v1/maintenance/route";
import { GET as dashboardRoute } from "@/app/api/v1/dashboard/route";
import { GET as listRolesRoute } from "@/app/api/v1/roles/route";

const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const password = process.env.SEED_PASSWORD ?? "";
const stamp = Date.now().toString(36).toUpperCase();
const created: string[] = [];

afterAll(async () => {
  await owner.auditLog.deleteMany({ where: { entityId: { in: created } } });
  await owner.installation.deleteMany({ where: { id: { in: created } } });
  await owner.$disconnect();
  await prismaBase.$disconnect();
});

const call = async (
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  token: string,
  method: string,
  body?: unknown,
  params: Record<string, string> = {},
) => {
  const req = new NextRequest("http://localhost/api/v1/test", {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler(req, { params: Promise.resolve(params) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: any; message?: string } };
};

const heldBody = (over: Record<string, unknown> = {}) => ({
  customerId: "",
  vehicleNo: `mob-${stamp}`,
  deviceId: "",
  simNo: "",
  installDate: "2026-11-24",
  location: "",
  latitude: "",
  longitude: "",
  deviceType: "",
  hasTempSensor: false,
  checklist: [],
  notes: "",
  holdReason: "Waiting for the customer",
  fill: { lat: 31.52, lng: 74.35, accuracy: 15 },
  ...over,
});

describe("mobile API flow", () => {
  it("a technician holds, edits and completes an installation with a bearer token", async () => {
    const tech = await authService.loginForTokens("tech1@demo.local", password, "127.0.0.1");
    const office = await authService.loginForTokens("dispatcher@demo.local", password, "127.0.0.1");
    const customer = await owner.customer.findFirstOrThrow({
      where: { companyId: tech.user.companyId!, deletedAt: null },
    });

    // Hold (new)
    const held = await call(holdNewRoute, tech.accessToken, "POST", heldBody());
    expect(held.status).toBe(201);
    const id = held.json.data.id as string;
    created.push(id);

    // The reason is required.
    const noReason = await call(holdNewRoute, tech.accessToken, "POST", heldBody({ holdReason: " " }));
    expect(noReason.status).toBe(400);

    // Hold (update the same record)
    const again = await call(holdUpdateRoute, tech.accessToken, "PUT", heldBody({ notes: "second save" }), { id });
    expect(again.status).toBe(200);
    const one = await call(getRoute, tech.accessToken, "GET", undefined, { id });
    expect(one.json.data).toMatchObject({ status: "ON_HOLD", notes: "second save" });

    // Complete: the position is required.
    const full = {
      customerId: customer.id,
      vehicleNo: `mob-${stamp}`,
      deviceId: `MOBDEV-${stamp}`,
      simNo: `0344${stamp.replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}`,
      installDate: "2026-11-24",
      location: "Lahore",
      latitude: "",
      longitude: "",
      deviceType: "DMS camera",
      hasTempSensor: false,
      checklist: [],
      notes: "",
    };
    const noFill = await call(completeRoute, tech.accessToken, "POST", full, { id });
    expect(noFill.status).toBe(400);
    const done = await call(completeRoute, tech.accessToken, "POST", { ...full, fill: heldBody().fill }, { id });
    expect(done.status).toBe(200);

    // The office can read it, put it back on hold, and the technician sees it held again.
    expect((await call(officeGetRoute, office.accessToken, "GET", undefined, { id })).json.data.status).toBe(
      "COMPLETED",
    );
    const noReasonOffice = await call(officeHoldRoute, office.accessToken, "POST", { reason: "" }, { id });
    expect(noReasonOffice.status).toBe(400);
    const back = await call(officeHoldRoute, office.accessToken, "POST", { reason: "Wrong photo" }, { id });
    expect(back.status).toBe(200);
    const mine = await call(getRoute, tech.accessToken, "GET", undefined, { id });
    expect(mine.json.data).toMatchObject({ status: "ON_HOLD", holdReason: "Wrong photo" });
    expect(mine.json.data.holdBy).toBeTruthy();

    // A technician cannot use the office endpoint, and the office cannot use the technician's.
    expect((await call(officeHoldRoute, tech.accessToken, "POST", { reason: "x" }, { id })).status).toBe(403);
    expect((await call(holdNewRoute, office.accessToken, "POST", heldBody())).status).toBe(403);

    // Discard the held record.
    expect((await call(discardRoute, tech.accessToken, "DELETE", undefined, { id })).status).toBe(200);
  });

  it("refuses a bad token", async () => {
    const res = await getRoute(
      new NextRequest("http://localhost/api/v1/field/installations/x", {
        headers: { authorization: "Bearer not-a-token" },
      }),
      {
        params: Promise.resolve({ id: "x" }),
      },
    );
    expect(res.status).toBe(401);
  });
});

describe("CORS for the app", () => {
  it("allows the app's origins and nothing else", () => {
    expect(corsHeaders("https://localhost")["Access-Control-Allow-Origin"]).toBe("https://localhost");
    expect(corsHeaders("http://localhost:5173")["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
    expect(corsHeaders("https://evil.example")).toEqual({});
    expect(corsHeaders(null)).toEqual({});
  });

  it("never allows cookies cross-origin and allows an extra origin from the environment", () => {
    expect(corsHeaders("https://localhost")["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(corsHeaders("https://app.example", ["https://app.example"])["Access-Control-Allow-Origin"]).toBe(
      "https://app.example",
    );
  });
});

describe("office endpoints the app uses", () => {
  it("lists maintenance plans for an Admin and refuses a Dispatcher", async () => {
    const admin = await authService.loginForTokens("admin@demo.local", password, "127.0.0.1");
    const dispatcher = await authService.loginForTokens("dispatcher@demo.local", password, "127.0.0.1");
    const asAdmin = await call(listPlansRoute, admin.accessToken, "GET");
    expect(asAdmin.status).toBe(200);
    expect(Array.isArray(asAdmin.json.data)).toBe(true);
    expect((await call(listPlansRoute, dispatcher.accessToken, "GET")).status).toBe(403);
  });
});

describe("admin endpoints the app uses", () => {
  it("serves the dashboard to office users and the role list only to an Admin", async () => {
    const admin = await authService.loginForTokens("admin@demo.local", password, "127.0.0.1");
    const dispatcher = await authService.loginForTokens("dispatcher@demo.local", password, "127.0.0.1");
    const tech = await authService.loginForTokens("tech1@demo.local", password, "127.0.0.1");

    const board = await call(dashboardRoute, dispatcher.accessToken, "GET");
    expect(board.status).toBe(200);
    expect(board.json.data).toMatchObject({ openWorkOrders: expect.any(Number), completedPerDay: expect.any(Array) });
    expect((await call(dashboardRoute, tech.accessToken, "GET")).status).toBe(403);

    const roles = await call(listRolesRoute, admin.accessToken, "GET");
    expect(roles.status).toBe(200);
    expect(Array.isArray(roles.json.data)).toBe(true);
    expect((await call(listRolesRoute, dispatcher.accessToken, "GET")).status).toBe(403);
  });
});
