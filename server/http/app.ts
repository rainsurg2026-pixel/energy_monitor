import crypto from "node:crypto";
import express, { type ErrorRequestHandler, type Request, type Response, type NextFunction } from "express";
import type { ServerConfig } from "../config/env";
import { isHttpError, HttpError } from "../errors";
import { ApiService } from "../services/apiService";
import type { BackendRepository } from "../repositories/contracts";
import { AuthService } from "../auth/authService";
import { authContext, createAuthContextMiddleware } from "../auth/http";
import { PERMISSIONS } from "../authz/permissions";
import { requirePermission, type AuthenticatedPrincipal, isAuthorizationError, type Role } from "../authz";
import { createCorsMiddleware, createOriginPolicy, createCsrfMiddleware, csrfCookieOptions, issueCsrfCookie, clearCookie, parseCookieHeader, serializeCookie, SESSION_COOKIE_NAME, CSRF_COOKIE_NAME, sessionCookieOptions, createRateLimitMiddleware, InMemoryRateLimitStore, type RateLimitStore } from "./security";

export interface AppDependencies {
  repository: BackendRepository;
  config: ServerConfig;
  authService: AuthService;
  rateLimitStore?: RateLimitStore;
  service?: ApiService;
}

function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id")?.trim();
  const id = incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}

function readOnlyMutationGuard(config: ServerConfig, req: Request, res: Response, next: NextFunction): void {
  const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  const securityExceptions = req.path === "/auth/login" || req.path === "/auth/logout";
  if (config.readOnlyMode && mutation && !securityExceptions) {
    res.status(423).json({ ok: false, error: { code: "READ_ONLY_MODE", message: "Mutations are disabled while READ_ONLY_MODE is enabled.", requestId: res.locals.requestId } });
    return;
  }
  next();
}

function sendOk(res: Response, data: unknown): void { res.json({ ok: true, data }); }
function parseSiteId(value: unknown): number { if (typeof value !== "string" || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > Number.MAX_SAFE_INTEGER) throw new HttpError(400, "INVALID_SITE_ID", "siteId must be a positive integer."); return Number(value); }
function parseUserId(value: unknown): string { if (typeof value !== "string" || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > Number.MAX_SAFE_INTEGER) throw new HttpError(400, "INVALID_USER_ID", "userId must be a positive integer."); return value; }
function parseObjectBody(value: unknown): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_BODY", "Request body must be a JSON object."); return value as Record<string, unknown>; }
function parseRequiredMonth(value: unknown): string { if (typeof value !== "string" || value.length === 0) throw new HttpError(400, "INVALID_MONTH", "month is required."); return value; }
function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) { return (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); }; }
function principal(res: Response): AuthenticatedPrincipal { return requirePermission(authContext(res).principal, PERMISSIONS.dashboardRead); }
function withPermission(res: Response, permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]): AuthenticatedPrincipal { return requirePermission(authContext(res).principal, permission); }
function actorNumber(userId: string): number { const value = Number(userId); if (!Number.isSafeInteger(value) || value < 1) throw new HttpError(500, "INVALID_ACTOR", "Authenticated actor identity is invalid."); return value; }
function parseRole(value: unknown): Role { if (value !== "admin" && value !== "user") throw new HttpError(400, "INVALID_ROLE", "role must be admin or user."); return value; }

