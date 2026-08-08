import { config as loadDotEnv } from "dotenv";

export interface ServerConfig {
  databaseUrl: string | null;
  nodeEnv: "development" | "test" | "production";
  port: number;
  appOrigin: string;
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

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  options: { requireDatabase?: boolean } = {}
): ServerConfig {
  const nodeEnv = environment.NODE_ENV === "test" || environment.NODE_ENV === "production" ? environment.NODE_ENV : "development";
  const databaseUrl = environment.DATABASE_URL?.trim() || null;
  if ((options.requireDatabase ?? true) && !databaseUrl) throw new ConfigurationError("DATABASE_URL is required for the API server.");
  const portText = environment.PORT?.trim() || "3100";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigurationError("PORT must be an integer between 1 and 65535.");
  return {
    databaseUrl,
    nodeEnv,
    port,
    appOrigin: environment.APP_ORIGIN?.trim() || "http://localhost:3000",
    readOnlyMode: parseBoolean(environment.READ_ONLY_MODE, "READ_ONLY_MODE")
  };
}

export function loadDotEnvFile(): void { loadDotEnv(); }
