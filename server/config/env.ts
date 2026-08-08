import { randomBytes } from "node:crypto";
import { config as loadDotEnv } from "dotenv";

export interface ServerConfig {
  databaseUrl: string | null;
  directDatabaseUrl: string | null;
  databaseCaCertificate?: string | null;
  nodeEnv: "development" | "test" | "production";
  port: number;
  appOrigin: string;
  allowedOrigins: string[];
  allowedPreviewOrigins: string[];
  trustProxy: boolean;
  sessionSecret: string;
  csrfSecret: string;
  sessionLifetimeMs: number;
  poolMax: number;
  readOnlyMode: boolean;
}

export class ConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR";
}

function parseBoolean(value: string | undefined, name: string, fallback = false): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ConfigurationError(`${name} must be true or false.`);
}

function parsePositiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ConfigurationError(`${name} must be a positive integer.`);
  return parsed;
}

function secretValue(environment: NodeJS.ProcessEnv, name: string, nodeEnv: ServerConfig["nodeEnv"]): string {
  const value = environment[name]?.trim();
  if (value) {
    if (value.length < 32) throw new ConfigurationError(`${name} must contain at least 32 characters.`);
    return value;
  }
  if (nodeEnv === "production" || isVercelEnvironment(environment)) throw new ConfigurationError(`${name} is required for a hosted server.`);
  return randomBytes(32).toString("base64url");
}

function parseOrigins(value: string | undefined): string[] {
  return (value ?? "").split(",").map(item => item.trim()).filter(Boolean);
}

function databaseCaCertificate(environment: NodeJS.ProcessEnv, required: boolean): string | null {
  // Vercel environment variables can contain either literal newlines or escaped
  // newlines. Normalize only in memory; this value is never exposed to clients.
  const value = environment.SUPABASE_DB_CA_CERT?.trim().replace(/\\n/g, "\n") || null;
  if (required && !value) throw new ConfigurationError("SUPABASE_DB_CA_CERT is required for a hosted API database connection.");
  if (value && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(value)) {
    throw new ConfigurationError("SUPABASE_DB_CA_CERT must contain a PEM certificate.");
  }
  return value;
}

export function isVercelEnvironment(environment: NodeJS.ProcessEnv): boolean {
  return environment.VERCEL === "1" || Boolean(environment.VERCEL_ENV?.trim());
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  options: { requireDatabase?: boolean; requireRuntimeDatabase?: boolean; requireMigrationDatabase?: boolean } = {}
): ServerConfig {
  const nodeEnv = environment.NODE_ENV === "test" || environment.NODE_ENV === "production" ? environment.NODE_ENV : "development";
  const hosted = isVercelEnvironment(environment);
  const databaseUrl = environment.DATABASE_URL?.trim() || null;
  const directDatabaseUrl = environment.DIRECT_DATABASE_URL?.trim() || null;
  const requireDatabase = options.requireDatabase ?? true;
  const requireRuntimeDatabase = options.requireRuntimeDatabase ?? requireDatabase;
  const requireMigrationDatabase = options.requireMigrationDatabase ?? false;
  if (requireDatabase && !databaseUrl && !directDatabaseUrl) throw new ConfigurationError("DATABASE_URL or DIRECT_DATABASE_URL is required.");
  if (requireRuntimeDatabase && !databaseUrl) throw new ConfigurationError("DATABASE_URL is required for the API server.");
  if (requireMigrationDatabase && !directDatabaseUrl) throw new ConfigurationError("DIRECT_DATABASE_URL is required for the migration/admin path.");
  if (hosted && nodeEnv !== "production") throw new ConfigurationError("NODE_ENV=production is required for a hosted server.");
  const caCertificate = databaseCaCertificate(environment, hosted && requireRuntimeDatabase);
  const appOrigin = environment.APP_ORIGIN?.trim() || "";
  if (hosted && !appOrigin) throw new ConfigurationError("APP_ORIGIN is required for a hosted server.");
  if (hosted && environment.TRUST_PROXY !== "true") throw new ConfigurationError("TRUST_PROXY=true is required for a hosted server.");
  if (environment.VERCEL_ENV === "preview" && environment.READ_ONLY_MODE !== "true") throw new ConfigurationError("READ_ONLY_MODE=true is required for a Preview server.");
  const portText = environment.PORT?.trim() || "3100";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigurationError("PORT must be an integer between 1 and 65535.");
  const poolMax = parsePositiveInteger(environment.DB_POOL_MAX, "DB_POOL_MAX", 3);
  if (hosted && poolMax > 10) throw new ConfigurationError("DB_POOL_MAX must not exceed 10 on a hosted server.");
  return {
    databaseUrl,
    directDatabaseUrl,
    databaseCaCertificate: caCertificate,
    nodeEnv,
    port,
    appOrigin: appOrigin || "http://localhost:3000",
    allowedOrigins: parseOrigins(environment.APP_ORIGINS || appOrigin || "http://localhost:3000"),
    allowedPreviewOrigins: parseOrigins(environment.APP_PREVIEW_ORIGINS),
    trustProxy: parseBoolean(environment.TRUST_PROXY, "TRUST_PROXY"),
    sessionSecret: secretValue(environment, "SESSION_SECRET", nodeEnv),
    csrfSecret: secretValue(environment, "CSRF_SECRET", nodeEnv),
    sessionLifetimeMs: parsePositiveInteger(environment.SESSION_LIFETIME_MS, "SESSION_LIFETIME_MS", 8 * 60 * 60 * 1000),
    poolMax,
    readOnlyMode: parseBoolean(environment.READ_ONLY_MODE, "READ_ONLY_MODE")
  };
}

export function loadDotEnvFile(): void { loadDotEnv(); }
