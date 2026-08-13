/**
 * Verifies a Postgres connection string actually targets the Production
 * Supabase project before any production-only script is allowed to write.
 * NODE_ENV=production is necessary but not sufficient - a stale
 * DIRECT_DATABASE_URL left over from a previous session would still say
 * NODE_ENV=production while pointed at Preview. This inspects only the
 * non-secret user/host segment of the connection string (never the
 * password) for the project's reference id.
 *
 * The accepted project ref is a hardcoded constant, not a parameter and
 * not read from argv/env - a caller cannot override which project counts
 * as "Production" by passing a flag.
 */
export const PRODUCTION_PROJECT_REF = "ajidkjzufpgyibagvvco";
export const PREVIEW_PROJECT_REF = "tofdgndrrpnnyhbuurbx";

export interface TargetVerification {
  ok: boolean;
  reason: string;
}

const CONNECTION_STRING_USER_HOST_RE = /^[a-zA-Z]+:\/\/([^:@/]+)(?::[^@]*)?@([^/]+)/;

export function verifyProductionEnvironment(nodeEnv: string | undefined): TargetVerification {
  if (nodeEnv !== "production") return { ok: false, reason: `NODE_ENV must be "production" (was: ${nodeEnv ?? "unset"}).` };
  return { ok: true, reason: "NODE_ENV=production." };
}

export function verifyProductionTarget(connectionString: string | null | undefined): TargetVerification {
  if (!connectionString) return { ok: false, reason: "No DIRECT_DATABASE_URL or DATABASE_URL is set." };
  const match = CONNECTION_STRING_USER_HOST_RE.exec(connectionString);
  if (!match) return { ok: false, reason: "Could not parse a host from the connection string." };
  const [, user, host] = match;
  const combined = `${user} ${host}`;
  if (combined.includes(PREVIEW_PROJECT_REF)) return { ok: false, reason: "This is the PREVIEW project, not Production. Refusing." };
  if (combined.includes(PRODUCTION_PROJECT_REF)) return { ok: true, reason: `Matches the Production project (${PRODUCTION_PROJECT_REF}).` };
  return { ok: false, reason: "Unrecognized project reference - not a known Production or Preview target. Refusing (fail closed)." };
}
