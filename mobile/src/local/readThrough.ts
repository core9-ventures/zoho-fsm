import { ApiError } from "../api/http";

/**
 * Reads from the server and keeps the answer on the phone. When the server cannot be reached at all (no signal,
 * timeout) the last saved answer is returned instead. A real answer from the server, such as "not found" or "not
 * allowed", is never replaced by old data.
 */
export async function readThrough<T>(
  fromServer: () => Promise<T>,
  save: (value: T) => Promise<void>,
  fromPhone: () => Promise<T | null>,
): Promise<T> {
  try {
    const value = await fromServer();
    await save(value);
    return value;
  } catch (e) {
    if (e instanceof ApiError && e.isNetwork) {
      const saved = await fromPhone();
      if (saved !== null) return saved;
    }
    throw e;
  }
}
