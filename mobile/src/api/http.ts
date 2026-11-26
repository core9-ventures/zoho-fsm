import { apiBaseUrl, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from "../config";
import { wipeLocalData } from "../local/db";
import { clearTokens, readTokens, saveTokens, type Tokens } from "./tokens";

/** The server's response envelope. */
type Envelope<T> = { success: boolean; message?: string; data?: T; errors?: Record<string, string[]> };

/** A failed call. status 0 means the server could not be reached at all. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Per-field messages from the server (keys are field names such as "simNo"). */
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isNetwork() {
    return this.status === 0;
  }
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// ---- Losing the session (refresh failed): the app listens and returns to the sign-in screen. ----
const lostListeners = new Set<() => void>();
export const onSessionLost = (fn: () => void) => {
  lostListeners.add(fn);
  return () => {
    lostListeners.delete(fn);
  };
};
const sessionLost = () => {
  clearTokens();
  try {
    localStorage.removeItem("fs.user");
  } catch {
    /* ignore */
  }
  void wipeLocalData();
  lostListeners.forEach((fn) => fn());
};

type Options = {
  query?: Record<string, string | number | boolean | undefined>;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as multipart (photos and videos). */
  form?: FormData;
  /** Calls such as sign-in send no token. */
  auth?: boolean;
  /** Overrides the default give-up time. */
  timeoutMs?: number;
};

function urlFor(path: string, query?: Options["query"]) {
  const url = new URL(`${apiBaseUrl()}/api/v1${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
}

async function send(method: string, path: string, opts: Options, accessToken: string | null) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? (opts.form ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
  );
  const headers: Record<string, string> = { Accept: "application/json", "X-Request-Id": newId() };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    return await fetch(urlFor(path, opts.query), {
      method,
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: controller.signal,
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(
      timedOut
        ? "The server took too long to answer. Check your connection and try again."
        : "Could not reach the server. Check your connection and try again.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---- Refreshing the access token. Many calls can hit 401 together: only one refresh runs. ----
let refreshing: Promise<Tokens | null> | null = null;

async function refreshTokens(): Promise<Tokens | null> {
  const current = readTokens();
  if (!current) return null;
  refreshing ??= (async () => {
    try {
      const res = await send("POST", "/auth/refresh", { body: { refreshToken: current.refreshToken } }, null);
      const json = (await res.json().catch(() => null)) as Envelope<Tokens> | null;
      if (!res.ok || !json?.success || !json.data) return null;
      saveTokens(json.data);
      return json.data;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !json || json.success === false) {
    throw new ApiError(json?.message ?? `The server answered with an error (${res.status}).`, res.status, json?.errors);
  }
  return json.data as T;
}

/** Sends the call; when the access token has expired it is refreshed once and the call repeated. */
async function execute(method: string, path: string, opts: Options): Promise<Response> {
  const useAuth = opts.auth !== false;
  const tokens = useAuth ? readTokens() : null;
  if (useAuth && !tokens) {
    sessionLost();
    throw new ApiError("Please sign in.", 401);
  }
  let res = await send(method, path, opts, tokens?.accessToken ?? null);
  if (res.status === 401 && useAuth) {
    const fresh = await refreshTokens();
    if (!fresh) {
      sessionLost();
      throw new ApiError("Your session ended. Please sign in again.", 401);
    }
    res = await send(method, path, opts, fresh.accessToken);
  }
  return res;
}

/** One call to the FieldServe API. Returns the `data` of the envelope, or throws an ApiError. */
export async function request<T>(method: string, path: string, opts: Options = {}): Promise<T> {
  return parse<T>(await execute(method, path, opts));
}

/** A file (photo thumbnail, photo, video) as a Blob: an <img> tag cannot send the sign-in header, so the app fetches it. */
export async function requestBlob(path: string, query?: Options["query"]): Promise<Blob> {
  const res = await execute("GET", path, { query });
  if (!res.ok) throw new ApiError(`Could not load the file (${res.status}).`, res.status);
  return res.blob();
}

export const http = {
  get: <T>(path: string, query?: Options["query"]) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown, opts: Options = {}) => request<T>("POST", path, { ...opts, body }),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
};
