export type AuthorizationErrorStatus = 401 | 403 | 423;
export type AuthorizationErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "READ_ONLY_MODE";

const SAFE_MESSAGES: Record<AuthorizationErrorCode, string> = {
  UNAUTHORIZED: "Authentication is required.",
  FORBIDDEN: "You do not have permission to perform this action.",
  READ_ONLY_MODE: "Mutations are disabled while READ_ONLY_MODE is enabled."
};

export class AuthorizationError extends Error {
  readonly name = "AuthorizationError";

  constructor(
    readonly status: AuthorizationErrorStatus,
    readonly code: AuthorizationErrorCode
  ) {
    super(SAFE_MESSAGES[code]);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function authenticationRequired(): AuthorizationError {
  return new AuthorizationError(401, "UNAUTHORIZED");
}

export function permissionDenied(): AuthorizationError {
  return new AuthorizationError(403, "FORBIDDEN");
}

export function readOnlyModeEnabled(): AuthorizationError {
  return new AuthorizationError(423, "READ_ONLY_MODE");
}

export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError;
}
