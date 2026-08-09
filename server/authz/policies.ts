import { authenticationRequired, permissionDenied } from "./errors";
import { roleHasPermission, type Permission } from "./permissions";
import { isAuthenticatedPrincipal, type AuthenticatedPrincipal, type Principal, type Role, type UserId } from "./types";

export type MaybePrincipal = Principal | null | undefined;

export interface ActorIdentity {
  readonly actorUserId: UserId;
}

export function requireAuthenticated(principal: MaybePrincipal): AuthenticatedPrincipal {
  if (!isAuthenticatedPrincipal(principal)) throw authenticationRequired();
  return principal;
}

export function requireRole(principal: MaybePrincipal, expectedRole: Role): AuthenticatedPrincipal {
  const authenticated = requireAuthenticated(principal);
  if (authenticated.role !== expectedRole) throw permissionDenied();
  return authenticated;
}

export function hasPermission(principal: MaybePrincipal, permission: Permission): boolean {
  return isAuthenticatedPrincipal(principal) && roleHasPermission(principal.role, permission);
}

export function requirePermission(principal: MaybePrincipal, permission: Permission): AuthenticatedPrincipal {
  const authenticated = requireAuthenticated(principal);
  if (!roleHasPermission(authenticated.role, permission)) throw permissionDenied();
  return authenticated;
}

/**
 * Same enforcement as requirePermission, but takes a named capability
 * predicate from scope.ts instead of a raw Permission string - the
 * ergonomics mqr-webapp-new's scope.ts predicates use at their call sites
 * (`if (!canManageUsers(session.role)) ...`), adapted to this app's
 * throw-on-denial convention instead of a manual boolean check per route.
 */
export function requireScope(principal: MaybePrincipal, predicate: (role: Role) => boolean): AuthenticatedPrincipal {
  const authenticated = requireAuthenticated(principal);
  if (!predicate(authenticated.role)) throw permissionDenied();
  return authenticated;
}

/**
 * The only supported source for an audit actor is the authenticated principal.
 * There is intentionally no request-body or client-identity parameter here.
 */
export function actorIdentityFromPrincipal(principal: MaybePrincipal): ActorIdentity {
  const authenticated = requireAuthenticated(principal);
  return Object.freeze({ actorUserId: authenticated.userId });
}
