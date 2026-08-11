import assert from "node:assert/strict";
import {
  AuthorizationError,
  PERMISSIONS,
  READ_ONLY_OPERATIONS,
  ROLE_PERMISSIONS,
  actorIdentityFromPrincipal,
  evaluateReadOnlyOperation,
  hasPermission,
  isOperationAllowedInReadOnlyMode,
  requireAuthenticated,
  requireOperationAllowedInReadOnlyMode,
  requirePermission,
  requireRole,
  requireScope,
  canListUsers,
  canCreateUsers,
  canUpdateUsers,
  canActivateUsers,
  canDeleteUsers,
  canAssignRoles,
  canResetPasswords,
  canReadAuditHistory,
  canManageMigration,
  canAlterAuditRecords,
  canManageGlobalSettings,
  canManageDisplayPeriod,
  canReadOperationalSurfaces,
  canWriteOperationalData,
  canExportReports,
  type AuthenticatedPrincipal,
  type Principal
} from "./index";

const user: AuthenticatedPrincipal = { userId: "user-42", role: "user", active: true, authMethod: "local", sessionId: "session-1" };
const admin: AuthenticatedPrincipal = { userId: "admin-7", role: "admin", active: true, authMethod: "local", sessionId: "session-2" };
const inactive: Principal = { userId: "inactive-3", role: "admin", active: false };

let checks = 0;
function check(name: string, condition: unknown): void {
  assert.equal(Boolean(condition), true, name);
  checks++;
}
function expectAuthzError(name: string, work: () => unknown, status: number, code: string): void {
  assert.throws(work, (error: unknown) => {
    check(`${name}: error type`, error instanceof AuthorizationError);
    if (!(error instanceof AuthorizationError)) return false;
    check(`${name}: status`, error.status === status);
    check(`${name}: code`, error.code === code);
    check(`${name}: generic message`, !error.message.includes("user-42") && !error.message.includes("admin") && !error.message.includes("user"));
    return true;
  });
}

expectAuthzError("anonymous authentication", () => requireAuthenticated(null), 401, "UNAUTHORIZED");
expectAuthzError("inactive authentication", () => requireAuthenticated(inactive), 401, "UNAUTHORIZED");
check("authenticated principal is returned", requireAuthenticated(user) === user);
check("required role succeeds", requireRole(admin, "admin") === admin);
expectAuthzError("wrong role", () => requireRole(user, "admin"), 403, "FORBIDDEN");

for (const permission of ROLE_PERMISSIONS.user) check(`user permission ${permission}`, hasPermission(user, permission));
for (const permission of ROLE_PERMISSIONS.admin) check(`admin permission ${permission}`, hasPermission(admin, permission));
for (const permission of ROLE_PERMISSIONS.user) check(`admin inherits ${permission}`, hasPermission(admin, permission));
check("user cannot alter audit records", !hasPermission(user, PERMISSIONS.auditRecordsAlter));
check("admin cannot alter audit records", !hasPermission(admin, PERMISSIONS.auditRecordsAlter));
check("user cannot manage users", !hasPermission(user, PERMISSIONS.usersCreate));
check("anonymous has no permission", !hasPermission(null, PERMISSIONS.dashboardRead));
expectAuthzError("permission denial", () => requirePermission(user, PERMISSIONS.usersList), 403, "FORBIDDEN");
check("actor comes from principal", actorIdentityFromPrincipal(admin).actorUserId === "admin-7");
expectAuthzError("actor requires principal", () => actorIdentityFromPrincipal(undefined), 401, "UNAUTHORIZED");

check("read-only login allowed", isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.authLogin, true));
check("read-only logout allowed", isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.authLogout, true));
check("read-only session allowed", isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.authSession, true));
check("read-only operational reads allowed", isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.operationalDataRead, true));
check("read-only reports allowed", isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.reportsExport, true));
check("read-only password change blocked", !isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.authChangePassword, true));
check("read-only user management blocked", !isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.adminUserManagement, true));
check("read-only operational writes blocked", !isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.operationalDataWrite, true));
check("read-only settings writes blocked", !isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.globalSettingsWrite, true));
check("read-only display-period writes blocked", !isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.displayPeriodWrite, true));
check("read-only migration control blocked", !isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.migrationControl, true));
check("admin does not affect read-only decision", evaluateReadOnlyOperation(READ_ONLY_OPERATIONS.operationalDataWrite, true).allowed === false);
check("normal mode allows mutations", isOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.operationalDataWrite, false));
expectAuthzError("read-only denial", () => requireOperationAllowedInReadOnlyMode(READ_ONLY_OPERATIONS.displayPeriodWrite, true), 423, "READ_ONLY_MODE");

// Named scope.ts predicates (mqr-webapp-new's lib/scope.ts pattern) must
// agree with the underlying PERMISSIONS table they wrap - not a second,
// independently-maintained source of truth.
check("everyone reads operational surfaces", canReadOperationalSurfaces("user") && canReadOperationalSurfaces("admin"));
check("everyone exports reports", canExportReports("user") && canExportReports("admin"));
check("user cannot write operational data is false (both roles can)", canWriteOperationalData("user") && canWriteOperationalData("admin"));
for (const [predicate, name] of [
  [canManageGlobalSettings, "canManageGlobalSettings"],
  [canManageDisplayPeriod, "canManageDisplayPeriod"],
  [canListUsers, "canListUsers"],
  [canCreateUsers, "canCreateUsers"],
  [canUpdateUsers, "canUpdateUsers"],
  [canActivateUsers, "canActivateUsers"],
  [canDeleteUsers, "canDeleteUsers"],
  [canAssignRoles, "canAssignRoles"],
  [canResetPasswords, "canResetPasswords"],
  [canReadAuditHistory, "canReadAuditHistory"],
  [canManageMigration, "canManageMigration"]
] as const) {
  check(`${name} denies user`, !predicate("user"));
  check(`${name} allows admin`, predicate("admin"));
}
check("canAlterAuditRecords denies both roles (no path grants it)", !canAlterAuditRecords("user") && !canAlterAuditRecords("admin"));
check("requireScope allows a satisfied predicate", requireScope(admin, canListUsers) === admin);
expectAuthzError("requireScope denies an unsatisfied predicate", () => requireScope(user, canListUsers), 403, "FORBIDDEN");
expectAuthzError("requireScope requires authentication", () => requireScope(null, canListUsers), 401, "UNAUTHORIZED");

console.log(`authz: ${checks} assertions passed`);
