import assert from "node:assert/strict";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { runBackup, testBackupConnection } from "../server/backup/backupService";
import { isAuthorizedCronRequest } from "../server/backup/backupConfig";
import { canonicalSheetUrl, extractSpreadsheetId, maskSpreadsheetId } from "../server/backup/googleSheetsUrl";
import { encryptSecret, decryptSecret, TokenDecryptionError, makeCodeVerifier, makeCodeChallenge, makeOAuthState, hashState } from "../server/backup/googleOAuthCrypto";
import { loadGoogleOAuthClientConfig, buildAuthorizationUrl, type GoogleOAuthClientConfig } from "../server/backup/googleOAuthClient";
import type { BackupConfigRecord } from "../server/repositories/contracts";
import { fixtureLog } from "../server/testFixtures";

let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

// --- URL validation and spreadsheet ID extraction (server-side only - the
// task's own requirement: never trust a browser-supplied ID independent of
// the URL it claims to come from). Unaffected by the OAuth migration. ---
const validUrl = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit#gid=0";
check("a valid Google Sheets URL is parsed to its spreadsheet ID", extractSpreadsheetId(validUrl) === "1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890");
check("the ID survives without query/fragment noise", extractSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890") === "1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890");
for (const [label, badUrl] of [
  ["http (not https)", "http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit"],
  ["wrong domain", "https://evil.example.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit"],
  ["unrelated Google URL", "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit"],
  ["not a URL at all", "not-a-url"],
  ["a completely unrelated external URL", "https://example.com/whatever"]
] as const) {
  check(`rejects ${label}`, (() => { try { extractSpreadsheetId(badUrl); return false; } catch { return true; } })());
}
check("canonicalSheetUrl round-trips to a stable, extractable form", extractSpreadsheetId(canonicalSheetUrl("1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890")) === "1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890");
check("spreadsheet IDs are masked, never shown in full, for audit/log purposes", maskSpreadsheetId("1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890") === "1AbC…7890" && !maskSpreadsheetId("1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890").includes("EfGhIjKl"));

// --- Cron authorization: shared-secret bearer header only, never a session. ---
check("cron request without CRON_SECRET configured is never authorized", !isAuthorizedCronRequest("Bearer anything", {}));
check("cron request with the correct bearer token is authorized", isAuthorizedCronRequest("Bearer correct-secret", { CRON_SECRET: "correct-secret" }));
check("cron request with the wrong bearer token is rejected", !isAuthorizedCronRequest("Bearer wrong-secret", { CRON_SECRET: "correct-secret" }));

// --- Google OAuth client config: env-only, never blocks startup, redirect
// URI is always built from the app's own trusted origin. ---
check("OAuth client config is null when client id/secret are unset", loadGoogleOAuthClientConfig("https://app.example") === null);
check("OAuth client config is null when appOrigin is empty", loadGoogleOAuthClientConfig("", { GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret" }) === null);
const loadedOauthConfig = loadGoogleOAuthClientConfig("https://app.example/", { GOOGLE_OAUTH_CLIENT_ID: "test-client-id", GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret" });
check("OAuth client config loads when all three are present", loadedOauthConfig !== null);
check("the redirect URI is derived from appOrigin, trailing slash stripped, never a second independently-parsed origin", loadedOauthConfig?.redirectUri === "https://app.example/api/v1/admin/backup/google/callback");

const TEST_OAUTH_CONFIG: GoogleOAuthClientConfig = { clientId: "test-client-id", clientSecret: "test-client-secret", redirectUri: "https://app.example/api/v1/admin/backup/google/callback" };
const authorizationUrl = buildAuthorizationUrl(TEST_OAUTH_CONFIG, "test-state-value", "test-code-challenge");
const parsedAuthUrl = new URL(authorizationUrl);
check("the authorization URL targets Google's own consent endpoint", parsedAuthUrl.origin === "https://accounts.google.com");
check("the authorization URL carries the client id and redirect URI unchanged", parsedAuthUrl.searchParams.get("client_id") === "test-client-id" && parsedAuthUrl.searchParams.get("redirect_uri") === TEST_OAUTH_CONFIG.redirectUri);
check("the authorization URL requests the Sheets scope (and nothing broader than sheets+email)", (parsedAuthUrl.searchParams.get("scope") ?? "").includes("auth/spreadsheets") && !/(drive|gmail|calendar)/i.test(parsedAuthUrl.searchParams.get("scope") ?? ""));
check("the authorization URL uses PKCE S256, never the plain method", parsedAuthUrl.searchParams.get("code_challenge_method") === "S256" && parsedAuthUrl.searchParams.get("code_challenge") === "test-code-challenge");
check("the authorization URL carries the caller's state value unchanged", parsedAuthUrl.searchParams.get("state") === "test-state-value");
check("the authorization URL never contains the client secret", !authorizationUrl.includes("test-client-secret"));

// --- PKCE + state primitives: real crypto, no shortcuts. ---
const verifier = makeCodeVerifier();
const challenge = makeCodeChallenge(verifier);
check("a code verifier is a non-trivial random string", verifier.length >= 32);
check("the same verifier always produces the same challenge (deterministic)", makeCodeChallenge(verifier) === challenge);
check("a different verifier produces a different challenge", makeCodeChallenge(makeCodeVerifier()) !== challenge);
check("two generated states are never identical (real randomness, not a fixed value)", makeOAuthState() !== makeOAuthState());
check("state hashing is deterministic (needed to look the state back up on callback)", hashState("same-state") === hashState("same-state"));
check("state hashing is not reversible-looking (different from the input)", hashState("same-state") !== "same-state");

// --- Token-at-rest encryption: real AES-256-GCM round trip, HKDF-derived
// from SESSION_SECRET - never a fixed/hard-coded key. ---
const SESSION_SECRET_A = "test-session-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SESSION_SECRET_B = "test-session-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const plaintextToken = "1//fake-refresh-token-shaped-value-for-testing-only";
const encrypted = encryptSecret(plaintextToken, SESSION_SECRET_A);
check("an encrypted token never contains the plaintext as a substring", !encrypted.includes(plaintextToken));
check("decrypting with the same secret recovers the exact original value", decryptSecret(encrypted, SESSION_SECRET_A) === plaintextToken);
check("decrypting with a different secret fails loudly rather than returning garbage", (() => { try { decryptSecret(encrypted, SESSION_SECRET_B); return false; } catch (error) { return error instanceof TokenDecryptionError; } })());
check("a malformed encrypted value is rejected, not silently accepted", (() => { try { decryptSecret("not-a-real-encrypted-value", SESSION_SECRET_A); return false; } catch (error) { return error instanceof TokenDecryptionError; } })());
check("encrypting the same value twice produces different ciphertext (random IV per call, not deterministic)", encryptSecret(plaintextToken, SESSION_SECRET_A) !== encrypted);

// --- backupService fixtures ---
const TEST_APP_ORIGIN = "https://energy-monitor-test.example";
const ADMIN_USER_ID = 1;
async function testRepo(backupConfigOverrides: Partial<BackupConfigRecord> = {}, options: { connectGoogle?: boolean } = {}): Promise<InMemoryRepository> {
  const connectedGoogleUserId = backupConfigOverrides.connectedGoogleUserId ?? (options.connectGoogle ? ADMIN_USER_ID : null);
  const backupConfig: BackupConfigRecord = { spreadsheetId: null, sheetUrl: null, enabled: false, updatedBy: null, updatedAt: null, ...backupConfigOverrides, connectedGoogleUserId };
  const repo = new InMemoryRepository({
    sites: [{ id: 1, code: "rangsit", name: "Rangsit", active: true }, { id: 2, code: "srinakarin", name: "Srinakarin", active: true }],
    logs: { 1: [fixtureLog("2026-06", 10, 100000, 500000)], 2: [fixtureLog("2026-06", 20, 120000, 600000)] },
    backupConfig
  });
  if (options.connectGoogle) {
    await repo.upsertGoogleSheetsConnection({ userId: connectedGoogleUserId ?? ADMIN_USER_ID, encryptedRefreshToken: encryptSecret("1//mock-refresh-token", SESSION_SECRET_A), email: "admin@example.com" });
  }
  return repo;
}

interface MockCall { url: string; init?: RequestInit }
function mockFetch(calls: MockCall[], responses: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(responses).find(pattern => url.includes(pattern));
    const response = key ? responses[key] : { status: 200, body: { sheets: [{ properties: { title: "Data_Backup" } }, { properties: { title: "Backup_Log" } }] } };
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}
const TOKEN_MOCK = { "oauth2.googleapis.com/token": { status: 200, body: { access_token: "fake-access-token", expires_in: 3600 } } };

// --- runBackup: server has no OAuth client configured at all -> graceful failure. ---
{
  const result = await runBackup(await testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: true }, { connectGoogle: true }), "manual", 1, SESSION_SECRET_A, TEST_APP_ORIGIN, null);
  check("no OAuth client configured on the server does not throw and reports configured=false", result.configured === false);
  check("no OAuth client is logged as failed with a clear, actionable reason", result.log.status === "failed" && (result.log.errorSummary ?? "").includes("GOOGLE_OAUTH_CLIENT_ID"));
}

// --- runBackup: OAuth client configured, but no admin has connected a
// Google account yet -> graceful failure pointing at Settings. ---
{
  const result = await runBackup(await testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: true }), "manual", 1, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG);
  check("OAuth configured but no Google account connected is a graceful failure", result.configured === false);
  check("the message tells the admin to connect a Google account in Settings", (result.log.errorSummary ?? "").includes("Settings"));
}

// --- runBackup: Google account connected, but no destination configured yet
// -> graceful failure, distinct message. ---
{
  const result = await runBackup(await testRepo(undefined, { connectGoogle: true }), "manual", 1, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG);
  check("Google connected but no destination configured is a graceful failure", result.configured === false);
  check("no destination points the admin at Settings", (result.log.errorSummary ?? "").includes("Settings"));
}

// --- runBackup: fully configured, Google API mocked (no live credentials
// used or required, per instruction - the refresh token above is a locally
// generated synthetic fixture string, fetch is fully mocked). ---
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, {
    ...TOKEN_MOCK,
    "spreadsheets/sheet-a?fields": { status: 200, body: { properties: { title: "Energy Monitor Backup" }, sheets: [{ properties: { title: "Data_Backup" } }, { properties: { title: "Backup_Log" } }] } },
    ":clear": { status: 200, body: {} },
    "values/Data_Backup": { status: 200, body: {} },
    ":append": { status: 200, body: {} }
  });
  const result = await runBackup(await testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: true, updatedBy: 3 }, { connectGoogle: true }), "manual", 7, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG, fetchMock);
  check("configured backup with a successful mocked Google API reports configured=true", result.configured === true);
  check("configured backup with a successful mocked Google API is logged success", result.log.status === "success");
  check("the completed run records which spreadsheet it actually wrote to", result.log.spreadsheetId === "sheet-a");
  check("only sheet-a's endpoints were called (no other spreadsheet touched)", calls.every(call => !call.url.includes("spreadsheets/sheet-b")));
  check("the refresh token grant was used to obtain an access token", calls.some(call => call.url.includes("oauth2.googleapis.com/token") && String(call.init?.body ?? "").includes("grant_type=refresh_token")));
  const writeCall = calls.find(call => call.url.includes("values/Data_Backup") && call.init?.method === "PUT");
  const writtenBody = JSON.stringify(writeCall?.init?.body ?? "");
  check("backup rows include real facility names from the database", writtenBody.includes("Rangsit") && writtenBody.includes("Srinakarin"));
  check("backup rows never include password/secret/token-shaped keys", !/password|secret|token|credential/i.test(writtenBody));
  check("the mock refresh token never leaks into the written rows", !writtenBody.includes("mock-refresh-token"));
}

