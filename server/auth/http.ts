import type { NextFunction, Request, RequestHandler, Response } from "express";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "../http/security/cookies";
import type { AuthService } from "./authService";
import type { AuthenticatedPrincipal } from "../authz";

export interface AuthContext {
  readonly principal: AuthenticatedPrincipal | null;
  readonly user: { id: string; username: string; displayName: string; role: "admin" | "user"; active: true } | null;
  readonly sessionToken: string | null;
}

declare global {
  namespace Express {
    interface Locals { authContext?: AuthContext; }
  }
}

export function createAuthContextMiddleware(authService: AuthService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cookies = parseCookieHeader(req.header("cookie"));
    const sessionToken = cookies[SESSION_COOKIE_NAME] ?? null;
    void authService.authenticateSession(sessionToken ?? undefined).then(result => {
      res.locals.authContext = result ? { principal: result.principal, user: result.user, sessionToken } : { principal: null, user: null, sessionToken };
      next();
    }).catch(next);
  };
}

export function authContext(res: Response): AuthContext {
  return res.locals.authContext ?? { principal: null, user: null, sessionToken: null };
}
