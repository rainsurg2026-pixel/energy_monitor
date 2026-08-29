/**
 * Verifies a Postgres connection string actually targets the known Production
 * Supabase project before a production-only script is allowed to write.
 *
 * The check is deliberately exact: a project reference embedded in an
 * arbitrary hostname is not sufficient, and the password is never included
 * in a result or error message.
 */
export const PRODUCTION_PROJECT_REF = "ajidkjzufpgyibagvvco";

export interface TargetVerification {
  ok: boolean;
  reason: string;
}

export interface ProductionEnvironmentOptions {
  vercelEnv?: string;
  readOnlyMode?: boolean;
}

export function verifyProductionEnvironment(
  nodeEnv: string | undefined,
  options: ProductionEnvironmentOptions = {}
): TargetVerification {
  if (nodeEnv !== "production") {
    return { ok: false, reason: 'NODE_ENV must be "production" (was: ' + (nodeEnv ?? "unset") + ")." };
  }
  if (options.vercelEnv && options.vercelEnv !== "production") {
    return { ok: false, reason: "Production-only operations cannot run from a non-Production Vercel deployment." };
  }
  if (options.readOnlyMode === true) {
    return { ok: false, reason: "Production-only operations cannot run while READ_ONLY_MODE=true." };
  }
  return { ok: true, reason: "NODE_ENV=production and a writable Production context." };
}

export function verifyProductionTarget(connectionString: string | null | undefined): TargetVerification {
  if (!connectionString) return { ok: false, reason: "No DIRECT_DATABASE_URL or DATABASE_URL is set." };

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { ok: false, reason: "Could not parse a host from the connection string." };
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return { ok: false, reason: "Connection string is not a PostgreSQL URL." };
  }

  const productionDirectHost = "db." + PRODUCTION_PROJECT_REF + ".supabase.co";
  const isProductionDirect = url.hostname === productionDirectHost && url.username === "postgres";
  const isProductionPooler =
    url.username === "postgres." + PRODUCTION_PROJECT_REF &&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(url.hostname);

  if (isProductionDirect || isProductionPooler) {
    return { ok: true, reason: "Matches the known Production Supabase target (" + PRODUCTION_PROJECT_REF + ")." };
  }

  return { ok: false, reason: "Unrecognized project reference or host - not the known Production target. Refusing (fail closed)." };
}
