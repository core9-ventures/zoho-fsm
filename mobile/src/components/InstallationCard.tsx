import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { InstallationListItem } from "../api";
import { formatDay } from "../lib/format";
import { Badge } from "../ui/kit";
import { AuthImage } from "./AuthImage";

/** One installation as a tappable card. A held one opens the form again so the technician can carry on. */
export function InstallationCard({ i }: { i: InstallationListItem }) {
  const held = i.status === "ON_HOLD";
  return (
    <Link
      to={held ? `/new-installation/${i.id}` : `/my-installations/${i.id}`}
      className="bg-card active:bg-muted/50 flex items-center gap-3 rounded-lg border p-3"
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          {i.vehicleNo || <span className="text-muted-foreground italic">No vehicle no. yet</span>}
          {held && <Badge tone="amber">On hold</Badge>}
        </p>
        <p className="text-muted-foreground truncate text-sm">
          {[i.customerName, i.deviceType].filter(Boolean).join(" · ") || "Not filled in yet"}
        </p>
        <p className="text-muted-foreground text-xs">{[formatDay(i.installDate), i.deviceId].filter(Boolean).join(" · ")}</p>
        {held && i.holdReason && (
          <p className="truncate text-xs text-amber-600 dark:text-amber-400">
            {i.holdBy ? `Put on hold by ${i.holdBy}: ` : "Reason: "}
            {i.holdReason}
          </p>
        )}
      </div>
      <div className="flex shrink-0 -space-x-2">
        {i.thumbs.slice(0, 3).map((t) => (
          <AuthImage key={t} id={t} className="border-background size-10 rounded-md border-2 object-cover" />
        ))}
      </div>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </Link>
  );
}
