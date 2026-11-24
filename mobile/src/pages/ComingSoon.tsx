import { useLocation } from "react-router-dom";
import { OFFICE_MENU, TECH_TABS } from "../nav";

/** Stands in for every screen until its phase builds it. */
export function ComingSoon() {
  const { pathname } = useLocation();
  const item = [...TECH_TABS, ...OFFICE_MENU].find((n) => pathname.startsWith(n.to));
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold tracking-tight">{item?.label ?? "FieldServe"}</h1>
      <p className="text-muted-foreground text-sm">
        {item ? `This screen is built in Phase ${item.phase} of the mobile app.` : "This screen is not built yet."}
      </p>
    </div>
  );
}
