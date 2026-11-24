import { Loader2 } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { OfficeLayout } from "./components/OfficeLayout";
import { TechLayout } from "./components/TechLayout";
import { OFFICE_MENU } from "./nav";
import { Account } from "./pages/Account";
import { ComingSoon } from "./pages/ComingSoon";
import { InstallationView } from "./pages/InstallationView";
import { JobDetail } from "./pages/JobDetail";
import { Login } from "./pages/Login";
import { MyInstallations } from "./pages/MyInstallations";
import { MyJobs } from "./pages/MyJobs";
import { NewInstallation } from "./pages/NewInstallation";
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
          <Route path="/my-jobs" element={<MyJobs />} />
          <Route path="/my-jobs/:id" element={<JobDetail />} />
          <Route path="/new-installation" element={<NewInstallation />} />
          <Route path="/new-installation/:id" element={<NewInstallation />} />
          <Route path="/my-installations" element={<MyInstallations />} />
          <Route path="/my-installations/:id" element={<InstallationView />} />
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
