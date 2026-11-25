import type { PagedResult } from "@/lib/pagination";
import type { CompanyDto, CompanySettingsInput } from "@/modules/companies/companies.schema";
import type { DashboardKpis, Report, ReportType } from "@/modules/reports/reports.schema";
import type { CustomRoleDto } from "@/modules/roles/roles.schema";
import type { UserDto } from "@/modules/users/users.schema";
import { http, requestBlob } from "./http";
import type { LiveTechnician } from "./jobTypes";
import type { ListQuery } from "./office";

// The shapes are the server's own types.
export type { CompanyDto, CompanySettingsInput, CustomRoleDto, DashboardKpis, LiveTechnician, Report, ReportType, UserDto };

export const dashboardApi = {
  get: () => http.get<DashboardKpis>("/dashboard"),
};

export const reportsApi = {
  /** `from` and `to` are "YYYY-MM-DD"; left out they mean the last 30 days. */
  get: (type: ReportType, from?: string, to?: string) => http.get<Report>("/reports", { type, from, to }),
  /** The same report as an Excel file. */
  excel: (type: ReportType, from?: string, to?: string) => requestBlob("/reports/export", { type, from, to }),
};

export const liveApi = {
  /** Every active technician with the latest position and current job. */
  technicians: () => http.get<LiveTechnician[]>("/field/live"),
};

export const usersApi = {
  list: (q: ListQuery = {}) => http.get<PagedResult<UserDto>>("/users", q),
  get: (id: string) => http.get<UserDto>(`/users/${id}`),
  /** Admin: switches an account on or off. */
  setActive: (id: string, isActive: boolean) => http.patch<UserDto>(`/users/${id}/status`, { isActive }),
  /** Admin: sets a new password for someone. */
  resetPassword: (id: string, password: string) => http.post<unknown>(`/users/${id}/reset-password`, { password }),
};

export const rolesApi = {
  list: () => http.get<CustomRoleDto[]>("/roles"),
};

export const settingsApi = {
  get: () => http.get<CompanyDto>("/company/settings"),
  /** Admin only. */
  update: (input: CompanySettingsInput) => http.put<CompanyDto>("/company/settings", input),
};
