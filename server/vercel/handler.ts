import type { IncomingMessage, ServerResponse } from "node:http";
import { ConfigurationError } from "../config/env";
import { API_HEALTH_RESPONSE } from "../http/health";
import { createConfiguredRuntime, type ConfiguredRuntime } from "../runtime";

type VercelNodeHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
type RuntimeFactory = (environment: NodeJS.ProcessEnv) => Promise<ConfiguredRuntime>;

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

function previewProductionBridgeEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment.VERCEL_ENV === "preview" && environment.VERCEL_GIT_COMMIT_REF === PRODUCTION_DATA_PREVIEW_BRANCH;
}

function previewBridgeAllows(method: string | undefined, pathname: string): boolean {
  const normalizedMethod = (method ?? "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) return true;
  return normalizedMethod === "POST" && (pathname === "/api/v1/auth/login" || pathname === "/api/v1/auth/logout");
}

async function requestBody(request: IncomingMessage): Promise<Uint8Array | undefined> {
  const method = (request.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  if (chunks.length === 0) return undefined;
  return new Uint8Array(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
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

export function createVercelHandler(environment: NodeJS.ProcessEnv = process.env, createRuntime: RuntimeFactory = createConfiguredRuntime, fetchImpl: typeof fetch = fetch): VercelNodeHandler {
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
