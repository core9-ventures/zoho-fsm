/** The FieldServe server the app talks to. Set VITE_API_BASE_URL when building (see .env.example). */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3100").replace(/\/+$/, "");

/** Requests that give up after this long (a stuck connection must not hang a screen). */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Photos and videos take longer on a slow connection. */
export const UPLOAD_TIMEOUT_MS = 180_000;