// --- Changing destination: Backup Now against sheet-b must never touch
// sheet-a, and switching back confirms both destinations remain
// independently addressable (no data loss, no cross-contamination). ---
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, TOKEN_MOCK);
  const result = await runBackup(await testRepo({ spreadsheetId: "sheet-b", sheetUrl: canonicalSheetUrl("sheet-b"), enabled: true, updatedBy: 3 }, { connectGoogle: true }), "manual", 7, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG, fetchMock);
  check("switching the configured destination changes which sheet Backup Now writes to", result.log.spreadsheetId === "sheet-b");
  check("no request was made against the previous destination (sheet-a)", calls.every(call => !call.url.includes("spreadsheets/sheet-a")));
}

// --- Scheduled backup respects the "enabled" toggle; manual does not. ---
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, {});
  const disabledScheduled = await runBackup(await testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: false }, { connectGoogle: true }), "scheduled", null, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG, fetchMock);
  check("a scheduled run is skipped (not failed) when backup is disabled", disabledScheduled.log.status === "success" && disabledScheduled.log.recordsProcessed === 0);
  check("no Google API call was made for a disabled scheduled run", calls.length === 0);
}
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, TOKEN_MOCK);
  const manualWhileDisabled = await runBackup(await testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: false }, { connectGoogle: true }), "manual", 9, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG, fetchMock);
  check("a manual Backup Now still runs even when the schedule toggle is off", manualWhileDisabled.log.status === "success" && calls.length > 0);
}

