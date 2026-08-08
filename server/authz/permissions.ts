import type { Role } from "./types";

export const PERMISSIONS = Object.freeze({
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
  globalSettingsManage: "global-settings.manage",
  displayPeriodRead: "display-period.read",
  displayPeriodManage: "display-period.manage",
  usersList: "users.list",
  usersCreate: "users.create",
  usersActivate: "users.activate",
  rolesAssign: "roles.assign",
  passwordsReset: "passwords.reset",
  auditHistoryRead: "audit-history.read",
  backupRestoreManage: "backup-restore.manage",
  migrationManage: "migration.manage",
  auditRecordsAlter: "audit-records.alter"
} as const);

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const USER_PERMISSIONS = Object.freeze([
  PERMISSIONS.dashboardRead,
  PERMISSIONS.energyRead,
  PERMISSIONS.costRead,
  PERMISSIONS.electricalRead,
  PERMISSIONS.rackRead,
  PERMISSIONS.siteComparisonRead,
  PERMISSIONS.operationalDataRead,
  PERMISSIONS.operationalDataWrite,
  PERMISSIONS.reportsExport,
  PERMISSIONS.globalSettingsRead,
  PERMISSIONS.displayPeriodRead
] as const satisfies readonly Permission[]);

const ADMIN_ONLY_PERMISSIONS = Object.freeze([
  PERMISSIONS.globalSettingsManage,
  PERMISSIONS.displayPeriodManage,
  PERMISSIONS.usersList,
  PERMISSIONS.usersCreate,
  PERMISSIONS.usersActivate,
  PERMISSIONS.rolesAssign,
  PERMISSIONS.passwordsReset,
  PERMISSIONS.auditHistoryRead,
  PERMISSIONS.backupRestoreManage,
  PERMISSIONS.migrationManage
] as const satisfies readonly Permission[]);

/**
 * The only role-to-permission map. Admin is explicitly the union of User and
 * the administrative permissions; no controller should add an inline role
 * exception.
 */
export const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze([...USER_PERMISSIONS, ...ADMIN_ONLY_PERMISSIONS]),
  user: USER_PERMISSIONS
} as const satisfies Readonly<Record<Role, readonly Permission[]>>);

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].some(candidate => candidate === permission);
}