export function createApp(dependencies: AppDependencies) {
  const app = express();
  const service = dependencies.service ?? new ApiService(dependencies.repository);
  const auth = dependencies.authService;
  const originPolicy = createOriginPolicy({ allowedOrigins: dependencies.config.allowedOrigins, allowedPreviewOrigins: dependencies.config.allowedPreviewOrigins });
  const rateLimitStore = dependencies.rateLimitStore ?? new InMemoryRateLimitStore();
  const csrf = createCsrfMiddleware({ secret: dependencies.config.csrfSecret, cookieOptions: csrfCookieOptions(dependencies.config.nodeEnv, dependencies.config.sessionLifetimeMs) });
  const loginRateLimit = createRateLimitMiddleware(rateLimitStore, { limit: 10, windowMs: 15 * 60 * 1000 }, { trustProxy: dependencies.config.trustProxy });

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(createCorsMiddleware(originPolicy, { credentials: true, maxAgeSeconds: 600 }));
  app.use(express.json({ limit: "1mb" }));

  // Health and readiness remain public so load balancers can probe the API.
  app.get("/api/v1/health", asyncRoute(async (_req, res) => sendOk(res, await service.health())));
  app.get("/api/v1/health/ready", asyncRoute(async (_req, res) => sendOk(res, await service.readiness())));
  app.get("/api/v1/ready", asyncRoute(async (_req, res) => sendOk(res, await service.readiness())));

  app.use("/api/v1", readOnlyMutationGuard.bind(null, dependencies.config));
  app.use("/api/v1", createAuthContextMiddleware(auth));

  app.get("/api/v1/auth/csrf", (req, res) => {
    const token = parseCookieHeader(req.header("cookie"))[SESSION_COOKIE_NAME];
    issueCsrfCookie(res, { secret: dependencies.config.csrfSecret, cookieOptions: csrfCookieOptions(dependencies.config.nodeEnv, dependencies.config.sessionLifetimeMs) }, token);
    sendOk(res, { csrfRequired: true });
  });

  // Login has no authenticated session yet, so it is protected by explicit
  // origin validation and rate limiting; subsequent cookie mutations require CSRF.
  app.post("/api/v1/auth/login", loginRateLimit, asyncRoute(async (req, res) => {
    const body = parseObjectBody(req.body);
    const result = await auth.login(body.username, body.password, { ip: req.socket.remoteAddress ?? null, userAgent: req.header("user-agent") ?? null });
    res.append("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, result.sessionToken, sessionCookieOptions(dependencies.config.nodeEnv, dependencies.config.sessionLifetimeMs)));
    issueCsrfCookie(res, { secret: dependencies.config.csrfSecret, cookieOptions: csrfCookieOptions(dependencies.config.nodeEnv, dependencies.config.sessionLifetimeMs) }, result.sessionToken);
    sendOk(res, { user: result.user, expiresAt: result.expiresAt.toISOString() });
  }));

  // All remaining mutation routes, including logout and password change, must
  // present the session-bound CSRF token.
  app.use("/api/v1", (req, res, next) => csrf(req, res, next));

  app.post("/api/v1/auth/logout", asyncRoute(async (req, res) => {
    const token = authContext(res).sessionToken;
    await auth.logout(token ?? undefined);
    clearCookie(res, SESSION_COOKIE_NAME, sessionCookieOptions(dependencies.config.nodeEnv, dependencies.config.sessionLifetimeMs));
    clearCookie(res, CSRF_COOKIE_NAME, csrfCookieOptions(dependencies.config.nodeEnv, dependencies.config.sessionLifetimeMs));
    sendOk(res, { loggedOut: true });
  }));

  app.get("/api/v1/auth/session", asyncRoute(async (_req, res) => {
    const context = authContext(res);
    if (!context.principal || !context.user) { sendOk(res, { authenticated: false, user: null }); return; }
    sendOk(res, { authenticated: true, user: context.user });
  }));

  app.post("/api/v1/auth/change-password", asyncRoute(async (req, res) => {
    const current = withPermission(res, PERMISSIONS.dashboardRead);
    const body = parseObjectBody(req.body);
    await auth.changePassword(current, body.current_password, body.new_password, res.locals.requestId);
    sendOk(res, { changed: true });
  }));

  app.get("/api/v1/bootstrap", asyncRoute(async (_req, res) => { principal(res); sendOk(res, await service.bootstrap()); }));
  app.get("/api/v1/sites", asyncRoute(async (_req, res) => { withPermission(res, PERMISSIONS.dashboardRead); sendOk(res, await service.listSites()); }));
  app.get("/api/v1/settings", asyncRoute(async (_req, res) => { withPermission(res, PERMISSIONS.globalSettingsRead); sendOk(res, await service.getSettings()); }));
  app.put("/api/v1/settings/display-period", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.displayPeriodManage); const body = parseObjectBody(req.body); sendOk(res, await service.updateSettings(body.start_month, body.end_month, body.expected_row_version, res.locals.requestId, actorNumber(actor.userId))); }));

  app.get("/api/v1/periods", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.dashboardRead); sendOk(res, await service.getPeriods(parseSiteId(req.query.siteId))); }));
  app.get("/api/v1/dashboard", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.dashboardRead); sendOk(res, await service.getDashboard(parseSiteId(req.query.siteId), req.query.month)); }));
  app.get("/api/v1/energy", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.energyRead); sendOk(res, await service.getEnergy(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month))); }));
  app.get("/api/v1/cost", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.costRead); sendOk(res, await service.getCost(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month))); }));
  app.get("/api/v1/electrical", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.electricalRead); sendOk(res, await service.getElectrical(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month))); }));
  app.get("/api/v1/site-comparison", asyncRoute(async (_req, res) => { withPermission(res, PERMISSIONS.siteComparisonRead); sendOk(res, await service.getSiteComparison()); }));
  app.get("/api/v1/racks", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.rackRead); sendOk(res, await service.getRacks(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month))); }));
  app.get("/api/v1/rack-unit-capacity", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.rackRead); sendOk(res, await service.getRackUnit(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month))); }));
  app.put("/api/v1/sites/:siteId/periods/:month", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.operationalDataWrite); sendOk(res, await service.saveMonthlyLog(parseSiteId(req.params.siteId), req.params.month, req.body, res.locals.requestId, actorNumber(actor.userId))); }));

  app.get("/api/v1/admin/users", asyncRoute(async (_req, res) => { const actor = withPermission(res, PERMISSIONS.usersList); sendOk(res, await auth.listUsers(actor)); }));
  app.post("/api/v1/admin/users", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.usersCreate); const body = parseObjectBody(req.body); sendOk(res, await auth.createUser(actor, { username: body.username, displayName: body.display_name, password: body.password, role: parseRole(body.role), active: body.active }, res.locals.requestId)); }));
  app.patch("/api/v1/admin/users/:userId/display-name", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.usersUpdate); const body = parseObjectBody(req.body); sendOk(res, await auth.setUserDisplayName(actor, parseUserId(req.params.userId), body.display_name, res.locals.requestId)); }));
  app.patch("/api/v1/admin/users/:userId/active", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.usersActivate); const body = parseObjectBody(req.body); if (typeof body.active !== "boolean") throw new HttpError(400, "INVALID_ACTIVE", "active must be boolean."); sendOk(res, await auth.setUserActive(actor, parseUserId(req.params.userId), body.active, res.locals.requestId)); }));
  app.patch("/api/v1/admin/users/:userId/role", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.rolesAssign); const body = parseObjectBody(req.body); sendOk(res, await auth.setUserRole(actor, parseUserId(req.params.userId), parseRole(body.role), res.locals.requestId)); }));
  app.post("/api/v1/admin/users/:userId/password", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.passwordsReset); const body = parseObjectBody(req.body); sendOk(res, await auth.resetUserPassword(actor, parseUserId(req.params.userId), body.password, res.locals.requestId)); }));

  app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "The requested API route was not found.")));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const request = res.locals.requestId ?? crypto.randomUUID();
    if (isAuthorizationError(error)) { res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message, requestId: request } }); return; }
    if (isHttpError(error)) { res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message, requestId: request } }); return; }
    if (error && typeof error === "object" && (("type" in error && (error as { type?: unknown }).type === "entity.too.large") || ("status" in error && (error as { status?: unknown }).status === 413))) { res.status(413).json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the permitted size.", requestId: request } }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ ok: false, error: { code: "INVALID_JSON", message: "Request body is not valid JSON.", requestId: request } }); return; }
    console.error(`[${request}] API error`, error instanceof Error ? error.message : error);
    res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred.", requestId: request } });
  };
  app.use(errorHandler);
  return app;
}
