import type { PagedResult } from "@/lib/pagination";
import type { AssetDto } from "@/modules/assets/assets.schema";
import type { ServiceItemDto } from "@/modules/catalog/catalog.schema";
import type { CustomerDto, CustomerListItem } from "@/modules/customers/customers.schema";
import type { EstimateDetail, EstimateListItem } from "@/modules/estimates/estimates.schema";
import type { InvoiceDetail, InvoiceListItem, InvoiceSummary } from "@/modules/invoices/invoices.schema";
import type { MaintenancePlanDto } from "@/modules/maintenance/maintenance.schema";
import type { Board } from "@/modules/scheduling/scheduling.schema";
import type { WorkOrderDetail, WorkOrderListItem } from "@/modules/work-orders/work-orders.schema";
import { http } from "./http";

// The shapes are the server's own types, so the screens and the server cannot drift apart.
export type {
  AssetDto,
  Board,
  CustomerDto,
  CustomerListItem,
  EstimateDetail,
  EstimateListItem,
  InvoiceDetail,
  InvoiceListItem,
  InvoiceSummary,
  MaintenancePlanDto,
  ServiceItemDto,
  WorkOrderDetail,
  WorkOrderListItem,
};

/** Filters the list screens send (page, search, and one or two filters). */
export type ListQuery = { page?: number; pageSize?: number; search?: string; [filter: string]: string | number | undefined };

export const dispatchApi = {
  board: (date?: string) => http.get<Board>("/dispatch/board", { date }),
  /** Gives a work order to a technician. `start` is local time "YYYY-MM-DDTHH:mm" in the company's zone. */
  schedule: (workOrderId: string, input: { technicianId: string; start: string; durationMin: number }) =>
    http.put<unknown>(`/work-orders/${workOrderId}/schedule`, input),
  unschedule: (workOrderId: string) => http.delete<unknown>(`/work-orders/${workOrderId}/schedule`),
};

export const workOrdersApi = {
  list: (q: ListQuery = {}) => http.get<PagedResult<WorkOrderListItem>>("/work-orders", q),
  get: (id: string) => http.get<WorkOrderDetail>(`/work-orders/${id}`),
  changeStatus: (id: string, status: string, reason?: string) =>
    http.post<WorkOrderDetail>(`/work-orders/${id}/status`, { status, reason: reason ?? "" }),
  addNote: (id: string, text: string, isInternal: boolean) =>
    http.post<null>(`/work-orders/${id}/notes`, { text, isInternal }),
};

export const customersApi = {
  list: (q: ListQuery = {}) => http.get<PagedResult<CustomerListItem>>("/customers", q),
  get: (id: string) => http.get<CustomerDto>(`/customers/${id}`),
};

export const estimatesApi = {
  list: (q: ListQuery = {}) => http.get<PagedResult<EstimateListItem>>("/estimates", q),
  get: (id: string) => http.get<EstimateDetail>(`/estimates/${id}`),
  changeStatus: (id: string, status: string) => http.post<EstimateDetail>(`/estimates/${id}/status`, { status }),
};

export const invoicesApi = {
  list: (q: ListQuery = {}) => http.get<PagedResult<InvoiceListItem>>("/invoices", q),
  get: (id: string) => http.get<InvoiceDetail>(`/invoices/${id}`),
  summary: () => http.get<InvoiceSummary>("/invoices/summary"),
  /** Admin only. `paidAt` "" means now. */
  addPayment: (id: string, input: { amount: number; method: string; reference: string; paidAt: string }) =>
    http.post<unknown>(`/invoices/${id}/payments`, input),
};

export const catalogApi = {
  list: (q: ListQuery = {}) => http.get<PagedResult<ServiceItemDto>>("/service-items", q),
};

export const assetsApi = {
  list: (q: ListQuery = {}) => http.get<PagedResult<AssetDto>>("/assets", q),
  get: (id: string) => http.get<AssetDto>(`/assets/${id}`),
};

export const maintenanceApi = {
  list: () => http.get<MaintenancePlanDto[]>("/maintenance"),
  /** Switches a plan on or off. */
  setActive: (id: string, isActive: boolean) => http.post<MaintenancePlanDto>(`/maintenance/${id}/active`, { isActive }),
};
