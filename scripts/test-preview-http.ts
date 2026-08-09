/**
 * Network-only Preview integration gate.
 *
 * This deliberately uses HTTP/fetch rather than Browser/CDP. Credentials are
 * read only from environment variables, held only in memory, and never
 * appear in any log line - usernames included. Every log label uses a
 * static role name ("Admin"/"Secondary user"), never the actual username
 * value, and every console.log/console.error call is routed through
 * safeLog/safeError, which additionally scrub any cookie/token/authorization
 * header shape that could otherwise slip into a thrown error's message.
 *
 * Run from a network-enabled runner (locally or in CI):
 *   PREVIEW_URL=https://energy-monitor-git-feat-web-v3-dcm15.vercel.app \
 *   DEV_ADMIN_PASSWORD=... PREVIEW_UAT_PASSWORD=... \
 *   npm run test:preview-http
 *
 * See docs/web-v3/PREVIEW_VERIFICATION.md for the full environment variable
 * reference and the CI recipe (.github/workflows/preview-verification.yml).
 *
 * The normal-user checks use the fresh Development-only Preview UAT account
 * by default. PREVIEW_UAT_PASSWORD is required for previewuat; the legacy
 * DEV_USER_PASSWORD fallback is retained only when PREVIEW_UAT_USERNAME is
 * explicitly set to the old usertest account.
 *
 * Exit codes: 0 = every check passed. 1 = at least one check failed. 2 =
 * required configuration/credentials are missing, or the environment itself
 * (DNS/connection/permissions) is unreachable - neither is a check failure.
 * All three paths are handled uniformly below; nothing in this file can
 * throw before entering that handling (config loading included).
 */
import { safeLog, safeError } from "./lib/redactLog";

type JsonObject = Record<string, unknown>;
type HttpResponse = { status: number; body: JsonObject | null };

/** Distinguishes "you configured this wrong" (exit 2) from "a check
 *  actually failed against a correctly configured target" (exit 1). */
class ConfigError extends Error {}

interface RunConfig {
  baseUrl: string;
  previewOrigin: string | undefined;
  adminPassword: string;
  previewUatUsername: string;
  previewUatPassword: string;
}

