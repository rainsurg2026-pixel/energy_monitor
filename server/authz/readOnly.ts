import { readOnlyModeEnabled } from "./errors";

export const READ_ONLY_OPERATIONS = {
  authLogin: "auth.login",
  authLogout: "auth.logout",
  authSession: "auth.session",
  authChangePassword: "auth.change-password",
  dashboardRead: "dashboard.read",
  energyRead: "energy.read",
  costRead: "cost.read",
  electricalRead: "electrical.read",
  rackRead: "rack.read",
  siteComparisonRead: "site-comparison.read",
  operationalDataRead: "operational-data.read",
  operationalDataWrite: "operational-data.write",
  reportsExport: "reports.export",
  globalSettingsRead: "global-settings.read",
  globalSettingsWrite: "global-settings.write",
  displayPeriodRead: "display-period.read",
  displayPeriodWrite: "display-period.write",
  adminUserManagement: "admin.user-management",
  auditHistoryRead: "audit-history.read",
  auditRecordsAlter: "audit-records.alter",
  migrationControl: "migration.manage"
} as const;

export type ReadOnlyOperation = (typeof READ_ONLY_OPERATIONS)[keyof typeof READ_ONLY_OPERATIONS];

/**
 * These operations remain available during READ_ONLY_MODE. The list is
 * intentionally explicit so an admin role cannot bypass the operational lock.
 */
const ALLOWED_IN_READ_ONLY_MODE: readonly ReadOnlyOperation[] = [
  READ_ONLY_OPERATIONS.authLogin,
  READ_ONLY_OPERATIONS.authLogout,
  READ_ONLY_OPERATIONS.authSession,
  READ_ONLY_OPERATIONS.dashboardRead,
  READ_ONLY_OPERATIONS.energyRead,
  READ_ONLY_OPERATIONS.costRead,
  READ_ONLY_OPERATIONS.electricalRead,
  READ_ONLY_OPERATIONS.rackRead,
  READ_ONLY_OPERATIONS.siteComparisonRead,
  READ_ONLY_OPERATIONS.operationalDataRead,
  READ_ONLY_OPERATIONS.reportsExport,
  READ_ONLY_OPERATIONS.globalSettingsRead,
  READ_ONLY_OPERATIONS.displayPeriodRead,
  READ_ONLY_OPERATIONS.auditHistoryRead
];

export interface ReadOnlyDecision {
  readonly operation: ReadOnlyOperation;
  readonly readOnlyMode: boolean;
  readonly allowed: boolean;
}

export function evaluateReadOnlyOperation(operation: ReadOnlyOperation, readOnlyMode: boolean): ReadOnlyDecision {
  return {
    operation,
    readOnlyMode,
    allowed: !readOnlyMode || ALLOWED_IN_READ_ONLY_MODE.includes(operation)
  };
}

export function isOperationAllowedInReadOnlyMode(operation: ReadOnlyOperation, readOnlyMode: boolean): boolean {
  return evaluateReadOnlyOperation(operation, readOnlyMode).allowed;
}

export function requireOperationAllowedInReadOnlyMode(operation: ReadOnlyOperation, readOnlyMode: boolean): void {
  if (!isOperationAllowedInReadOnlyMode(operation, readOnlyMode)) throw readOnlyModeEnabled();
}
