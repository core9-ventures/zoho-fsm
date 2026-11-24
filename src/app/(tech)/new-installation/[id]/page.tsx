import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NewInstallationForm } from "../new-installation-form";
import { dbFor, requirePermission, requireRole, requireUser } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { installationsService, type InstallationDetail } from "@/modules/installations";

export const metadata: Metadata = { title: "Continue installation" };

/** Carry on with an installation that was put on hold. */
export default async function ContinueInstallationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  requireRole(user, ["TECHNICIAN"]);
  requirePermission(user, "field:create");
  const db = dbFor(user);
  let held: InstallationDetail;
  try {
    held = await installationsService.get(db, user, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  // A finished record is only read, never edited by the technician.
  if (held.status !== "ON_HOLD") redirect(`/my-installations/${id}`);
  const customers = await installationsService.customerOptions(db);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Continue installation</h1>
        <p className="text-muted-foreground text-sm">
          This record is on hold. Finish it and press Add Record, or put it on hold again.
        </p>
        {held.holdBy && held.holdReason && (
          <p className="mt-2 rounded-md border border-amber-500/60 px-3 py-2 text-sm text-amber-600">
            Put on hold by {held.holdBy}: {held.holdReason}
          </p>
        )}
      </div>
      <NewInstallationForm customers={customers} held={held} />
    </div>
  );
}
