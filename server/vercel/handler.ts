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
  else if (error instanceof Error && error.message === "DATABASE_URL must use a non-superuser login role that is a member of energy_monitor_runtime.") payload.error.reason = "runtime-role";
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

export function createVercelHandler(environment: NodeJS.ProcessEnv = process.env, createRuntime: RuntimeFactory = createConfiguredRuntime): VercelNodeHandler {
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
      writeJson(response, 503, unavailablePayload(error, environment));
    }
  };
}

const handler = createVercelHandler();
export default handler;
