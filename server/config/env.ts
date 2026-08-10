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
  supabaseUrl?: string | null;
  supabaseServiceRoleKey?: string | null;
  workbookStorageBucket?: string;
  imageStorageBucket?: string;
  googleClientId: string | null;
  googleClientSecret: string | null;
  googleRedirectUri: string | null;
  googleTokenEncryptionKey: string | null;
  googleSuccessRedirect: string;
}

export class ConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR";
}

function requireAbsoluteUrl(value: string, name: string, protocol?: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(`${name} must be an absolute URL.`);
  }
  if (protocol && parsed.protocol !== protocol) throw new ConfigurationError(`${name} must use ${protocol.replace(":", "")} for a hosted server.`);
  return value;
}

function requirePostgresUrl(value: string, name: string, requiredPort?: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(`${name} must be a PostgreSQL URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new ConfigurationError(`${name} must be a PostgreSQL URL.`);
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") throw new ConfigurationError(`${name} must include a PostgreSQL host and database.`);
  if (requiredPort && parsed.port !== requiredPort) {
    throw new ConfigurationError(`${name} must use the Supabase Transaction Pooler port ${requiredPort} for a hosted runtime.`);
  }
  return value;
}

function requireStorageBucket(value: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(value)) throw new ConfigurationError(`${name} must be a valid Storage bucket name.`);
  return value;
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

/**
 * Every Vercel deployment - Production or Preview - receives its OWN
 * correct hostname(s) as environment variables at boot: VERCEL_URL (the
 * unique, deployment-specific hostname) and VERCEL_BRANCH_URL (the stable
 * git-branch alias, when the project is Git-connected). Trusting these is
 * exact-match and self-referential - a given deployment only ever learns
 * its own hostname this way, never another deployment's or another
 * project's - so it requires no manual APP_PREVIEW_ORIGINS maintenance per
 * branch/deployment and cannot be broadened into a wildcard by construction.
 * This is deliberately preferred over a `*.vercel.app` pattern match: it
 * achieves the same goal (every Preview URL for this app works) with a
 * strictly tighter trust boundary (this exact deployment only, not "any
 * Vercel-hosted app"), which matters because CORS-allowed origins can read
 * authenticated GET responses (CSRF protection on mutations is a separate,
 * unaffected layer - see csrf.ts - but read exposure is real).
 */
function vercelSelfOrigins(environment: NodeJS.ProcessEnv): string[] {
  return [environment.VERCEL_URL, environment.VERCEL_BRANCH_URL]
    .map(host => host?.trim())
    .filter((host): host is string => Boolean(host))
    .map(host => `https://${host}`);
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
  options: { requireDatabase?: boolean; requireRuntimeDatabase?: boolean; requireMigrationDatabase?: boolean; requireStorage?: boolean } = {}
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
  if (requireMigrationDatabase && !directDatabaseUrl && !databaseUrl) throw new ConfigurationError("DIRECT_DATABASE_URL or DATABASE_URL is required for the migration/admin path.");
  if (databaseUrl) requirePostgresUrl(databaseUrl, "DATABASE_URL", hosted && requireRuntimeDatabase ? "6543" : undefined);
  if (directDatabaseUrl) requirePostgresUrl(directDatabaseUrl, "DIRECT_DATABASE_URL");
  if (hosted && nodeEnv !== "production") throw new ConfigurationError("NODE_ENV=production is required for a hosted server.");
  const managedMigrationFallback = requireMigrationDatabase && !directDatabaseUrl && Boolean(databaseUrl);
  const caCertificate = databaseCaCertificate(environment, (hosted && requireRuntimeDatabase) || managedMigrationFallback);
  const appOrigin = environment.APP_ORIGIN?.trim() || "";
  if (hosted && !appOrigin) throw new ConfigurationError("APP_ORIGIN is required for a hosted server.");
  if (hosted && appOrigin) requireAbsoluteUrl(appOrigin, "APP_ORIGIN", "https:");
  if (hosted && environment.TRUST_PROXY !== "true") throw new ConfigurationError("TRUST_PROXY=true is required for a hosted server.");
  if (environment.VERCEL_ENV === "preview" && environment.READ_ONLY_MODE !== "true") throw new ConfigurationError("READ_ONLY_MODE=true is required for a Preview server.");
  const portText = environment.PORT?.trim() || "3100";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigurationError("PORT must be an integer between 1 and 65535.");
  const poolMax = parsePositiveInteger(environment.DB_POOL_MAX, "DB_POOL_MAX", 3);
  if (hosted && poolMax > 10) throw new ConfigurationError("DB_POOL_MAX must not exceed 10 on a hosted server.");
  const googleClientId = environment.GOOGLE_CLIENT_ID?.trim() || null;
  const googleClientSecret = environment.GOOGLE_CLIENT_SECRET?.trim() || null;
  const googleRedirectUri = environment.GOOGLE_OAUTH_REDIRECT_URI?.trim() || (googleClientId ? `${appOrigin || "http://localhost:3000"}/api/v1/google-sheets/auth/callback` : null);
  const googleTokenEncryptionKey = environment.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim() || null;
  const googleConfigured = Boolean(googleClientId || googleClientSecret || googleTokenEncryptionKey || environment.GOOGLE_OAUTH_REDIRECT_URI?.trim());
  if (googleConfigured && (!googleClientId || !googleClientSecret || !googleRedirectUri || !googleTokenEncryptionKey)) {
    throw new ConfigurationError("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI and GOOGLE_TOKEN_ENCRYPTION_KEY must be configured together.");
  }
  if (googleTokenEncryptionKey && googleTokenEncryptionKey.length < 32) throw new ConfigurationError("GOOGLE_TOKEN_ENCRYPTION_KEY must contain at least 32 characters.");
  const googleSuccessRedirect = environment.GOOGLE_OAUTH_SUCCESS_REDIRECT?.trim() || `${appOrigin || "http://localhost:3000"}/settings/google-sheets`;
  try {
    const parsed = new URL(googleSuccessRedirect);
    if (hosted && parsed.protocol !== "https:") throw new ConfigurationError("GOOGLE_OAUTH_SUCCESS_REDIRECT must use HTTPS for a hosted server.");
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError("GOOGLE_OAUTH_SUCCESS_REDIRECT must be an absolute URL.");
  }
  if (googleConfigured && googleRedirectUri) requireAbsoluteUrl(googleRedirectUri, "GOOGLE_OAUTH_REDIRECT_URI", hosted ? "https:" : undefined);
  const supabaseUrl = environment.SUPABASE_URL?.trim() || null;
  const supabaseServiceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
  const workbookStorageBucket = environment.SUPABASE_WORKBOOK_BUCKET?.trim() || null;
  const imageStorageBucket = environment.SUPABASE_IMAGE_BUCKET?.trim() || null;
  if (supabaseUrl) requireAbsoluteUrl(supabaseUrl, "SUPABASE_URL", "https:");
  if (options.requireStorage) {
    if (!supabaseUrl) throw new ConfigurationError("SUPABASE_URL is required for hosted Storage.");
    if (!supabaseServiceRoleKey) throw new ConfigurationError("SUPABASE_SERVICE_ROLE_KEY is required for hosted Storage.");
    if (!workbookStorageBucket) throw new ConfigurationError("SUPABASE_WORKBOOK_BUCKET is required for hosted Storage.");
    if (!imageStorageBucket) throw new ConfigurationError("SUPABASE_IMAGE_BUCKET is required for hosted Storage.");
  }
  if (workbookStorageBucket) requireStorageBucket(workbookStorageBucket, "SUPABASE_WORKBOOK_BUCKET");
  if (imageStorageBucket) requireStorageBucket(imageStorageBucket, "SUPABASE_IMAGE_BUCKET");
  const sessionSecret = secretValue(environment, "SESSION_SECRET", nodeEnv);
  const csrfSecret = secretValue(environment, "CSRF_SECRET", nodeEnv);
  if (sessionSecret === csrfSecret) throw new ConfigurationError("SESSION_SECRET and CSRF_SECRET must be different.");
  return {
    databaseUrl,
    directDatabaseUrl,
    databaseCaCertificate: caCertificate,
    nodeEnv,
    port,
    appOrigin: appOrigin || "http://localhost:3000",
    allowedOrigins: parseOrigins(environment.APP_ORIGINS || appOrigin || "http://localhost:3000"),
    allowedPreviewOrigins: [...parseOrigins(environment.APP_PREVIEW_ORIGINS), ...(hosted ? vercelSelfOrigins(environment) : [])],
    trustProxy: parseBoolean(environment.TRUST_PROXY, "TRUST_PROXY"),
    sessionSecret,
    csrfSecret,
    sessionLifetimeMs: parsePositiveInteger(environment.SESSION_LIFETIME_MS, "SESSION_LIFETIME_MS", 8 * 60 * 60 * 1000),
    poolMax,
    readOnlyMode: parseBoolean(environment.READ_ONLY_MODE, "READ_ONLY_MODE"),
    supabaseUrl,
    supabaseServiceRoleKey,
    workbookStorageBucket: workbookStorageBucket || "workbooks",
    imageStorageBucket: imageStorageBucket || "rack-unit-images",
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    googleTokenEncryptionKey,
    googleSuccessRedirect
  };
}

export function loadDotEnvFile(): void { loadDotEnv(); }
