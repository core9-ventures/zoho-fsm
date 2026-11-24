import { NavLink, Outlet } from "react-router-dom";
import { Header } from "./Header";
import { LocationSharing } from "./LocationSharing";
import { TECH_TABS } from "../nav";

/** Technician shell: header (with the always-on location pin) on top, three tabs at the bottom. */
export function TechLayout() {
  return (
    <div className="flex h-full flex-col">
      <Header trailing={<LocationSharing />} />
      <main className="flex-1 overflow-y-auto p-4">
        <Outlet />
      </main>
      <nav
        className="bg-card grid grid-cols-3 border-t"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Main"
      >
        {TECH_TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-2 text-xs font-medium ${
                isActive ? "text-foreground" : "text-muted-foreground"
              }`
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
