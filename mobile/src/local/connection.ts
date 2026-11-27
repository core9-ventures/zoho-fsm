import { apiBaseUrl } from "../config";

/**
 * Is the server reachable right now? The phone's own "online" flag is not enough: Wi-Fi without internet and a very
 * weak signal both look "online". So the answer combines three things: the phone's online/offline events, what
 * every call to the server just did (an answer means reachable, a network error means not), and — while offline —
 * a small check every 20 seconds, so the app notices the signal coming back and syncs by itself.
 */

type Listener = () => void;

let online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
const listeners = new Set<Listener>();
const backListeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;

const PROBE_EVERY_MS = 20_000;
const PROBE_TIMEOUT_MS = 6_000;

function set(next: boolean) {
  if (next === online) return;
  online = next;
  listeners.forEach((fn) => fn());
  if (next) {
    stopProbing();
    backListeners.forEach((fn) => fn());
  } else startProbing();
}

/** Called by the HTTP client after each call: any answer from the server proves it is reachable. */
export function reportOutcome(reached: boolean) {
  set(reached);
}

async function probe() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${apiBaseUrl()}/api/v1/health`, { signal: controller.signal, cache: "no-store" });
    set(true);
  } catch {
    /* still offline */
  } finally {
    clearTimeout(t);
  }
}

function startProbing() {
  if (timer || typeof window === "undefined") return;
  timer = setInterval(() => void probe(), PROBE_EVERY_MS);
}

function stopProbing() {
  if (timer) clearInterval(timer);
  timer = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => set(false));
  window.addEventListener("online", () => {
    // The phone says it has a network: confirm with the server before trusting it.
    void probe();
  });
  if (!online) startProbing();
}

export const connection = {
  get: () => online,
  subscribe: (fn: Listener) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** Runs `fn` each time the server becomes reachable again (used to sync by itself). */
  onBack: (fn: Listener) => {
    backListeners.add(fn);
    return () => {
      backListeners.delete(fn);
    };
  },
  /** Checks now (for the "Sync" button). */
  check: probe,
};
