import { ApiError } from "../api/http";

/** With a saved copy on the phone, a server that has not answered after this long is treated as "no signal". */
export const SLOW_SERVER_MS = 6_000;

/**
 * Reads from the server and keeps the answer on the phone. When the server cannot be reached at all (no signal,
 * timeout) the last saved answer is returned instead. A real answer from the server, such as "not found" or "not
 * allowed", is never replaced by old data.
 *
 * On a very weak signal the server may take half a minute to fail. When the phone already has the data, it is shown
 * after `slowMs` instead of making the technician wait; the server call carries on in the background and, if it
 * does answer, its newer answer is saved for the next time.
 */
export async function readThrough<T>(
  fromServer: () => Promise<T>,
  save: (value: T) => Promise<void>,
  fromPhone: () => Promise<T | null>,
  slowMs = SLOW_SERVER_MS,
): Promise<T> {
  const server = fromServer().then(async (value) => {
    await save(value);
    return value;
  });
  const SLOW = Symbol("slow");
  const timer = new Promise<typeof SLOW>((resolve) => setTimeout(() => resolve(SLOW), slowMs));
  try {
    const first = await Promise.race([server, timer]);
    if (first !== SLOW) return first;
    const saved = await fromPhone();
    if (saved !== null) {
      server.catch(() => undefined); // its failure no longer matters; a late answer is saved by the `then` above
      return saved;
    }
    return await server;
  } catch (e) {
    if (e instanceof ApiError && e.isNetwork) {
      const saved = await fromPhone();
      if (saved !== null) return saved;
    }
    throw e;
  }
}