// --- Google API failure (e.g. sharing not granted) is caught and logged,
// never thrown uncaught, never mistaken for a database save failure. ---
{
  const fetchMock = mockFetch([], {
    ...TOKEN_MOCK,
    "spreadsheets/sheet-a?fields": { status: 403, body: { error: { message: "The caller does not have permission" } } }
  });
  const result = await runBackup(await testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: true }, { connectGoogle: true }), "scheduled", null, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG, fetchMock);
  check("a 403 from Google (sharing not granted) does not throw out of runBackup", result.configured === true);
  check("a 403 produces the friendly sharing-instruction message, not a raw error", (result.log.errorSummary ?? "").toLowerCase().includes("share"));
  check("no refresh/access token ever appears in the stored error message", !(result.log.errorSummary ?? "").includes("fake-access-token") && !(result.log.errorSummary ?? "").includes("mock-refresh-token"));
}

// --- A stored connection that fails to decrypt (e.g. SESSION_SECRET
// rotated) is a graceful, actionable failure - never an uncaught crash. ---
{
  const repo = await testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: true }, { connectGoogle: true });
  const result = await runBackup(repo, "manual", 1, SESSION_SECRET_B, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG);
  check("a connection encrypted under a different SESSION_SECRET fails gracefully, not with an uncaught crash", result.configured === false && result.log.status === "failed");
  check("the failure message points the admin at reconnecting, not a raw crypto error", (result.log.errorSummary ?? "").toLowerCase().includes("reconnect"));
}

