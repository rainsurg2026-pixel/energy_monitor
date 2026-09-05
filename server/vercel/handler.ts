import type { IncomingMessage, ServerResponse } from "node:http";
import { ConfigurationError } from "../config/env";
import { API_HEALTH_RESPONSE } from "../http/health";
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME, parseCookieHeader } from "../http/security";
import { createConfiguredRuntime, type ConfiguredRuntime } from "../runtime";

type VercelNodeHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
type RuntimeFactory = (environment: NodeJS.ProcessEnv) => Promise<ConfiguredRuntime>;
type PdfRenderer = (html: string) => Promise<Buffer>;

function pathnameOf(request: IncomingMessage): string {
  try { return new URL(request.url ?? "/", "http://vercel.local").pathname; }
  catch { return "/"; }
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  if (response.headersSent) return;
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

function unavailablePayload(error: unknown, environment: NodeJS.ProcessEnv): unknown {
  const payload: { ok: false; error: { code: string; message: string; reason?: string } } = {
    ok: false,
    error: { code: "SERVICE_UNAVAILABLE", message: "The API service is unavailable." }
  };

  // Preview-only classification permits safe deployment diagnostics without
  // disclosing configuration names, hosts, credentials, or driver errors.
  if (environment.VERCEL_ENV !== "preview") return payload;
  if (error instanceof ConfigurationError) payload.error.reason = "configuration";
  else {
    const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
    if (code === "28P01" || code === "28000") payload.error.reason = "database-authentication";
    else if (["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code)) payload.error.reason = "database-tls";
    else if (["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH"].includes(code)) payload.error.reason = "database-network";
    else if (["08P01", "53300", "53400", "57P01", "XX000"].includes(code)) payload.error.reason = "database-pooler";
    else if (["42501", "0LP01"].includes(code)) payload.error.reason = "database-role-grant";
    else if (code === "3D000") payload.error.reason = "database-target";
    else payload.error.reason = "database-connection";
  }
  return payload;
}

function writeHealth(response: ServerResponse, method: string | undefined): void {
  if (method === "HEAD") {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end();
    return;
  }
  writeJson(response, 200, { ok: true, data: API_HEALTH_RESPONSE });
}

const PRODUCTION_API_ORIGIN = "https://energy-monitor-puce.vercel.app";
const PRODUCTION_DATA_PREVIEW_BRANCH = "feat/energy-monitor-next";
const PREVIEW_PDF_RENDER_PATH = "/api/v1/reports/render-pdf";
const MAX_PREVIEW_PDF_HTML_BYTES = 12 * 1024 * 1024;

function previewProductionBridgeEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment.VERCEL_ENV === "preview" && environment.VERCEL_GIT_COMMIT_REF === PRODUCTION_DATA_PREVIEW_BRANCH;
}

function previewBridgeAllows(method: string | undefined, pathname: string): boolean {
  const normalizedMethod = (method ?? "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) return true;
  return normalizedMethod === "POST" && (pathname === "/api/v1/auth/login" || pathname === "/api/v1/auth/logout");
}

function pdfAttachmentFilename(request: IncomingMessage): string {
  const raw = new URL(request.url ?? PREVIEW_PDF_RENDER_PATH, "http://vercel.local").searchParams.get("filename") ?? "report.pdf";
  const cleaned = raw.replace(/[^A-Za-z0-9 _().-]+/g, "_").trim().slice(0, 180) || "report.pdf";
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

function previewPdfCsrfValid(request: IncomingMessage): boolean {
  const cookies = parseCookieHeader(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
  const csrfHeader = typeof request.headers["x-csrf-token"] === "string" ? request.headers["x-csrf-token"] : "";
  return Boolean(cookies[SESSION_COOKIE_NAME] && cookies[CSRF_COOKIE_NAME] && csrfHeader && cookies[CSRF_COOKIE_NAME] === csrfHeader);
}

async function requestBody(request: IncomingMessage): Promise<Uint8Array | undefined> {
  const method = (request.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  if (chunks.length === 0) return undefined;
  return new Uint8Array(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
}

async function requestTextBodyLimited(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw Object.assign(new Error("Report HTML is too large."), { code: "PAYLOAD_TOO_LARGE" });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function previewProductionSessionAuthenticated(request: IncomingMessage, fetchImpl: typeof fetch): Promise<boolean> {
  const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : "";
  if (!cookie) return false;
  const headers = new Headers({ accept: "application/json", cookie, origin: PRODUCTION_API_ORIGIN, referer: `${PRODUCTION_API_ORIGIN}/` });
  const upstream = await fetchImpl(`${PRODUCTION_API_ORIGIN}/api/v1/auth/session`, { method: "GET", headers, redirect: "manual" });
  if (!upstream.ok) return false;
  const payload = await upstream.json().catch(() => null) as { ok?: boolean; data?: { authenticated?: boolean } } | null;
  return payload?.ok === true && payload.data?.authenticated === true;
}

async function defaultPdfRenderer(html: string): Promise<Buffer> {
  return (await import("../reports/pdfRenderer")).renderReportPdf(html);
}

async function renderPreviewPdf(request: IncomingMessage, response: ServerResponse, fetchImpl: typeof fetch, renderPdf: PdfRenderer): Promise<void> {
  if (!previewPdfCsrfValid(request)) {
    writeJson(response, 403, { ok: false, error: { code: "CSRF_VALIDATION_FAILED", message: "A valid CSRF token is required." } });
    return;
  }
  if (!await previewProductionSessionAuthenticated(request, fetchImpl)) {
    writeJson(response, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "Authentication is required." } });
    return;
  }
  const contentType = typeof request.headers["content-type"] === "string" ? request.headers["content-type"] : "";
  if (!contentType.toLowerCase().startsWith("text/html")) {
    writeJson(response, 415, { ok: false, error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Report HTML must use text/html." } });
    return;
  }
  const html = await requestTextBodyLimited(request, MAX_PREVIEW_PDF_HTML_BYTES);
  if (!html) { writeJson(response, 400, { ok: false, error: { code: "INVALID_REPORT_HTML", message: "Report HTML is required." } }); return; }
  const pdf = await renderPdf(html);
  response.statusCode = 200;
  response.setHeader("content-type", "application/pdf");
  response.setHeader("content-disposition", `attachment; filename="${pdfAttachmentFilename(request)}"`);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-energy-preview-pdf-renderer", "server");
  response.end(pdf);
}

async function proxyProductionApiReadOnly(request: IncomingMessage, response: ServerResponse, fetchImpl: typeof fetch): Promise<void> {
  const pathname = pathnameOf(request);
  if (!previewBridgeAllows(request.method, pathname)) {
    writeJson(response, 403, { ok: false, error: { code: "READ_ONLY_MODE", message: "Preview uses Production data in read-only mode." } });
    return;
  }

  const target = new URL(request.url ?? pathname, PRODUCTION_API_ORIGIN);
  const headers = new Headers();
  for (const name of ["accept", "content-type", "cookie", "x-csrf-token", "user-agent"]) {
    const value = request.headers[name];
    if (Array.isArray(value)) headers.set(name, value.join(", "));
    else if (typeof value === "string") headers.set(name, value);
  }
  // The bridge is server-to-server. Present the canonical Production origin to
  // the upstream CSRF/CORS policy while the browser remains same-origin to Preview.
  headers.set("origin", PRODUCTION_API_ORIGIN);
  headers.set("referer", `${PRODUCTION_API_ORIGIN}/`);

  const upstream = await fetchImpl(target, {
    method: request.method ?? "GET",
    headers,
    body: await requestBody(request),
    redirect: "manual"
  });

  response.statusCode = upstream.status;
  response.setHeader("cache-control", upstream.headers.get("cache-control") ?? "no-store");
  response.setHeader("x-energy-preview-data-source", "production-api-read-only");
  for (const name of ["content-type", "content-disposition", "location", "x-request-id"]) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  const cookieHeaders = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (cookieHeaders.length > 0) response.setHeader("set-cookie", cookieHeaders);
  else {
    const cookie = upstream.headers.get("set-cookie");
    if (cookie) response.setHeader("set-cookie", cookie);
  }
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

export function createVercelHandler(environment: NodeJS.ProcessEnv = process.env, createRuntime: RuntimeFactory = createConfiguredRuntime, fetchImpl: typeof fetch = fetch, renderPdf: PdfRenderer = defaultPdfRenderer): VercelNodeHandler {
  let runtimePromise: Promise<ConfiguredRuntime> | undefined;
  const getRuntime = (): Promise<ConfiguredRuntime> => {
    if (!runtimePromise) {
      runtimePromise = createRuntime(environment).catch(error => {
        runtimePromise = undefined;
        throw error;
      });
    }
    return runtimePromise;
  };

  return async (request, response) => {
    if ((request.method === "GET" || request.method === "HEAD") && pathnameOf(request) === "/api/v1/health") {
      writeHealth(response, request.method);
      return;
    }

    if (previewProductionBridgeEnabled(environment) && request.method === "POST" && pathnameOf(request) === PREVIEW_PDF_RENDER_PATH) {
      try { await renderPreviewPdf(request, response, fetchImpl, renderPdf); }
      catch (error) {
        if ((error as { code?: unknown })?.code === "PAYLOAD_TOO_LARGE") writeJson(response, 413, { ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Report HTML exceeds the permitted size." } });
        else writeJson(response, 503, { ok: false, error: { code: "PDF_RENDER_UNAVAILABLE", message: "The PDF renderer is temporarily unavailable." } });
      }
      return;
    }

    try {
      const runtime = await getRuntime();
      runtime.app(request, response);
    } catch (error) {
      if (error instanceof ConfigurationError && previewProductionBridgeEnabled(environment)) {
        try {
          await proxyProductionApiReadOnly(request, response, fetchImpl);
          return;
        } catch {
          writeJson(response, 503, { ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "The Production data bridge is unavailable." } });
          return;
        }
      }
      writeJson(response, 503, unavailablePayload(error, environment));
    }
  };
}

const handler = createVercelHandler();
export default handler;
