import { randomBytes } from "node:crypto";
import { config as loadDotEnv } from "dotenv";

export interface ServerConfig {
  databaseUrl: string | null;
  directDatabaseUrl: string | null;
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
  if (nodeEnv === "production") throw new ConfigurationError(`${name} is required in production.`);
  return randomBytes(32).toString("base64url");
}

function parseOrigins(value: string | undefined): string[] {
  return (value ?? "").split(",").map(item => item.trim()).filter(Boolean);
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  options: { requireDatabase?: boolean; requireRuntimeDatabase?: boolean; requireMigrationDatabase?: boolean } = {}
): ServerConfig {
  const nodeEnv = environment.NODE_ENV === "test" || environment.NODE_ENV === "production" ? environment.NODE_ENV : "development";
  const databaseUrl = environment.DATABASE_URL?.trim() || null;
  const directDatabaseUrl = environment.DIRECT_DATABASE_URL?.trim() || null;
  const requireDatabase = options.requireDatabase ?? true;
  const requireRuntimeDatabase = options.requireRuntimeDatabase ?? requireDatabase;
  const requireMigrationDatabase = options.requireMigrationDatabase ?? false;
  if (requireDatabase && !databaseUrl && !directDatabaseUrl) throw new ConfigurationError("DATABASE_URL or DIRECT_DATABASE_URL is required.");
  if (requireRuntimeDatabase && !databaseUrl) throw new ConfigurationError("DATABASE_URL is required for the API server.");
  if (requireMigrationDatabase && !directDatabaseUrl) throw new ConfigurationError("DIRECT_DATABASE_URL is required for the migration/admin path.");
  const portText = environment.PORT?.trim() || "3100";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigurationError("PORT must be an integer between 1 and 65535.");
  return {
    databaseUrl,
    directDatabaseUrl,
    nodeEnv,
    port,
    appOrigin: environment.APP_ORIGIN?.trim() || "http://localhost:3000",
    allowedOrigins: parseOrigins(environment.APP_ORIGINS || environment.APP_ORIGIN || "http://localhost:3000"),
    allowedPreviewOrigins: parseOrigins(environment.APP_PREVIEW_ORIGINS),
    trustProxy: parseBoolean(environment.TRUST_PROXY, "TRUST_PROXY"),
    sessionSecret: secretValue(environment, "SESSION_SECRET", nodeEnv),
    csrfSecret: secretValue(environment, "CSRF_SECRET", nodeEnv),
    sessionLifetimeMs: parsePositiveInteger(environment.SESSION_LIFETIME_MS, "SESSION_LIFETIME_MS", 8 * 60 * 60 * 1000),
    poolMax: parsePositiveInteger(environment.DB_POOL_MAX, "DB_POOL_MAX", 3),
    readOnlyMode: parseBoolean(environment.READ_ONLY_MODE, "READ_ONLY_MODE")
  };
}

export function loadDotEnvFile(): void { loadDotEnv(); }
