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

/** Straight-line distance between two points, in kilometres. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (x: number) => (x * Math.PI) / 180;
  const h =
    Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

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

  const fillAway =
    i.fill && i.latitude != null && i.longitude != null
      ? distanceKm(i.fill.lat, i.fill.lng, i.latitude, i.longitude)
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
        <h1 className="text-2xl font-semibold tracking-tight">
          {i.vehicleNo || "(no vehicle no.)"}
          {i.status === "ON_HOLD" && (
            <span className="ml-3 rounded-md border border-amber-500/60 px-2 py-0.5 align-middle text-sm font-normal text-amber-600">
              On hold
            </span>
          )}
        </h1>
        {i.status === "ON_HOLD" && i.holdReason && (
          <p className="text-sm text-amber-600">On hold because: {i.holdReason}</p>
        )}
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
      {i.fill && (
        <p className="text-muted-foreground text-sm">
          Filled in at {i.fill.lat.toFixed(5)}, {i.fill.lng.toFixed(5)}
          {i.fill.accuracy != null ? ` (within ${i.fill.accuracy} m)` : ""} on {new Date(i.fill.at).toLocaleString()}
          {fillAway != null && (
            <>
              {" · "}
              <span className={fillAway > 1 ? "font-medium text-amber-600" : "text-emerald-600"}>
                {fillAway < 0.1 ? "at the install location" : `${fillAway.toFixed(1)} km from the install location`}
              </span>
            </>
          )}
          {" · "}
          <a href={`https://www.openstreetmap.org/?mlat=${i.fill.lat}&mlon=${i.fill.lng}#map=17/${i.fill.lat}/${i.fill.lng}`} target="_blank" rel="noreferrer" className="text-primary underline">
            View where
          </a>
        </p>
      )}
      <InstallationEditor installation={i} customers={customers} />
    </div>
  );
}
