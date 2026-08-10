import { PERMISSIONS, roleHasPermission } from "./permissions";
import type { Role } from "./types";

/**
 * Named capability predicates, ported from mqr-webapp-new's `lib/scope.ts`
 * pattern: one documented, named function per capability boundary instead
 * of an inline role check at the call site. Each predicate here is a thin
 * wrapper over the existing `PERMISSIONS`/`ROLE_PERMISSIONS` table in
 * `permissions.ts` - that table remains the single source of truth for
 * role-to-permission mapping (unchanged, still fully tested); this file
 * only gives it the same call-site ergonomics mqr's predicates have.
 *
 * Not ported: mqr's dealer/branch tenancy predicates (`seesAllDealers`,
 * `assignableRoles`, `canManageRoleTarget`, etc.) and its per-record
 * `authorization.ts` ownership scoping. Energy Monitor's business model has
 * no dealer/branch/tenancy concept - operational data is shared across
 * every authorized user by explicit design (`docs/rbac.md`). Inventing a
 * tenancy dimension here would be new business logic with no product
 * requirement behind it, not a framework-specific gap to close.
 */

/** Every authenticated user (admin or user) may read these surfaces -
 *  dashboard, energy, cost, electrical, rack, site comparison, operational
 *  data, reports export, global settings, and display period. There is no
 *  role differentiation for reads in this app's 2-role model; only the
 *  administrative actions below are gated. */
export const canReadOperationalSurfaces = (role: Role) => roleHasPermission(role, PERMISSIONS.operationalDataRead);

export const canWriteOperationalData = (role: Role) => roleHasPermission(role, PERMISSIONS.operationalDataWrite);
export const canExportReports = (role: Role) => roleHasPermission(role, PERMISSIONS.reportsExport);

export const canManageGlobalSettings = (role: Role) => roleHasPermission(role, PERMISSIONS.globalSettingsManage);
export const canManageDisplayPeriod = (role: Role) => roleHasPermission(role, PERMISSIONS.displayPeriodManage);

export const canListUsers = (role: Role) => roleHasPermission(role, PERMISSIONS.usersList);
export const canCreateUsers = (role: Role) => roleHasPermission(role, PERMISSIONS.usersCreate);
export const canUpdateUsers = (role: Role) => roleHasPermission(role, PERMISSIONS.usersUpdate);
export const canActivateUsers = (role: Role) => roleHasPermission(role, PERMISSIONS.usersActivate);
export const canDeleteUsers = (role: Role) => roleHasPermission(role, PERMISSIONS.usersDelete);
export const canAssignRoles = (role: Role) => roleHasPermission(role, PERMISSIONS.rolesAssign);
export const canResetPasswords = (role: Role) => roleHasPermission(role, PERMISSIONS.passwordsReset);

export const canReadAuditHistory = (role: Role) => roleHasPermission(role, PERMISSIONS.auditHistoryRead);
export const canManageBackupRestore = (role: Role) => roleHasPermission(role, PERMISSIONS.backupRestoreManage);
export const canManageMigration = (role: Role) => roleHasPermission(role, PERMISSIONS.migrationManage);
export const canAlterAuditRecords = (role: Role) => roleHasPermission(role, PERMISSIONS.auditRecordsAlter);
