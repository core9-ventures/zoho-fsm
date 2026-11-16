/**
 * Background worker (pg-boss: its queue lives in PostgreSQL, schema "pgboss"). Run next to the web app:
 *   pnpm worker
 *
 * Schedules
 *   tick              every hour             → for each company whose local clock reads 06:00, queue its daily run
 *   company-daily     once per company/day   → create due maintenance work orders, overdue scan, invoice reminders
 *   location-cleanup  every night 02:30 UTC  → delete GPS points older than 30 days
 *   email             on demand              → send a queued email through SMTP (retries 3 times)
 * Every job is safe to run again: maintenance claims each due date once, reminders and alerts are not repeated.
 */
import "dotenv/config";
import PgBoss from "pg-boss";
import { sendMail } from "@/lib/mailer";
import { logger } from "@/lib/logger";
import { companiesDueNow, locationCleanup, runCompanyDaily, type EmailJob } from "@/modules/automation";

const QUEUES = ["tick", "company-daily", "location-cleanup", "email"] as const;

/** pg-boss needs rights to create its own schema, so it uses the owner connection unless told otherwise. */
function connectionString() {
  const raw = process.env.WORKER_DATABASE_URL ?? process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("Set DIRECT_DATABASE_URL (or WORKER_DATABASE_URL) for the worker.");
  const url = new URL(raw);
  url.search = ""; // Prisma's ?schema=public is not a pg option
  return url.toString();
}

async function main() {
  const boss = new PgBoss(connectionString());
  boss.on("error", (err) => logger.error({ err }, "worker.error"));
  await boss.start();
  for (const name of QUEUES) await boss.createQueue(name);

  const enqueueEmail = async (mail: EmailJob) => {
    await boss.send("email", mail, { retryLimit: 3, retryDelay: 60, retryBackoff: true });
  };

  await boss.work("email", async ([job]) => {
    await sendMail(job.data as EmailJob);
    logger.info({ to: (job.data as EmailJob).to }, "worker.email_sent");
  });

  await boss.work("company-daily", async ([job]) => {
    await runCompanyDaily((job.data as { companyId: string }).companyId, enqueueEmail);
  });

  await boss.work("tick", async () => {
    for (const { companyId, day } of await companiesDueNow()) {
      // singletonKey: the same company and day can only be queued once, however often this runs.
      await boss.send("company-daily", { companyId, day }, { singletonKey: `${companyId}:${day}`, retryLimit: 2 });
    }
  });

  await boss.work("location-cleanup", async () => {
    await locationCleanup();
  });

  await boss.schedule("tick", "0 * * * *");
  await boss.schedule("location-cleanup", "30 2 * * *");
  logger.info("worker.started");

  const stop = async () => {
    logger.info("worker.stopping");
    await boss.stop({ graceful: true, timeout: 20_000 });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  logger.error({ err }, "worker.failed");
  process.exit(1);
});
