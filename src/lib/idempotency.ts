import "server-only";
import { Prisma } from "@prisma/client";
import { prismaBase } from "./db";

/**
 * Idempotency-Key support for write calls. The phone sends the same key every time it retries one queued change, so
 * a change whose answer was lost on the way (the phone lost signal after the server had already saved it) is never
 * applied twice: the second call gets the first call's answer back.
 *
 * Keys are kept per user for a week in the `IdempotencyKey` table (PostgreSQL).
 */

const IN_PROGRESS = 0;
/** A call still marked "in progress" after this long is taken as crashed and may be run again. */
const STALE_MS = 2 * 60_000;
const KEEP_MS = 7 * 24 * 3600_000;

export type StoredAnswer = { status: number; body: string };

export type Begin =
  | { kind: "run" }
  | { kind: "replay"; answer: StoredAnswer }
  | { kind: "busy" }
  | { kind: "mismatch" };

export const idempotency = {
  /** Claims the key. `run`: nobody has used it, go ahead. `replay`: it was used and finished, send this answer. */
  async begin(userId: string, key: string, method: string, path: string): Promise<Begin> {
    try {
      await prismaBase.idempotencyKey.create({ data: { userId, key, method, path, status: IN_PROGRESS } });
      if (Math.random() < 0.02) {
        void prismaBase.idempotencyKey
          .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } })
          .catch(() => undefined);
      }
      return { kind: "run" };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
    }
    const row = await prismaBase.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    if (!row) return this.begin(userId, key, method, path);
    if (row.method !== method || row.path !== path) return { kind: "mismatch" };
    if (row.status !== IN_PROGRESS) return { kind: "replay", answer: { status: row.status, body: row.body ?? "" } };
    if (Date.now() - row.createdAt.getTime() > STALE_MS) {
      // Take over a call that never finished (only one caller wins the update).
      const taken = await prismaBase.idempotencyKey.updateMany({
        where: { id: row.id, status: IN_PROGRESS, createdAt: row.createdAt },
        data: { createdAt: new Date() },
      });
      return taken.count === 1 ? { kind: "run" } : { kind: "busy" };
    }
    return { kind: "busy" };
  },

  /** Remembers the answer so a retry gets the same one. */
  async finish(userId: string, key: string, answer: StoredAnswer) {
    await prismaBase.idempotencyKey.update({
      where: { userId_key: { userId, key } },
      data: { status: answer.status, body: answer.body },
    });
  },

  /** The call failed in a way worth retrying (server error): free the key so the retry runs again. */
  async release(userId: string, key: string) {
    await prismaBase.idempotencyKey.deleteMany({ where: { userId, key, status: IN_PROGRESS } });
  },
};
