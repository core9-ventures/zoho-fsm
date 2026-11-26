import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { dbFor, requirePermission, requireRole, requireUser, type CurrentUser } from "./auth";
import type { AppDb } from "./db";
import { AppError, type FieldErrors } from "./errors";
import { idempotency } from "./idempotency";
import { logger } from "./logger";
import { clientIp, rateLimit } from "./rate-limit";
import type { AppRole } from "./roles";
import { permissionForApi } from "./permissions";

/** Standard response envelope: { success, message, data, errors }. */
export type ApiEnvelope<T> = { success: boolean; message?: string; data?: T; errors?: FieldErrors };

export const ok = <T>(data: T, message?: string, status = 200) =>
  NextResponse.json<ApiEnvelope<T>>({ success: true, message, data }, { status });

export const fail = (status: number, message: string, errors?: FieldErrors) =>
  NextResponse.json<ApiEnvelope<never>>({ success: false, message, errors }, { status });

type RouteParams = { params: Promise<Record<string, string | string[]>> };

type Options<TBody, TQuery> = {
  /** Default: any signed-in user. */
  roles?: readonly AppRole[];
  body?: z.ZodType<TBody, z.ZodTypeDef, unknown>;
  query?: z.ZodType<TQuery, z.ZodTypeDef, unknown>;
  /** Requests per minute per client IP. */
  rateLimitPerMinute?: number;
};

type BaseCtx<TBody, TQuery> = {
  req: NextRequest;
  params: Record<string, string>;
  body: TBody;
  query: TQuery;
  requestId: string;
  ip: string;
};

export type AuthedCtx<TBody, TQuery> = BaseCtx<TBody, TQuery> & { user: CurrentUser; db: AppDb };

type Result = unknown;

/**
 * Wraps a route handler: auth + role check, zod parsing of body/query, rate limit, logging and
 * error → JSON mapping. The handler returns data (wrapped as { success: true, data }) or a Response.
 */
export function route<TBody = undefined, TQuery = undefined>(
  opts: Options<TBody, TQuery>,
  handler: (ctx: AuthedCtx<TBody, TQuery>) => Promise<Result>,
) {
  return wrap<TBody, TQuery>(opts, async (base) => {
    const user = await requireUser(base.req.headers);
    if (opts.roles) requireRole(user, opts.roles);
    requirePermission(user, permissionForApi(base.req.nextUrl.pathname, base.req.method));
    const run = () => handler({ ...base, user, db: dbFor(user) });
    return withIdempotency(base.req, user.id, run);
  });
}

/**
 * A write call with an `Idempotency-Key` header runs once: a repeat with the same key gets the first answer back
 * (marked `Idempotent-Replay: true`) instead of changing anything again. Calls without the header run as usual.
 */
async function withIdempotency(req: NextRequest, userId: string, run: () => Promise<Result>): Promise<Result> {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key || req.method === "GET" || req.method === "HEAD") return run();
  if (key.length > 100) throw new AppError("Idempotency-Key is too long.", 400, "BAD_IDEMPOTENCY_KEY");

  const begin = await idempotency.begin(userId, key, req.method, req.nextUrl.pathname);
  if (begin.kind === "replay") {
    const res = new NextResponse(begin.answer.body, {
      status: begin.answer.status,
      headers: { "content-type": "application/json", "idempotent-replay": "true" },
    });
    return res;
  }
  if (begin.kind === "busy") throw new AppError("This change is still being saved. Try again in a moment.", 409, "IDEMPOTENCY_BUSY");
  if (begin.kind === "mismatch") throw new AppError("This Idempotency-Key was used for a different call.", 422, "IDEMPOTENCY_MISMATCH");

  let response: Response;
  try {
    const result = await run();
    response = result instanceof Response ? result : ok(result);
  } catch (err) {
    response = toErrorResponse(err);
  }
  if (response.status >= 500) {
    await idempotency.release(userId, key).catch(() => undefined);
    return response;
  }
  const body = await response.clone().text();
  await idempotency.finish(userId, key, { status: response.status, body });
  return response;
}

/** Same as `route` but without authentication (login, token refresh, health). */
export function publicRoute<TBody = undefined, TQuery = undefined>(
  opts: Omit<Options<TBody, TQuery>, "roles">,
  handler: (ctx: BaseCtx<TBody, TQuery>) => Promise<Result>,
) {
  return wrap<TBody, TQuery>(opts, handler);
}

function wrap<TBody, TQuery>(opts: Options<TBody, TQuery>, run: (ctx: BaseCtx<TBody, TQuery>) => Promise<Result>) {
  return async (req: NextRequest, routeParams: RouteParams) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const ip = clientIp(req.headers);
    const started = Date.now();
    const log = logger.child({ requestId, method: req.method, path: req.nextUrl.pathname });

    let response: Response;
    try {
      if (opts.rateLimitPerMinute) {
        rateLimit({ key: `${req.nextUrl.pathname}:${ip}`, limit: opts.rateLimitPerMinute, windowMs: 60_000 });
      }

      const rawParams = (await routeParams?.params) ?? {};
      const params = Object.fromEntries(
        Object.entries(rawParams).map(([k, v]) => [k, Array.isArray(v) ? v.join("/") : v]),
      );

      const body = opts.body ? opts.body.parse(await readJson(req)) : (undefined as TBody);
      const query = opts.query
        ? opts.query.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))
        : (undefined as TQuery);

      const result = await run({ req, params, body, query, requestId, ip });
      response = result instanceof Response ? result : ok(result);
    } catch (err) {
      response = toErrorResponse(err, log);
    }

    response.headers.set("x-request-id", requestId);
    log.info({ status: response.status, ms: Date.now() - started }, "request");
    return response;
  };
}

async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("Request body is not valid JSON.", 400, "BAD_JSON");
  }
}

export function toErrorResponse(err: unknown, log = logger): Response {
  if (err instanceof ZodError) {
    const errors: FieldErrors = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      (errors[key] ??= []).push(issue.message);
    }
    return fail(400, "Validation failed.", errors);
  }
  if (err instanceof AppError) {
    if (err.status >= 500) log.error({ err }, err.message);
    else log.warn({ code: err.code }, err.message);
    return fail(err.status, err.message, err.errors);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return fail(409, "A record with these values already exists.");
    if (err.code === "P2025") return fail(404, "Record was not found.");
  }
  log.error({ err }, "unhandled_error");
  return fail(
    500,
    process.env.NODE_ENV === "production" ? "An unexpected error occurred." : String((err as Error)?.message ?? err),
  );
}
