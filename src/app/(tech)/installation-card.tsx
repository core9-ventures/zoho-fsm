import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatDay } from "@/lib/format";
import type { InstallationListItem } from "@/modules/installations";

/** One installation as a tappable card (vehicle, company, device, date, a few photo previews). */
export function InstallationCard({ i }: { i: InstallationListItem }) {
  return (
    <Link
      href={`/my-installations/${i.id}`}
      className="hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-3"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{i.vehicleNo}</p>
        <p className="text-muted-foreground truncate text-sm">
          {i.customerName} · {i.deviceType}
        </p>
        <p className="text-muted-foreground text-xs">
          {formatDay(i.installDate)} · {i.deviceId}
        </p>
      </div>
      <div className="flex shrink-0 -space-x-2">
        {i.thumbs.slice(0, 3).map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={t}
            src={`/api/v1/attachments/${t}?inline=1&thumb=1`}
            alt=""
            className="border-background size-10 rounded-md border-2 object-cover"
          />
        ))}
      </div>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </Link>
  );
}
