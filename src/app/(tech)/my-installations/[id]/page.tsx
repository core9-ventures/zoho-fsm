import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ReadOnlyPhotos } from "./read-only-photos";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dbFor, requirePermission, requireRole, requireUser } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { installationsService, type InstallationDetail } from "@/modules/installations";

export const metadata: Metadata = { title: "Installation" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children || "—"}</dd>
    </div>
  );
}

export default async function MyInstallationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  requireRole(user, ["TECHNICIAN"]);
  requirePermission(user, "field:view");
  let i: InstallationDetail;
  try {
    i = await installationsService.get(dbFor(user), user, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  // Unfinished records are finished on the form, not read here.
  if (i.status === "ON_HOLD") redirect(`/new-installation/${id}`);
  const map =
    i.latitude != null && i.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${i.latitude}&mlon=${i.longitude}#map=17/${i.latitude}/${i.longitude}`
      : null;

  return (
    <div className="space-y-4">
      <Link href="/my-jobs" className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="size-4" /> My jobs
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{i.vehicleNo}</h1>
        <p className="text-muted-foreground text-sm">
          {i.customerName} · {formatDay(i.installDate)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4">
            <Row label="Device ID">{i.deviceId}</Row>
            <Row label="Device type">{i.deviceType}</Row>
            <Row label="SIM no.">{i.simNo}</Row>
            <Row label="Location">
              {i.location}
              {map && (
                <>
                  {" "}
                  <a href={map} target="_blank" rel="noreferrer" className="text-primary underline">
                    Map
                  </a>
                </>
              )}
            </Row>
          </dl>
          {i.notes && <p className="mt-4 text-sm whitespace-pre-wrap">{i.notes}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service checklist</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {i.checklist.length === 0 && <span className="text-muted-foreground text-sm">Nothing ticked.</span>}
          {i.checklist.map((c) => (
            <Badge key={c} variant="secondary">
              {c}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <ReadOnlyPhotos files={i.files} photos={i.photos} />
    </div>
  );
}
