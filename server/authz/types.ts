export const ROLES = Object.freeze(["admin", "user"] as const);

export type Role = (typeof ROLES)[number];

/**
 * Stable application-user identity in its canonical API representation.
 * It is deliberately independent of username, email, provider subject, and
 * any request body field.
 */
export type UserId = string;

export type AuthenticationMethod = "local" | "entra";

export interface Principal {
  readonly userId: UserId;
  readonly role: Role;
  readonly active: boolean;
  readonly authMethod?: AuthenticationMethod;
  readonly sessionId?: string;
}

export interface AuthenticatedPrincipal extends Principal {
  readonly active: true;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isAuthenticatedPrincipal(value: unknown): value is AuthenticatedPrincipal {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const authMethod = candidate.authMethod;
  return (
    typeof candidate.userId === "string" &&
    candidate.userId.trim().length > 0 &&
    isRole(candidate.role) &&
    candidate.active === true &&
    (authMethod === undefined || authMethod === "local" || authMethod === "entra")
  );
}
