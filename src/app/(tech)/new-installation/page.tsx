import type { Metadata } from "next";
import { NewInstallationForm } from "./new-installation-form";
import { dbFor, requirePermission, requireRole, requireUser } from "@/lib/auth";
import { installationsService } from "@/modules/installations";

export const metadata: Metadata = { title: "New installation" };

/** New car installation form: saves the record and its photos for the signed-in technician. */
export default async function NewInstallationPage() {
  const user = await requireUser();
  requireRole(user, ["TECHNICIAN"]);
  requirePermission(user, "field:create");
  const customers = await installationsService.customerOptions(dbFor(user));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New installation</h1>
        <p className="text-muted-foreground text-sm">Record a device installed on a new vehicle.</p>
      </div>
      <NewInstallationForm customers={customers} />
    </div>
  );
}
