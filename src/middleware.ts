import NextAuth from "next-auth";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { authConfig } from "./auth.config";
import { corsHeaders } from "./lib/cors";

/** Page guard: signed-in check + role-based routing (see authConfig.callbacks.authorized). */
const authMiddleware = NextAuth(authConfig).auth;

const pageMiddleware = authMiddleware((request) => {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

/**
 * /api/v1 only gets CORS headers here (the mobile app calls it from another origin); the routes authenticate
 * themselves with a session cookie or a bearer token. Everything else goes through the page guard.
 */
export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname.startsWith("/api/v1")) {
    const headers = corsHeaders(request.headers.get("origin"));
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
  // The NextAuth wrapper's own types are looser than a plain middleware; the call is the same.
  return (pageMiddleware as unknown as (r: NextRequest, e: NextFetchEvent) => Promise<Response>)(request, event);
}

export const config = {
  matcher: [
    "/api/v1/:path*",
    // Pages: API routes authenticate themselves (session cookie or bearer token).
    "/((?!api|_next/static|_next/image|favicon.ico|sw.js|sw-reset.html|offline.html|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|webmanifest)$).*)",
  ],
};
