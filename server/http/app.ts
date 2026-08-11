import crypto from "node:crypto";
import express, { type ErrorRequestHandler, type Request, type Response, type NextFunction } from "express";
import type { ServerConfig } from "../config/env";
import { isHttpError, HttpError } from "../errors";
import { ApiService } from "../services/apiService";
import type { BackendRepository } from "../repositories/contracts";
import { AuthService } from "../auth/authService";
import { PasswordPolicyError } from "../auth/passwordPolicy";
import { authContext, createAuthContextMiddleware } from "../auth/http";
import { PERMISSIONS } from "../authz/permissions";
import { requirePermission, type AuthenticatedPrincipal, isAuthorizationError, type Role } from "../authz";
import { createCorsMiddleware, createOriginPolicy, createCsrfMiddleware, csrfCookieOptions, issueCsrfCookie, clearCookie, parseCookieHeader, serializeCookie, SESSION_COOKIE_NAME, CSRF_COOKIE_NAME, sessionCookieOptions, createRateLimitMiddleware, InMemoryRateLimitStore, type RateLimitStore } from "./security";
import { isAuthorizedCronRequest } from "../backup/backupConfig";
import { runBackup, testBackupConnection } from "../backup/backupService";
import { canonicalSheetUrl, extractSpreadsheetId, maskSpreadsheetId } from "../backup/googleSheetsUrl";
import { loadGoogleOAuthClientConfig, buildAuthorizationUrl, exchangeCodeForTokens, fetchGoogleAccountEmail, revokeGoogleToken } from "../backup/googleOAuthClient";
import { makeCodeVerifier, makeCodeChallenge, makeOAuthState, hashState, encryptSecret, decryptSecret } from "../backup/googleOAuthCrypto";

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
  // Backup reads operational data and writes only to Sheets/backup_log, never
  // to operational tables - READ_ONLY_MODE exists to block operational
  // writes, not to disable backups during exactly the kind of maintenance
  // window READ_ONLY_MODE is used for.
  const securityExceptions = req.path === "/auth/login" || req.path === "/auth/logout" || req.path === "/cron/backup" || req.path === "/admin/backup/run" || req.path === "/admin/backup/test-connection";
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
  if (dependencies.config.nodeEnv === "production" && !dependencies.rateLimitStore) throw new Error("A durable rate-limit store is required in production.");
  const rateLimitStore = dependencies.rateLimitStore ?? new InMemoryRateLimitStore();
  const csrf = createCsrfMiddleware({ secret: dependencies.config.csrfSecret, cookieOptions: csrfCookieOptions(dependencies.config.nodeEnv, dependencies.config.sessionLifetimeMs) });
  const loginRateLimit = createRateLimitMiddleware(rateLimitStore, { limit: 30, windowMs: 15 * 60 * 1000 }, { trustProxy: dependencies.config.trustProxy });

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(createCorsMiddleware(originPolicy, { credentials: true, maxAgeSeconds: 600 }));
  app.use(express.json({ limit: "1mb" }));

  // Health and readiness remain public so load balancers can probe the API.
  app.get("/api/v1/health", asyncRoute(async (_req, res) => sendOk(res, await service.health())));
  app.get("/api/v1/health/ready", asyncRoute(async (_req, res) => sendOk(res, await service.readiness())));
  app.get("/api/v1/ready", asyncRoute(async (_req, res) => sendOk(res, await service.readiness())));
  app.get("/api/v1/readiness", asyncRoute(async (_req, res) => sendOk(res, await service.readiness())));

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
    const result = await auth.login(body.username, body.password, { ip: req.socket.remoteAddress ?? null, userAgent: req.header("user-agent") ?? null, correlationId: res.locals.requestId });
    res.append("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, result.sessionToken, sessionCookieOptions(dependencies.config.nodeEnv, dependencies.config.sessionLifetimeMs)));
    issueCsrfCookie(res, { secret: dependencies.config.csrfSecret, cookieOptions: csrfCookieOptions(dependencies.config.nodeEnv, dependencies.config.sessionLifetimeMs) }, result.sessionToken);
    sendOk(res, { user: result.user, expiresAt: result.expiresAt.toISOString() });
  }));

  // All remaining mutation routes, including logout and password change, must
  // present the session-bound CSRF token. /cron/backup is the one exception:
  // Vercel Cron calls it with no session/cookies at all, authenticated
  // instead by its own CRON_SECRET bearer check inside the route handler -
  // the same shape as the existing /auth/login CSRF exception below, just
  // for a machine-to-machine caller instead of a not-yet-authenticated one.
  app.use("/api/v1", (req, res, next) => { if (req.path === "/cron/backup") { next(); return; } csrf(req, res, next); });

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

  app.get("/api/v1/bootstrap", asyncRoute(async (_req, res) => { principal(res); sendOk(res, { ...(await service.bootstrap() as Record<string, unknown>), readOnlyMode: dependencies.config.readOnlyMode }); }));
  app.get("/api/v1/sites", asyncRoute(async (_req, res) => { withPermission(res, PERMISSIONS.dashboardRead); sendOk(res, await service.listSites()); }));
  app.get("/api/v1/settings", asyncRoute(async (_req, res) => { withPermission(res, PERMISSIONS.globalSettingsRead); sendOk(res, await service.getSettings()); }));
  app.put("/api/v1/settings/display-period", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.displayPeriodManage); const body = parseObjectBody(req.body); sendOk(res, await service.updateSettings(body.start_month, body.end_month, body.expected_row_version, res.locals.requestId, actorNumber(actor.userId))); }));

  app.get("/api/v1/periods", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.dashboardRead); sendOk(res, await service.getPeriods(parseSiteId(req.query.siteId))); }));
  app.get("/api/v1/dashboard", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.dashboardRead); sendOk(res, await service.getDashboard(parseSiteId(req.query.siteId), req.query.month)); }));
  app.get("/api/v1/energy", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.energyRead); sendOk(res, await service.getEnergy(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month))); }));
  app.get("/api/v1/cost", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.costRead); sendOk(res, await service.getCost(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month))); }));
  app.get("/api/v1/electrical", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.electricalRead); sendOk(res, await service.getElectrical(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month))); }));
  app.get("/api/v1/sites/:siteId/periods/:month", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.operationalDataRead); sendOk(res, await service.getMonthlyLog(parseSiteId(req.params.siteId), req.params.month)); }));
  app.get("/api/v1/site-comparison", asyncRoute(async (_req, res) => { withPermission(res, PERMISSIONS.siteComparisonRead); sendOk(res, await service.getSiteComparison()); }));
  app.get("/api/v1/racks", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.rackRead); sendOk(res, await service.getRacks(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month))); }));
  app.get("/api/v1/rack-unit-capacity", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.rackRead); sendOk(res, await service.getRackUnit(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month))); }));
  app.put("/api/v1/sites/:siteId/periods/:month", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.operationalDataWrite); sendOk(res, await service.saveMonthlyLog(parseSiteId(req.params.siteId), req.params.month, req.body, res.locals.requestId, actorNumber(actor.userId))); }));
  app.get("/api/v1/sites/:siteId/history", asyncRoute(async (req, res) => { withPermission(res, PERMISSIONS.operationalDataRead); sendOk(res, await service.getHistory(parseSiteId(req.params.siteId))); }));

  app.get("/api/v1/admin/users", asyncRoute(async (_req, res) => { const actor = withPermission(res, PERMISSIONS.usersList); sendOk(res, await auth.listUsers(actor)); }));
  app.post("/api/v1/admin/users", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.usersCreate); const body = parseObjectBody(req.body); sendOk(res, await auth.createUser(actor, { username: body.username, displayName: body.display_name, password: body.password, role: parseRole(body.role), active: body.active }, res.locals.requestId)); }));
  app.patch("/api/v1/admin/users/:userId/display-name", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.usersUpdate); const body = parseObjectBody(req.body); sendOk(res, await auth.setUserDisplayName(actor, parseUserId(req.params.userId), body.display_name, res.locals.requestId)); }));
  app.patch("/api/v1/admin/users/:userId/active", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.usersActivate); const body = parseObjectBody(req.body); if (typeof body.active !== "boolean") throw new HttpError(400, "INVALID_ACTIVE", "active must be boolean."); sendOk(res, await auth.setUserActive(actor, parseUserId(req.params.userId), body.active, res.locals.requestId)); }));
  app.patch("/api/v1/admin/users/:userId/role", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.rolesAssign); const body = parseObjectBody(req.body); sendOk(res, await auth.setUserRole(actor, parseUserId(req.params.userId), parseRole(body.role), res.locals.requestId)); }));
  app.post("/api/v1/admin/users/:userId/password", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.passwordsReset); const body = parseObjectBody(req.body); sendOk(res, await auth.resetUserPassword(actor, parseUserId(req.params.userId), body.password, res.locals.requestId)); }));
  app.delete("/api/v1/admin/users/:userId", asyncRoute(async (req, res) => { const actor = withPermission(res, PERMISSIONS.usersDelete); await auth.deleteUser(actor, parseUserId(req.params.userId), res.locals.requestId); res.status(204).end(); }));

  app.get("/api/v1/admin/backup/status", asyncRoute(async (_req, res) => {
    withPermission(res, PERMISSIONS.backupRestoreManage);
    const oauthConfigured = loadGoogleOAuthClientConfig(dependencies.config.appOrigin) !== null;
    const [destination, latest, recent] = await Promise.all([
      dependencies.repository.getBackupConfig(),
      dependencies.repository.latestBackupRun(),
      dependencies.repository.listBackupRuns(10)
    ]);
    const connection = destination.connectedGoogleUserId !== null
      ? await dependencies.repository.getGoogleSheetsConnection(destination.connectedGoogleUserId)
      : null;
    sendOk(res, {
      configured: oauthConfigured && connection !== null && Boolean(destination.spreadsheetId),
      oauthConfigured,
      google: { connected: connection !== null, email: connection?.email ?? null },
      destination: { sheetUrl: destination.sheetUrl, spreadsheetIdMasked: maskSpreadsheetId(destination.spreadsheetId), enabled: destination.enabled, updatedAt: destination.updatedAt },
      schedule: "Daily",
      latest,
      recent
    });
  }));
  app.put("/api/v1/admin/backup/config", asyncRoute(async (req, res) => {
    const actor = withPermission(res, PERMISSIONS.backupRestoreManage);
    const body = parseObjectBody(req.body);
    if (typeof body.google_sheet_url !== "string" || !body.google_sheet_url.trim()) throw new HttpError(400, "INVALID_SHEET_URL", "google_sheet_url is required.");
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "INVALID_ENABLED", "enabled must be a boolean.");
    let spreadsheetId: string;
    try { spreadsheetId = extractSpreadsheetId(body.google_sheet_url); } catch (error) { throw new HttpError(400, "INVALID_SHEET_URL", error instanceof Error ? error.message : "Invalid Google Sheets URL."); }
    const sheetUrl = canonicalSheetUrl(spreadsheetId);
    const updated = await dependencies.repository.updateBackupConfig({ spreadsheetId, sheetUrl, enabled: body.enabled, updatedBy: actorNumber(actor.userId), correlationId: res.locals.requestId });
    sendOk(res, { sheetUrl: updated.sheetUrl, spreadsheetIdMasked: maskSpreadsheetId(updated.spreadsheetId), enabled: updated.enabled, updatedAt: updated.updatedAt });
  }));
  app.post("/api/v1/admin/backup/test-connection", asyncRoute(async (req, res) => {
    withPermission(res, PERMISSIONS.backupRestoreManage);
    const body = parseObjectBody(req.body);
    if (typeof body.google_sheet_url !== "string" || !body.google_sheet_url.trim()) throw new HttpError(400, "INVALID_SHEET_URL", "google_sheet_url is required.");
    const result = await testBackupConnection(body.google_sheet_url, dependencies.repository, dependencies.config.sessionSecret, dependencies.config.appOrigin);
    sendOk(res, result);
  }));
  app.post("/api/v1/admin/backup/run", asyncRoute(async (_req, res) => {
    const actor = withPermission(res, PERMISSIONS.backupRestoreManage);
    const result = await runBackup(dependencies.repository, "manual", actorNumber(actor.userId), dependencies.config.sessionSecret, dependencies.config.appOrigin);
    sendOk(res, result.log);
  }));

  // --- Google OAuth (Admin-initiated backup account connection) ---
  // Interactive authorization-code + PKCE flow, replacing the prior
  // service-account credential entirely. See server/backup/googleOAuthClient.ts
  // and googleOAuthCrypto.ts for the crypto/HTTP detail; only the route
  // wiring lives here.
  app.post("/api/v1/admin/backup/google/connect", asyncRoute(async (_req, res) => {
    const actor = withPermission(res, PERMISSIONS.backupRestoreManage);
    const oauthConfig = loadGoogleOAuthClientConfig(dependencies.config.appOrigin);
    if (!oauthConfig) throw new HttpError(503, "GOOGLE_OAUTH_NOT_CONFIGURED", "Google OAuth is not configured on the server (GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET missing).");
    const sessionId = Number(actor.sessionId ?? "");
    if (!Number.isSafeInteger(sessionId) || sessionId < 1) throw new HttpError(500, "INVALID_SESSION", "Current session identity is invalid.");
    const verifier = makeCodeVerifier();
    const challenge = makeCodeChallenge(verifier);
    const state = makeOAuthState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await dependencies.repository.createGoogleOAuthState({
      stateHash: hashState(state),
      userId: actorNumber(actor.userId),
      sessionId,
      encryptedCodeVerifier: encryptSecret(verifier, dependencies.config.sessionSecret),
      expiresAt
    });
    sendOk(res, { authorizationUrl: buildAuthorizationUrl(oauthConfig, state, challenge) });
  }));
  // Google redirects the browser here via a top-level GET - it cannot
  // carry the app's double-submit CSRF token (SAFE_METHODS already
  // exempts GET from that check), so the single-use, session-bound
  // `state` parameter IS this route's CSRF protection (RFC 6749 SS10.12).
  // On any failure this redirects back into the app with a status query
  // param rather than returning raw JSON - the "caller" here is a full
  // browser navigation, not a fetch() call.
  app.get("/api/v1/admin/backup/google/callback", asyncRoute(async (req, res) => {
    const finish = (status: "connected" | "error", message?: string): void => {
      const params = new URLSearchParams({ google_backup: status });
      if (message) params.set("google_backup_message", message);
      res.redirect(302, `/?${params.toString()}`);
    };
    const stateParam = typeof req.query.state === "string" ? req.query.state : null;
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const googleError = typeof req.query.error === "string" ? req.query.error : null;
    if (googleError) { finish("error", "Google sign-in was cancelled or denied."); return; }
    if (!stateParam || !code) { finish("error", "Invalid Google sign-in response."); return; }

    const stateRecord = await dependencies.repository.consumeGoogleOAuthState(hashState(stateParam));
    if (!stateRecord || new Date(stateRecord.expiresAt).getTime() < Date.now()) { finish("error", "This Google sign-in link expired or was already used. Please try connecting again."); return; }

    let actor: AuthenticatedPrincipal;
    try { actor = withPermission(res, PERMISSIONS.backupRestoreManage); }
    catch { finish("error", "Please sign in as an Admin and try connecting again."); return; }
    if (Number(actor.sessionId ?? "") !== stateRecord.sessionId || actorNumber(actor.userId) !== stateRecord.userId) {
      finish("error", "This Google sign-in must be completed in the same admin session that started it. Please try connecting again.");
      return;
    }
    if (dependencies.config.readOnlyMode) { finish("error", "The system is currently in read-only maintenance mode. Please try again later."); return; }

    const oauthConfig = loadGoogleOAuthClientConfig(dependencies.config.appOrigin);
    if (!oauthConfig) { finish("error", "Google OAuth is not configured on the server."); return; }

    let codeVerifier: string;
    try { codeVerifier = decryptSecret(stateRecord.encryptedCodeVerifier, dependencies.config.sessionSecret); }
    catch { finish("error", "This Google sign-in could not be completed. Please try connecting again."); return; }

    try {
      const tokens = await exchangeCodeForTokens(oauthConfig, code, codeVerifier);
      if (!tokens.refreshToken) { finish("error", "Google did not grant offline access. Please try connecting again and approve all requested permissions."); return; }
      const email = await fetchGoogleAccountEmail(tokens.accessToken);
      const encryptedRefreshToken = encryptSecret(tokens.refreshToken, dependencies.config.sessionSecret);
      await dependencies.repository.upsertGoogleSheetsConnection({ userId: stateRecord.userId, encryptedRefreshToken, email });
      await dependencies.repository.setBackupConnectedGoogleUser(stateRecord.userId, stateRecord.userId, res.locals.requestId);
      finish("connected");
    } catch {
      finish("error", "Google sign-in failed. Please try connecting again.");
    }
  }));
  app.post("/api/v1/admin/backup/google/disconnect", asyncRoute(async (_req, res) => {
    const actor = withPermission(res, PERMISSIONS.backupRestoreManage);
    const destination = await dependencies.repository.getBackupConfig();
    if (destination.connectedGoogleUserId !== null) {
      const encryptedRefreshToken = await dependencies.repository.getGoogleSheetsConnectionSecret(destination.connectedGoogleUserId);
      if (encryptedRefreshToken) {
        try { await revokeGoogleToken(decryptSecret(encryptedRefreshToken, dependencies.config.sessionSecret)); }
        catch { /* best-effort revoke with Google - the local disconnect proceeds regardless, see revokeGoogleToken's own contract */ }
      }
      await dependencies.repository.deleteGoogleSheetsConnection(destination.connectedGoogleUserId);
    }
    await dependencies.repository.setBackupConnectedGoogleUser(null, actorNumber(actor.userId), res.locals.requestId);
    sendOk(res, { connected: false });
  }));

  // Vercel Cron authenticates via a shared-secret bearer header (Vercel's
  // documented convention for securing cron endpoints), never a user
  // session - this route is intentionally outside the session/CSRF stack.
  app.post("/api/v1/cron/backup", asyncRoute(async (req, res) => {
    if (!isAuthorizedCronRequest(req.header("authorization"))) throw new HttpError(401, "UNAUTHORIZED", "Invalid or missing cron authorization.");
    const result = await runBackup(dependencies.repository, "scheduled", null, dependencies.config.sessionSecret, dependencies.config.appOrigin);
    sendOk(res, result.log);
  }));

  app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "The requested API route was not found.")));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const request = res.locals.requestId ?? crypto.randomUUID();
    if (isAuthorizationError(error)) { res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message, requestId: request } }); return; }
    if (isHttpError(error)) { res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message, requestId: request } }); return; }
    if (error instanceof PasswordPolicyError) { res.status(400).json({ ok: false, error: { code: error.code, message: error.message, requestId: request } }); return; }
    if (error && typeof error === "object" && (("type" in error && (error as { type?: unknown }).type === "entity.too.large") || ("status" in error && (error as { status?: unknown }).status === 413))) { res.status(413).json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the permitted size.", requestId: request } }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ ok: false, error: { code: "INVALID_JSON", message: "Request body is not valid JSON.", requestId: request } }); return; }
    console.error(`[${request}] API error`, error instanceof Error ? error.name : "UNKNOWN_ERROR");
    res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred.", requestId: request } });
  };
  app.use(errorHandler);
  return app;
}
