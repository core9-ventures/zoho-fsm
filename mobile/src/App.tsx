import { Loader2 } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { OfficeLayout } from "./components/OfficeLayout";
import { TechLayout } from "./components/TechLayout";
import { OFFICE_MENU, TECH_TABS } from "./nav";
import { Account } from "./pages/Account";
import { ComingSoon } from "./pages/ComingSoon";
import { Login } from "./pages/Login";
import { useSession } from "./session";

export function App() {
  const { role, restoring } = useSession();

  // Checking the saved sign-in with the server.
  if (restoring) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!role) return <Login />;

  if (role === "TECHNICIAN") {
    return (
      <Routes>
        <Route element={<TechLayout />}>
          {TECH_TABS.filter((t) => t.to !== "/account").map((t) => (
            <Route key={t.to} path={`${t.to}/*`} element={<ComingSoon />} />
          ))}
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/my-jobs" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<OfficeLayout />}>
        {OFFICE_MENU.map((m) => (
          <Route key={m.to} path={`${m.to}/*`} element={<ComingSoon />} />
        ))}
        <Route path="*" element={<Navigate to="/dispatch" replace />} />
      </Route>
    </Routes>
  );
}
