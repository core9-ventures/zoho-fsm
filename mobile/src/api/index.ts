/**
 * The one place every screen gets its data from. Today each call goes straight to the server; in Stage 2
 * the same functions will read from the phone's own database and queue writes, so the screens do not change.
 */
export { ApiError, onSessionLost } from "./http";
export { authApi, type SessionUser } from "./auth";
export { fieldInstallations, officeInstallations } from "./installations";
export { attachments, fieldJobs, fieldLocation } from "./jobs";
export type {
  CustomerChoice,
  HoldInstallationInput,
  InstallationDetail,
  InstallationInput,
  InstallationListItem,
  PagedResult,
} from "./installations";
export type { FieldJob, FieldJobDetail, FieldJobList, TransitionInput } from "./jobs";
export { FIELD_ACTION_LABEL } from "./jobs";

export {
  assetsApi,
  catalogApi,
  customersApi,
  dispatchApi,
  estimatesApi,
  invoicesApi,
  maintenanceApi,
  workOrdersApi,
} from "./office";
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
  ListQuery,
  MaintenancePlanDto,
  ServiceItemDto,
  WorkOrderDetail,
  WorkOrderListItem,
} from "./office";
