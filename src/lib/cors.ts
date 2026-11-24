/**
 * CORS for the mobile app. The Android app runs from its own origin (https://localhost inside the WebView),
 * so the browser engine asks the server whether that origin may call /api/v1. Only listed origins are allowed,
 * and cookies are never allowed cross-origin: the app signs in with bearer tokens.
 *
 * Plain functions with no Node imports, so the middleware (edge runtime) and the tests can both use them.
 */

/** Origins of the Capacitor Android app and of the local preview (Vite). */
const DEFAULT_ORIGINS = ["https://localhost", "http://localhost", "capacitor://localhost", "http://localhost:5173"];

export function allowedOrigins(env: string | undefined = process.env.CORS_ALLOWED_ORIGINS): string[] {
  const extra = (env ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}

/** The headers to add for a request from `origin`; empty when the origin is not allowed (or is not a browser call). */
export function corsHeaders(origin: string | null, allowed: string[] = allowedOrigins()): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Request-Id,Idempotency-Key",
    "Access-Control-Expose-Headers": "X-Request-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
