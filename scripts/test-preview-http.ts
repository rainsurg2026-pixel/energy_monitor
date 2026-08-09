/**
 * Network-only Preview integration gate.
 *
 * This deliberately uses HTTP/fetch rather than Browser/CDP. It reads the
 * existing development account passwords only in memory and never prints
 * credentials, cookies, response bodies, or tokens.
 *
 * Run from a network-enabled runner:
 *   PREVIEW_URL=https://energy-monitor-git-feat-web-v3-dcm15.vercel.app \
 *   npm run test:preview-http
 *
 * The normal-user checks use the fresh Development-only Preview UAT account
 * by default. Override PREVIEW_UAT_USERNAME/PREVIEW_UAT_PASSWORD when a
 * network-enabled runner uses another supported test account.
 */
type JsonObject = Record<string, unknown>;
type HttpResponse = { status: number; body: JsonObject | null };

function normalizePreviewUrl(rawValue: string): string {
  let value = rawValue.trim();
  if (!value) throw new Error("PREVIEW_URL_REQUIRED: set PREVIEW_URL to the current Vercel Preview URL.");
  if (!/^[a-z][a-z\d+.-]*:\/\//iu.test(value)) value = `https://${value}`;
  value = value.replace(/^(?:https?:\/\/)+/iu, "https://");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("PREVIEW_URL_INVALID: Preview URL must use HTTPS.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("PREVIEW_URL_INVALID: Preview URL must not contain credentials, query parameters, or a fragment.");
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed.toString().replace(/\/$/u, "");
}

const configuredPreviewUrl = process.env.PREVIEW_URL?.trim() || process.env.PREVIEW_BASE_URL?.trim();
const baseUrl = normalizePreviewUrl(configuredPreviewUrl ?? "");
const configuredPreviewOrigin = process.env.PREVIEW_ORIGIN?.trim();
const previewOrigin = configuredPreviewOrigin ? new URL(normalizePreviewUrl(configuredPreviewOrigin)).origin : undefined;
const adminPassword = process.env.DEV_ADMIN_PASSWORD;
const previewUatUsername = process.env.PREVIEW_UAT_USERNAME?.trim() || "previewuat";
const previewUatPassword = process.env.PREVIEW_UAT_PASSWORD ?? process.env.DEV_USER_PASSWORD;

function requiredCredential(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`PREVIEW_HTTP_CREDENTIALS_REQUIRED: ${name} must be available to the runner.`);
    process.exit(2);
  }
  return value;
}

const requiredAdminPassword = requiredCredential("DEV_ADMIN_PASSWORD", adminPassword);
const requiredPreviewUatPassword = requiredCredential("PREVIEW_UAT_PASSWORD or DEV_USER_PASSWORD", previewUatPassword);

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

async function request(path: string, jar = new CookieJar(), init: RequestInit = {}): Promise<HttpResponse> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  // Keep same-origin integration requests independent of the deploy-specific
  // CORS allow-list. Set PREVIEW_ORIGIN only when explicitly testing CORS.
  if (previewOrigin) headers.set("origin", previewOrigin);
  headers.set("user-agent", "energy-monitor-preview-http-gate/1");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
  jar.apply(response);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("json") ? await response.json() as JsonObject : null;
  return { status: response.status, body };
}

function dataOf(response: HttpResponse): JsonObject { return (response.body?.data as JsonObject | undefined) ?? {}; }
function errorCode(response: HttpResponse): string | null { return typeof response.body?.error === "object" && response.body.error !== null && "code" in response.body.error ? String((response.body.error as JsonObject).code) : null; }
function expect(name: string, condition: boolean, detail = ""): void {
  if (!condition) throw new Error(`${name}${detail ? ` (${detail})` : ""}`);
  console.log(`PASS ${name}`);
}

async function login(username: string, password: string): Promise<{ jar: CookieJar; user: JsonObject }> {
  const jar = new CookieJar();
  const csrf = await request("/api/v1/auth/csrf", jar);
  expect(`${username} CSRF endpoint`, csrf.status === 200, `status=${csrf.status}`);
  const response = await request("/api/v1/auth/login", jar, { method: "POST", body: JSON.stringify({ username, password }) });
  expect(`${username} login`, response.status === 200, `status=${response.status}`);
  const user = dataOf(response).user as JsonObject | undefined;
  expect(`${username} login returns safe user`, Boolean(user) && !JSON.stringify(user).toLowerCase().includes("password"));
  return { jar, user: user ?? {} };
}

