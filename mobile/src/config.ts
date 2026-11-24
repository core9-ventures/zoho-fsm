const KEY = "fs.apiBase";

/** The server address built into the app (set VITE_API_BASE_URL when building, see .env.example). */
const BUILT_IN = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3100").replace(/\/+$/, "");

/**
 * The FieldServe server the app talks to. A server chosen on the sign-in screen ("Change server") wins over the
 * built-in one, so a single APK works with a PC on the same Wi-Fi or with the live server.
 */
export function apiBaseUrl(): string {
  try {
    return localStorage.getItem(KEY) || BUILT_IN;
  } catch {
    return BUILT_IN;
  }
}

/** Saves a server address ("" goes back to the built-in one). Returns an error message when the address is not usable. */
export function setApiBaseUrl(value: string): string | null {
  const text = value.trim().replace(/\/+$/, "");
  try {
    if (text === "") {
      localStorage.removeItem(KEY);
      return null;
    }
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "The address must start with http:// or https://";
    localStorage.setItem(KEY, `${url.protocol}//${url.host}`);
    return null;
  } catch {
    return "That is not a valid address. Example: https://fieldserve.example.com";
  }
}

export const isBuiltInServer = () => apiBaseUrl() === BUILT_IN;
export const builtInServer = () => BUILT_IN;

/** Requests that give up after this long (a stuck connection must not hang a screen). */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Photos and videos take longer on a slow connection. */
export const UPLOAD_TIMEOUT_MS = 180_000;
