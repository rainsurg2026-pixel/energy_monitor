import crypto from "node:crypto";
import express, { type ErrorRequestHandler, type Request, type Response, type NextFunction } from "express";
import type { ServerConfig } from "../config/env";
import { isHttpError, HttpError } from "../errors";
import { ApiService } from "../services/apiService";
import type { BackendRepository } from "../repositories/contracts";

export interface AppDependencies { repository: BackendRepository; config: ServerConfig; service?: ApiService; }

function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id")?.trim();
  const id = incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}

function readOnlyMutationGuard(config: ServerConfig, req: Request, res: Response, next: NextFunction): void {
  if (config.readOnlyMode && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    res.status(423).json({ ok: false, error: { code: "READ_ONLY_MODE", message: "Mutations are disabled while READ_ONLY_MODE is enabled.", requestId: res.locals.requestId } });
    return;
  }
  next();
}

function sendOk(res: Response, data: unknown): void { res.json({ ok: true, data }); }
function parseSiteId(value: unknown): number {
  if (typeof value !== "string" || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > Number.MAX_SAFE_INTEGER) throw new HttpError(400, "INVALID_SITE_ID", "siteId must be a positive integer.");
  return Number(value);
}
function parseObjectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_BODY", "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}
function parseRequiredMonth(value: unknown): string { if (typeof value !== "string" || value.length === 0) throw new HttpError(400, "INVALID_MONTH", "month is required."); return value; }
function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) { return (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); }; }

export function createApp(dependencies: AppDependencies) {
  const app = express();
  const service = dependencies.service ?? new ApiService(dependencies.repository);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(requestId);
  app.use((req, res, next) => { res.setHeader("access-control-allow-origin", dependencies.config.appOrigin); if (req.method === "OPTIONS") { res.setHeader("access-control-allow-methods", "GET,PUT,PATCH,POST,DELETE,OPTIONS"); res.setHeader("access-control-allow-headers", "content-type,x-request-id"); res.status(204).end(); return; } next(); });
  app.use("/api/v1", readOnlyMutationGuard.bind(null, dependencies.config));

  app.get("/api/v1/health", asyncRoute(async (_req, res) => sendOk(res, await service.health())));
  app.get("/api/v1/health/ready", asyncRoute(async (_req, res) => sendOk(res, await service.readiness())));
  app.get("/api/v1/ready", asyncRoute(async (_req, res) => sendOk(res, await service.readiness())));
  app.get("/api/v1/bootstrap", asyncRoute(async (_req, res) => sendOk(res, await service.bootstrap())));
  app.get("/api/v1/sites", asyncRoute(async (_req, res) => sendOk(res, await service.listSites())));
  app.get("/api/v1/settings", asyncRoute(async (_req, res) => sendOk(res, await service.getSettings())));
  app.put("/api/v1/settings/display-period", asyncRoute(async (req, res) => { const body = parseObjectBody(req.body); return sendOk(res, await service.updateSettings(body.start_month, body.end_month, body.expected_row_version, res.locals.requestId)); }));

  app.get("/api/v1/periods", asyncRoute(async (req, res) => sendOk(res, await service.getPeriods(parseSiteId(req.query.siteId)))));
  app.get("/api/v1/dashboard", asyncRoute(async (req, res) => sendOk(res, await service.getDashboard(parseSiteId(req.query.siteId), req.query.month))));
  app.get("/api/v1/energy", asyncRoute(async (req, res) => sendOk(res, await service.getEnergy(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month)))));
  app.get("/api/v1/cost", asyncRoute(async (req, res) => sendOk(res, await service.getCost(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month)))));
  app.get("/api/v1/electrical", asyncRoute(async (req, res) => sendOk(res, await service.getElectrical(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month)))));
  app.get("/api/v1/site-comparison", asyncRoute(async (_req, res) => sendOk(res, await service.getSiteComparison())));
  app.get("/api/v1/racks", asyncRoute(async (req, res) => sendOk(res, await service.getRacks(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month)))));
  app.get("/api/v1/rack-unit-capacity", asyncRoute(async (req, res) => sendOk(res, await service.getRackUnit(parseSiteId(req.query.siteId), parseRequiredMonth(req.query.month)))));
  app.put("/api/v1/sites/:siteId/periods/:month", asyncRoute(async (req, res) => sendOk(res, await service.saveMonthlyLog(parseSiteId(req.params.siteId), req.params.month, req.body, res.locals.requestId))));

  app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "The requested API route was not found.")));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const request = res.locals.requestId ?? crypto.randomUUID();
    if (isHttpError(error)) { res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message, requestId: request } }); return; }
    if (error && typeof error === "object" && (("type" in error && (error as { type?: unknown }).type === "entity.too.large") || ("status" in error && (error as { status?: unknown }).status === 413))) { res.status(413).json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the permitted size.", requestId: request } }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ ok: false, error: { code: "INVALID_JSON", message: "Request body is not valid JSON.", requestId: request } }); return; }
    console.error(`[${request}] API error`, error instanceof Error ? error.message : error);
    res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred.", requestId: request } });
  };
  app.use(errorHandler);
  return app;
}
