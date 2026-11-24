import {
  BarChart3,
  Boxes,
  Briefcase,
  Building2,
  CalendarClock,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MapPin,
  PackageSearch,
  PlusCircle,
  Receipt,
  Settings,
  ShieldCheck,
  User,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; phase: number; adminOnly?: boolean };

/** Technician: bottom tabs (the same three as the web app). */
export const TECH_TABS: NavItem[] = [
  { to: "/my-jobs", label: "My jobs", icon: Briefcase, phase: 3 },
  { to: "/new-installation", label: "New installation", icon: PlusCircle, phase: 3 },
  { to: "/account", label: "Account", icon: User, phase: 3 },
];

/** Office: the menu (same screens as the web portal); phase says when each one is built. */
export const OFFICE_MENU: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, phase: 5 },
  { to: "/dispatch", label: "Dispatch", icon: CalendarClock, phase: 4 },
  { to: "/work-orders", label: "Work orders", icon: ClipboardList, phase: 4 },
  { to: "/customers", label: "Customers", icon: Building2, phase: 4 },
  { to: "/installations", label: "Installations", icon: PackageSearch, phase: 4 },
  { to: "/estimates", label: "Estimates", icon: FileText, phase: 4 },
  { to: "/invoices", label: "Invoices", icon: Receipt, phase: 4 },
  { to: "/catalog", label: "Catalog", icon: Boxes, phase: 4, adminOnly: true },
  { to: "/assets", label: "Assets", icon: Wrench, phase: 4 },
  { to: "/maintenance", label: "Maintenance", icon: ShieldCheck, phase: 4, adminOnly: true },
  { to: "/reports", label: "Reports", icon: BarChart3, phase: 5 },
  { to: "/live-map", label: "Live map", icon: MapPin, phase: 5 },
  { to: "/users", label: "Users", icon: Users, phase: 5, adminOnly: true },
  { to: "/settings", label: "Settings", icon: Settings, phase: 5, adminOnly: true },
];
