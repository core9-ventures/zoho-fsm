/**
 * First-run setup for a real (non-demo) deployment: creates the platform Super Admin when none exists.
 * Safe to run on every start: it does nothing once a Super Admin exists, or when the variables are not set.
 *
 *   BOOTSTRAP_ADMIN_EMAIL      e.g. owner@yourcompany.com
 *   BOOTSTRAP_ADMIN_PASSWORD   at least 12 characters
 *   BOOTSTRAP_ADMIN_NAME       optional, default "Platform Owner"
 *
 * Runs as the database OWNER (DIRECT_DATABASE_URL), like the seed. The Super Admin then signs in and
 * creates each company (with its first Admin) from the Companies screen.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("bootstrap: BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD not set, skipped.");
    return;
  }
  if ((await prisma.user.count({ where: { role: "SUPER_ADMIN", deletedAt: null } })) > 0) {
    console.log("bootstrap: a Super Admin already exists, skipped.");
    return;
  }
  if (password.length < 12) throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.");

  await prisma.user.create({
    data: {
      fullName: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Platform Owner",
      email,
      passwordHash: await bcrypt.hash(password, 11),
      role: "SUPER_ADMIN",
    },
  });
  console.log(`bootstrap: Super Admin ${email} created.`);
}

main()
  .catch((err) => {
    console.error("bootstrap failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