// --- Test Connection: validates URL, authenticates as the connected
// Google account, checks/creates the required sheets - never writes any
// data row. ---
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, {
    ...TOKEN_MOCK,
    "spreadsheets/sheet-c-1234567890123456789?fields": { status: 200, body: { properties: { title: "Energy Monitor Backup" }, sheets: [{ properties: { title: "Sheet1" } }] } },
    ":batchUpdate": { status: 200, body: {} }
  });
  const repo = await testRepo(undefined, { connectGoogle: true });
  const result = await testBackupConnection(canonicalSheetUrl("sheet-c-1234567890123456789"), repo, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG, fetchMock);
  check("a successful Test Connection reports ok with the real spreadsheet title", result.ok === true && result.ok && result.spreadsheetTitle === "Energy Monitor Backup");
  check("Test Connection creates missing required sheets (Data_Backup/Backup_Log)", calls.some(call => call.url.includes(":batchUpdate")));
  check("Test Connection never writes a data row (no values:clear/update/append call)", !calls.some(call => call.url.includes("values/")));
}
{
  const repo = await testRepo(undefined, { connectGoogle: true });
  const result = await testBackupConnection("not-a-valid-url", repo, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG);
  check("Test Connection rejects an invalid URL before ever calling Google", result.ok === false && !result.ok && result.reason.length > 0);
}
{
  const repo = await testRepo();
  const result = await testBackupConnection(canonicalSheetUrl("sheet-c-1234567890123456789"), repo, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG);
  check("Test Connection reports 'no Google account connected' rather than a confusing Google-side error", result.ok === false && !result.ok && result.reason.toLowerCase().includes("google account"));
}
{
  const fetchMock = mockFetch([], { ...TOKEN_MOCK, "spreadsheets/sheet-d-1234567890123456789?fields": { status: 403, body: {} } });
  const repo = await testRepo(undefined, { connectGoogle: true });
  const result = await testBackupConnection(canonicalSheetUrl("sheet-d-1234567890123456789"), repo, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG, fetchMock);
  check("Test Connection reports a clear sharing-permission failure", result.ok === false && !result.ok && result.reason.toLowerCase().includes("share"));
}
{
  const fetchMock = mockFetch([], { ...TOKEN_MOCK, "spreadsheets/sheet-e-1234567890123456789?fields": { status: 404, body: {} } });
  const repo = await testRepo(undefined, { connectGoogle: true });
  const result = await testBackupConnection(canonicalSheetUrl("sheet-e-1234567890123456789"), repo, SESSION_SECRET_A, TEST_APP_ORIGIN, TEST_OAUTH_CONFIG, fetchMock);
  check("Test Connection reports a clear not-accessible failure for a 404", result.ok === false && !result.ok && result.reason.length > 0);
}

console.log(`backup service: ${checks} assertions passed`);
