import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Header } from "./Header";
import { OFFICE_MENU } from "../nav";
import { useSession } from "../session";

/** Office shell: header with a menu button that opens the list of screens. */
export function OfficeLayout() {
  const [open, setOpen] = useState(false);
  const { user } = useSession();
  const menu = OFFICE_MENU.filter((m) => !m.adminOnly || user?.role === "ADMIN");
  return (
    <div className="flex h-full flex-col">
      <Header
        leading={
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="hover:bg-accent -ml-2 rounded-md p-2"
          >
            <Menu className="size-5" />
          </button>
        }
      />
      <main className="flex-1 overflow-y-auto p-4">
        <Outlet />
      </main>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="bg-card flex w-72 max-w-[80%] flex-col border-r shadow-lg">
            <div
              className="flex items-center justify-between border-b p-4"
              style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
            >
              <span className="font-semibold">FieldServe</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="hover:bg-accent rounded-md p-1"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2" aria-label="Office menu">
              {menu.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm ${
                      isActive ? "bg-accent font-medium" : "hover:bg-accent/60"
                    }`
                  }
                >
                  <Icon className="size-4" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <button type="button" aria-label="Close menu" className="flex-1 bg-black/50" onClick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
