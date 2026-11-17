import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { InstallationEditor } from "./installation-editor";
import { dbFor, requirePagePermission, requireRole, requireUser } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { installationsService, type CustomerChoice, type InstallationDetail } from "@/modules/installations";

export const metadata: Metadata = { title: "Installation" };

export default async function InstallationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  requireRole(user, ["ADMIN", "DISPATCHER"]);
  requirePagePermission(user, "/installations");
  const db = dbFor(user);
  let i: InstallationDetail;
  let customers: CustomerChoice[];
  try {
    [i, customers] = await Promise.all([
      installationsService.get(db, user, id),
      installationsService.customerOptions(db),
    ]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const map =
    i.latitude != null && i.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${i.latitude}&mlon=${i.longitude}#map=17/${i.latitude}/${i.longitude}`
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/installations"
        className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-4" /> Installations
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{i.vehicleNo}</h1>
        <p className="text-muted-foreground text-sm">
          {i.customerName} · {formatDay(i.installDate)}
          {i.createdBy ? ` · recorded by ${i.createdBy}` : ""}
          {map && (
            <>
              {" · "}
              <a href={map} target="_blank" rel="noreferrer" className="text-primary underline">
                View on map
              </a>
            </>
          )}
        </p>
      </div>
      <InstallationEditor installation={i} customers={customers} />
    </div>
  );
}
