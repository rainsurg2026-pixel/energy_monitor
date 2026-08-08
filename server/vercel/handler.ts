import type { IncomingMessage, ServerResponse } from "node:http";
import { API_HEALTH_RESPONSE } from "../http/health";
import { createConfiguredRuntime, type ConfiguredRuntime } from "../runtime";

type VercelNodeHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

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

export function createVercelHandler(environment: NodeJS.ProcessEnv = process.env): VercelNodeHandler {
  let runtimePromise: Promise<ConfiguredRuntime> | undefined;
  const getRuntime = (): Promise<ConfiguredRuntime> => {
    runtimePromise ??= createConfiguredRuntime(environment);
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
    } catch {
      writeJson(response, 503, { ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "The API service is unavailable." } });
    }
  };
}

const handler = createVercelHandler();
export default handler;