async function main(): Promise<void> {
  const health = await request("/api/v1/health");
  expect("Preview health", health.status === 200);
  const ready = await request("/api/v1/readiness");
  expect("Preview readiness", ready.status === 200 && ready.body?.ok === true && dataOf(ready).status === "ready", `status=${ready.status}`);

  const unauthenticated = await request("/api/v1/bootstrap");
  expect("unauthenticated protected API returns 401", unauthenticated.status === 401 && errorCode(unauthenticated) === "UNAUTHORIZED");

  const admin = await login("admin", requiredAdminPassword);
  expect("admin login role is admin", admin.user.role === "admin");
  const adminSession = await request("/api/v1/auth/session", admin.jar);
  expect("admin session is authenticated", adminSession.status === 200 && dataOf(adminSession).authenticated === true);

  const user = await login(previewUatUsername, requiredPreviewUatPassword);
  expect(`${previewUatUsername} login role is user`, user.user.role === "user");
  const userSession = await request("/api/v1/auth/session", user.jar);
  expect(`${previewUatUsername} session is authenticated`, userSession.status === 200 && dataOf(userSession).authenticated === true);

  const adminUsers = await request("/api/v1/admin/users", admin.jar);
  const listedUsers = Array.isArray(adminUsers.body?.data) ? adminUsers.body.data : [];
  expect("admin can read User Management", adminUsers.status === 200 && listedUsers.some(item => (item as JsonObject).username === "admin"));
  expect("User Management exposes the Preview UAT user", listedUsers.some(item => (item as JsonObject).username === previewUatUsername));
  const userUsers = await request("/api/v1/admin/users", user.jar);
  expect("user is denied User Management", userUsers.status === 403 && errorCode(userUsers) === "FORBIDDEN");

  const bootstrap = await request("/api/v1/bootstrap", admin.jar);
  const bootstrapData = dataOf(bootstrap);
  const displayPeriod = bootstrapData.displayPeriod as JsonObject | undefined;
  expect("admin can read bootstrap", bootstrap.status === 200 && Boolean(displayPeriod));
  expect("Preview is server-side READ_ONLY_MODE", bootstrapData.readOnlyMode === true);
  expect("Preview Display Period is 2026-only", displayPeriod?.startMonth === "2026-01" && displayPeriod?.endMonth === "2026-12");

  const sites = Array.isArray(bootstrapData.sites) ? bootstrapData.sites as JsonObject[] : [];
  expect("bootstrap contains Rangsit and Srinakarin", sites.some(item => (item.site as JsonObject)?.code === "rangsit") && sites.some(item => (item.site as JsonObject)?.code === "srinakarin"));

  const readOnlySettings = await request("/api/v1/settings/display-period", admin.jar, {
    method: "PUT",
    headers: { "x-csrf-token": admin.jar.csrfToken() ?? "" },
    body: JSON.stringify({ start_month: "2026-01", end_month: "2026-12", expected_row_version: displayPeriod?.rowVersion ?? 0 })
  });
  expect("admin Display Period mutation is blocked in Preview", readOnlySettings.status === 423 && errorCode(readOnlySettings) === "READ_ONLY_MODE");
  const readOnlyUserCreate = await request("/api/v1/admin/users", admin.jar, {
    method: "POST",
    headers: { "x-csrf-token": admin.jar.csrfToken() ?? "" },
    body: JSON.stringify({ username: "preview-read-only-probe", display_name: "Read Only Probe", password: "synthetic-probe-value-not-a-credential", role: "user" })
  });
  expect("admin User Management mutation is blocked in Preview", readOnlyUserCreate.status === 423 && errorCode(readOnlyUserCreate) === "READ_ONLY_MODE");

  for (const siteState of sites) {
    const site = siteState.site as JsonObject | undefined;
    const siteId = site?.id;
    const code = site?.code;
    const latest = siteState.latestAvailableMonth;
    if (typeof siteId !== "number" || typeof code !== "string" || typeof latest !== "string") throw new Error("Bootstrap site state is incomplete.");
    const periods = await request(`/api/v1/periods?siteId=${siteId}`, admin.jar);
    const periodData = dataOf(periods);
    const availableMonths = Array.isArray(periodData.availableMonths) ? periodData.availableMonths as unknown[] : [];
    expect(`${code} periods endpoint`, periods.status === 200 && availableMonths.includes(latest));
    expect(`${code} API hides retained 2025 months`, availableMonths.every(month => !String(month).startsWith("2025-")));
    const hidden2025 = await request(`/api/v1/energy?siteId=${siteId}&month=2025-01`, admin.jar);
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
      const response = await request(path, admin.jar);
      expect(`${code} ${label} returns migrated data`, response.status === 200 && dataOf(response).siteId === siteId);
    }
  }
  const comparison = await request("/api/v1/site-comparison", admin.jar);
  const comparisonSites = Array.isArray(dataOf(comparison).sites) ? dataOf(comparison).sites as unknown[] : [];
  expect("Site Comparison returns migrated data", comparison.status === 200 && comparisonSites.length >= 2);

  const userLogout = await request("/api/v1/auth/logout", user.jar, { method: "POST", headers: { "x-csrf-token": user.jar.csrfToken() ?? "" } });
  expect(`${previewUatUsername} logout succeeds`, userLogout.status === 200);
  const userRevoked = await request("/api/v1/auth/session", user.jar);
  expect(`${previewUatUsername} session is revoked after logout`, userRevoked.status === 200 && dataOf(userRevoked).authenticated === false);
  const adminLogout = await request("/api/v1/auth/logout", admin.jar, { method: "POST", headers: { "x-csrf-token": admin.jar.csrfToken() ?? "" } });
  expect("admin logout succeeds", adminLogout.status === 200);
  const adminRevoked = await request("/api/v1/auth/session", admin.jar);
  expect("admin session is revoked after logout", adminRevoked.status === 200 && dataOf(adminRevoked).authenticated === false);
  const oldSessionDenied = await request("/api/v1/bootstrap", admin.jar);
  expect("revoked admin session cannot access protected API", oldSessionDenied.status === 401 && errorCode(oldSessionDenied) === "UNAUTHORIZED");

  console.log("PREVIEW_HTTP_PASS");
}

try {
  await main();
} catch (error) {
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: { code?: unknown } }).cause?.code : undefined;
  if (cause === "EACCES" || cause === "ECONNREFUSED" || cause === "ENOTFOUND" || cause === "ETIMEDOUT") {
    console.error(`PREVIEW_HTTP_ENVIRONMENT_UNAVAILABLE: ${String(cause)}`);
    process.exit(2);
  }
  console.error(`PREVIEW_HTTP_CHECK_FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}