function normalizePreviewUrl(rawValue: string): string {
  let value = rawValue.trim();
  if (!value) throw new ConfigError("PREVIEW_URL_REQUIRED: set PREVIEW_URL to the current Vercel Preview URL.");
  if (!/^[a-z][a-z\d+.-]*:\/\//iu.test(value)) value = `https://${value}`;
  value = value.replace(/^(?:https?:\/\/)+/iu, "https://");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError("PREVIEW_URL_INVALID: PREVIEW_URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:") throw new ConfigError("PREVIEW_URL_INVALID: Preview URL must use HTTPS.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new ConfigError("PREVIEW_URL_INVALID: Preview URL must not contain credentials, query parameters, or a fragment.");
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed.toString().replace(/\/$/u, "");
}

function requiredCredential(name: string, value: string | undefined): string {
  if (!value) throw new ConfigError(`PREVIEW_HTTP_CREDENTIALS_REQUIRED: ${name} must be available to the runner.`);
  return value;
}

/** All environment reading and validation happens here, and only here -
 *  called from inside the same try/catch that handles check failures, so a
 *  missing/invalid env var produces the same controlled
 *  safeError+exit(2) path as any other configuration problem, never an
 *  uncaught exception with a raw stack trace. */
function loadConfig(): RunConfig {
  const configuredPreviewUrl = process.env.PREVIEW_URL?.trim() || process.env.PREVIEW_BASE_URL?.trim();
  const baseUrl = normalizePreviewUrl(configuredPreviewUrl ?? "");
  const configuredPreviewOrigin = process.env.PREVIEW_ORIGIN?.trim();
  const previewOrigin = configuredPreviewOrigin ? new URL(normalizePreviewUrl(configuredPreviewOrigin)).origin : undefined;
  const adminPassword = requiredCredential("DEV_ADMIN_PASSWORD", process.env.DEV_ADMIN_PASSWORD);
  const configuredPreviewUatUsername = process.env.PREVIEW_UAT_USERNAME?.trim();
  const previewUatUsername = configuredPreviewUatUsername || "previewuat";
  const previewUatIsLegacyUsertest = previewUatUsername.toLowerCase() === "usertest";
  const previewUatPassword = requiredCredential(
    previewUatIsLegacyUsertest ? "PREVIEW_UAT_PASSWORD or DEV_USER_PASSWORD" : "PREVIEW_UAT_PASSWORD",
    process.env.PREVIEW_UAT_PASSWORD ?? (previewUatIsLegacyUsertest ? process.env.DEV_USER_PASSWORD : undefined)
  );
  return { baseUrl, previewOrigin, adminPassword, previewUatUsername, previewUatPassword };
}

class CookieJar {
  private readonly values = new Map<string, string>();

  apply(response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (response.headers.get("set-cookie") ?? "").split(/,(?=[^;]+?=)/);
    for (const value of setCookies) {
      const first = value.split(";", 1)[0]?.trim();
      if (!first) continue;
      const separator = first.indexOf("=");
      if (separator < 1) continue;
      const name = first.slice(0, separator);
      const cookieValue = first.slice(separator + 1);
      if (cookieValue.length === 0) this.values.delete(name);
      else this.values.set(name, cookieValue);
    }
  }

  header(): string { return [...this.values].map(([name, value]) => `${name}=${value}`).join("; "); }

  csrfToken(): string | undefined {
    const value = this.values.get("em_csrf");
    return value ? decodeURIComponent(value) : undefined;
  }
}

async function request(config: RunConfig, path: string, jar = new CookieJar(), init: RequestInit = {}): Promise<HttpResponse> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  // Keep same-origin integration requests independent of the deploy-specific
  // CORS allow-list. Set PREVIEW_ORIGIN only when explicitly testing CORS.
  if (config.previewOrigin) headers.set("origin", config.previewOrigin);
  headers.set("user-agent", "energy-monitor-preview-http-gate/1");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${config.baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
  jar.apply(response);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("json") ? await response.json() as JsonObject : null;
  return { status: response.status, body };
}

function dataOf(response: HttpResponse): JsonObject { return (response.body?.data as JsonObject | undefined) ?? {}; }
function errorCode(response: HttpResponse): string | null { return typeof response.body?.error === "object" && response.body.error !== null && "code" in response.body.error ? String((response.body.error as JsonObject).code) : null; }
function expect(name: string, condition: boolean, detail = ""): void {
  if (!condition) throw new Error(`${name}${detail ? ` (${detail})` : ""}`);
  safeLog(`PASS ${name}`);
}

/**
 * `label` is a fixed, non-secret display name ("Admin", "Secondary user")
 * used in every log line for this account. The actual `username` value
 * (which may come from PREVIEW_UAT_USERNAME) is sent in the request body,
 * never logged.
 */
async function login(config: RunConfig, label: string, username: string, password: string): Promise<{ jar: CookieJar; user: JsonObject }> {
  const jar = new CookieJar();
  const csrf = await request(config, "/api/v1/auth/csrf", jar);
  expect(`${label} CSRF endpoint`, csrf.status === 200, `status=${csrf.status}`);
  const response = await request(config, "/api/v1/auth/login", jar, { method: "POST", body: JSON.stringify({ username, password }) });
  expect(`${label} login`, response.status === 200, `status=${response.status}`);
  const user = dataOf(response).user as JsonObject | undefined;
  expect(`${label} login returns safe user`, Boolean(user) && !JSON.stringify(user).toLowerCase().includes("password"));
  return { jar, user: user ?? {} };
}

async function main(config: RunConfig): Promise<void> {
  const health = await request(config, "/api/v1/health");
  expect("Preview health", health.status === 200);
  const ready = await request(config, "/api/v1/readiness");
  expect("Preview readiness", ready.status === 200 && ready.body?.ok === true && dataOf(ready).status === "ready", `status=${ready.status}`);

  const unauthenticated = await request(config, "/api/v1/bootstrap");
  expect("unauthenticated protected API returns 401", unauthenticated.status === 401 && errorCode(unauthenticated) === "UNAUTHORIZED");

  const admin = await login(config, "Admin", "admin", config.adminPassword);
  expect("Admin login role is admin", admin.user.role === "admin");
  const adminSession = await request(config, "/api/v1/auth/session", admin.jar);
  expect("Admin session is authenticated", adminSession.status === 200 && dataOf(adminSession).authenticated === true);

  const user = await login(config, "Secondary user", config.previewUatUsername, config.previewUatPassword);
  expect("Secondary user login role is user", user.user.role === "user");
  const userSession = await request(config, "/api/v1/auth/session", user.jar);
  expect("Secondary user session is authenticated", userSession.status === 200 && dataOf(userSession).authenticated === true);

  const adminUsers = await request(config, "/api/v1/admin/users", admin.jar);
  const listedUsers = Array.isArray(adminUsers.body?.data) ? adminUsers.body.data : [];
  expect("Admin can read User Management", adminUsers.status === 200 && listedUsers.some(item => (item as JsonObject).username === "admin"));
  expect("User Management exposes the Preview UAT user", listedUsers.some(item => (item as JsonObject).username === config.previewUatUsername));
  const userUsers = await request(config, "/api/v1/admin/users", user.jar);
  expect("Secondary user is denied User Management", userUsers.status === 403 && errorCode(userUsers) === "FORBIDDEN");

  const bootstrap = await request(config, "/api/v1/bootstrap", admin.jar);
  const bootstrapData = dataOf(bootstrap);
  const displayPeriod = bootstrapData.displayPeriod as JsonObject | undefined;
  expect("Admin can read bootstrap", bootstrap.status === 200 && Boolean(displayPeriod));
  expect("Preview is server-side READ_ONLY_MODE", bootstrapData.readOnlyMode === true);
  expect("Preview Display Period is 2026-only", displayPeriod?.startMonth === "2026-01" && displayPeriod?.endMonth === "2026-12");

  const sites = Array.isArray(bootstrapData.sites) ? bootstrapData.sites as JsonObject[] : [];
  expect("bootstrap contains Rangsit and Srinakarin", sites.some(item => (item.site as JsonObject)?.code === "rangsit") && sites.some(item => (item.site as JsonObject)?.code === "srinakarin"));

  const readOnlySettings = await request(config, "/api/v1/settings/display-period", admin.jar, {
    method: "PUT",
    headers: { "x-csrf-token": admin.jar.csrfToken() ?? "" },
    body: JSON.stringify({ start_month: "2026-01", end_month: "2026-12", expected_row_version: displayPeriod?.rowVersion ?? 0 })
  });
  expect("Admin Display Period mutation is blocked in Preview", readOnlySettings.status === 423 && errorCode(readOnlySettings) === "READ_ONLY_MODE");
  const readOnlyUserCreate = await request(config, "/api/v1/admin/users", admin.jar, {
    method: "POST",
    headers: { "x-csrf-token": admin.jar.csrfToken() ?? "" },
    body: JSON.stringify({ username: "preview-read-only-probe", display_name: "Read Only Probe", password: "synthetic-probe-value-not-a-credential", role: "user" })
  });
  expect("Admin User Management mutation is blocked in Preview", readOnlyUserCreate.status === 423 && errorCode(readOnlyUserCreate) === "READ_ONLY_MODE");

  for (const siteState of sites) {
    const site = siteState.site as JsonObject | undefined;
    const siteId = site?.id;
    const code = site?.code;
    const latest = siteState.latestAvailableMonth;
    if (typeof siteId !== "number" || typeof code !== "string" || typeof latest !== "string") throw new Error("Bootstrap site state is incomplete.");
    const periods = await request(config, `/api/v1/periods?siteId=${siteId}`, admin.jar);
    const periodData = dataOf(periods);
    const availableMonths = Array.isArray(periodData.availableMonths) ? periodData.availableMonths as unknown[] : [];
    expect(`${code} periods endpoint`, periods.status === 200 && availableMonths.includes(latest));
    expect(`${code} API hides retained 2025 months`, availableMonths.every(month => !String(month).startsWith("2025-")));
    const hidden2025 = await request(config, `/api/v1/energy?siteId=${siteId}&month=2025-01`, admin.jar);
    expect(`${code} 2025 month is outside normal API range`, hidden2025.status === 404 && errorCode(hidden2025) === "MONTH_OUTSIDE_DISPLAY_PERIOD");

    for (const [label, path] of [
      ["Dashboard", `/api/v1/dashboard?siteId=${siteId}&month=${latest}`],
      ["Energy", `/api/v1/energy?siteId=${siteId}&month=${latest}`],
      ["Cost", `/api/v1/cost?siteId=${siteId}&month=${latest}`],
      ["Electrical", `/api/v1/electrical?siteId=${siteId}&month=${latest}`],
      ["Rack", `/api/v1/racks?siteId=${siteId}&month=${latest}`],
      ["Rack Unit", `/api/v1/rack-unit-capacity?siteId=${siteId}&month=${latest}`],
      ["Monthly log", `/api/v1/sites/${siteId}/periods/${latest}`]
    ] as const) {
      const response = await request(config, path, admin.jar);
      expect(`${code} ${label} returns migrated data`, response.status === 200 && dataOf(response).siteId === siteId);
    }
  }
  const comparison = await request(config, "/api/v1/site-comparison", admin.jar);
  const comparisonSites = Array.isArray(dataOf(comparison).sites) ? dataOf(comparison).sites as unknown[] : [];
  expect("Site Comparison returns migrated data", comparison.status === 200 && comparisonSites.length >= 2);

  const userLogout = await request(config, "/api/v1/auth/logout", user.jar, { method: "POST", headers: { "x-csrf-token": user.jar.csrfToken() ?? "" } });
  expect("Secondary user logout succeeds", userLogout.status === 200);
  const userRevoked = await request(config, "/api/v1/auth/session", user.jar);
  expect("Secondary user session is revoked after logout", userRevoked.status === 200 && dataOf(userRevoked).authenticated === false);
  const adminLogout = await request(config, "/api/v1/auth/logout", admin.jar, { method: "POST", headers: { "x-csrf-token": admin.jar.csrfToken() ?? "" } });
  expect("Admin logout succeeds", adminLogout.status === 200);
  const adminRevoked = await request(config, "/api/v1/auth/session", admin.jar);
  expect("Admin session is revoked after logout", adminRevoked.status === 200 && dataOf(adminRevoked).authenticated === false);
  const oldSessionDenied = await request(config, "/api/v1/bootstrap", admin.jar);
  expect("revoked admin session cannot access protected API", oldSessionDenied.status === 401 && errorCode(oldSessionDenied) === "UNAUTHORIZED");

  safeLog("PREVIEW_HTTP_PASS");
}

async function run(): Promise<void> {
  const config = loadConfig();
  await main(config);
}

try {
  await run();
  process.exit(0);
} catch (error) {
  if (error instanceof ConfigError) {
    safeError(error.message);
    process.exit(2);
  }
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: { code?: unknown } }).cause?.code : undefined;
  if (cause === "EACCES" || cause === "ECONNREFUSED" || cause === "ENOTFOUND" || cause === "ETIMEDOUT") {
    safeError(`PREVIEW_HTTP_ENVIRONMENT_UNAVAILABLE: ${String(cause)}`);
    process.exit(2);
  }
  safeError(`PREVIEW_HTTP_CHECK_FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}
