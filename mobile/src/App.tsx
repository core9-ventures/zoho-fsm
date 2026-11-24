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
import { Assets, AssetDetail } from "./pages/office/Assets";
import { Catalog } from "./pages/office/Catalog";
import { CustomerDetail, Customers } from "./pages/office/Customers";
import { Dispatch } from "./pages/office/Dispatch";
import { EstimateDetail, Estimates } from "./pages/office/Estimates";
import { InvoiceDetail, Invoices } from "./pages/office/Invoices";
import { Maintenance } from "./pages/office/Maintenance";
import { OfficeInstallationDetail, OfficeInstallations } from "./pages/office/OfficeInstallations";
import { WorkOrderDetail } from "./pages/office/WorkOrderDetail";
import { WorkOrders } from "./pages/office/WorkOrders";
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
        <Route path="/dispatch" element={<Dispatch />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/work-orders/:id" element={<WorkOrderDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/installations" element={<OfficeInstallations />} />
        <Route path="/installations/:id" element={<OfficeInstallationDetail />} />
        <Route path="/estimates" element={<Estimates />} />
        <Route path="/estimates/:id" element={<EstimateDetail />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/assets/:id" element={<AssetDetail />} />
        <Route path="/maintenance" element={<Maintenance />} />
        {/* Built in Phase 5 */}
        {OFFICE_MENU.filter((m) => m.phase >= 5).map((m) => (
          <Route key={m.to} path={`${m.to}/*`} element={<ComingSoon />} />
        ))}
        <Route path="*" element={<Navigate to="/dispatch" replace />} />
      </Route>
    </Routes>
  );
}
