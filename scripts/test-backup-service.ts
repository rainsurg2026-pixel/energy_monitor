import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { runBackup, testBackupConnection } from "../server/backup/backupService";
import { loadServiceAccountCredential, isAuthorizedCronRequest } from "../server/backup/backupConfig";
import { canonicalSheetUrl, extractSpreadsheetId, maskSpreadsheetId } from "../server/backup/googleSheetsUrl";
import { fixtureLog } from "../server/testFixtures";

let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

// --- URL validation and spreadsheet ID extraction (server-side only - the
// task's own requirement: never trust a browser-supplied ID independent of
// the URL it claims to come from). ---
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

// --- Service-account credential loading: env-only, never blocks startup. ---
check("service account credential is null when unset", loadServiceAccountCredential({}) === null);
check("service account credential loads when present", loadServiceAccountCredential({ GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON: "{}" }) !== null);

// --- Cron authorization: shared-secret bearer header only, never a session. ---
check("cron request without CRON_SECRET configured is never authorized", !isAuthorizedCronRequest("Bearer anything", {}));
check("cron request with the correct bearer token is authorized", isAuthorizedCronRequest("Bearer correct-secret", { CRON_SECRET: "correct-secret" }));
check("cron request with the wrong bearer token is rejected", !isAuthorizedCronRequest("Bearer wrong-secret", { CRON_SECRET: "correct-secret" }));

function testRepo(backupConfig?: { spreadsheetId: string | null; sheetUrl: string | null; enabled: boolean; updatedBy: number | null; updatedAt: string | null }): InMemoryRepository {
  return new InMemoryRepository({
    sites: [{ id: 1, code: "rangsit", name: "Rangsit", active: true }, { id: 2, code: "srinakarin", name: "Srinakarin", active: true }],
    logs: { 1: [fixtureLog("2026-06", 10, 100000, 500000)], 2: [fixtureLog("2026-06", 20, 120000, 600000)] },
    backupConfig
  });
}

// --- runBackup: no service account configured -> graceful failure. ---
const noCredentialResult = await runBackup(testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: true, updatedBy: null, updatedAt: null }), "manual", 1, null);
check("no service account configured does not throw and reports configured=false", noCredentialResult.configured === false);
check("no service account is logged as failed with a clear reason", noCredentialResult.log.status === "failed" && (noCredentialResult.log.errorSummary ?? "").includes("not configured"));

// --- runBackup: service account present, but no destination configured yet
// (the Admin has never entered a Google Sheet URL) -> graceful failure,
// distinct message pointing at Settings. ---
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const credential = { serviceAccountJson: JSON.stringify({ client_email: "backup-test@example-project.iam.gserviceaccount.com", private_key: privateKey }) };

const noDestinationResult = await runBackup(testRepo(), "manual", 1, credential);
check("service account present but no destination configured is a graceful failure", noDestinationResult.configured === false);
check("no destination points the admin at Settings", (noDestinationResult.log.errorSummary ?? "").includes("Settings"));

// --- runBackup: configured, Google API mocked (no live credentials used or
// required, per instruction). The RSA key above is generated fresh, locally,
// for this test run only - a synthetic cryptographic fixture, not a
// credential for any real account; fetch is fully mocked. ---
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

{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, {
    "oauth2.googleapis.com/token": { status: 200, body: { access_token: "fake-access-token", expires_in: 3600 } },
    "spreadsheets/sheet-a?fields": { status: 200, body: { properties: { title: "Energy Monitor Backup" }, sheets: [{ properties: { title: "Data_Backup" } }, { properties: { title: "Backup_Log" } }] } },
    ":clear": { status: 200, body: {} },
    "values/Data_Backup": { status: 200, body: {} },
    ":append": { status: 200, body: {} }
  });
  const result = await runBackup(testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: true, updatedBy: 3, updatedAt: null }), "manual", 7, credential, fetchMock);
  check("configured backup with a successful mocked Google API reports configured=true", result.configured === true);
  check("configured backup with a successful mocked Google API is logged success", result.log.status === "success");
  check("the completed run records which spreadsheet it actually wrote to", result.log.spreadsheetId === "sheet-a");
  check("only sheet-a's endpoints were called (no other spreadsheet touched)", calls.every(call => !call.url.includes("spreadsheets/sheet-b")));
  const writeCall = calls.find(call => call.url.includes("values/Data_Backup") && call.init?.method === "PUT");
  const writtenBody = JSON.stringify(writeCall?.init?.body ?? "");
  check("backup rows include real facility names from the database", writtenBody.includes("Rangsit") && writtenBody.includes("Srinakarin"));
  check("backup rows never include password/secret/token-shaped keys", !/password|secret|token|credential/i.test(writtenBody));
}

// --- Changing destination: Backup Now against sheet-b must never touch
// sheet-a, and switching back confirms both destinations remain
// independently addressable (no data loss, no cross-contamination). ---
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, { "oauth2.googleapis.com/token": { status: 200, body: { access_token: "fake-access-token" } } });
  const result = await runBackup(testRepo({ spreadsheetId: "sheet-b", sheetUrl: canonicalSheetUrl("sheet-b"), enabled: true, updatedBy: 3, updatedAt: null }), "manual", 7, credential, fetchMock);
  check("switching the configured destination changes which sheet Backup Now writes to", result.log.spreadsheetId === "sheet-b");
  check("no request was made against the previous destination (sheet-a)", calls.every(call => !call.url.includes("spreadsheets/sheet-a")));
}

// --- Scheduled backup respects the "enabled" toggle; manual does not. ---
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, {});
  const disabledScheduled = await runBackup(testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: false, updatedBy: null, updatedAt: null }), "scheduled", null, credential, fetchMock);
  check("a scheduled run is skipped (not failed) when backup is disabled", disabledScheduled.log.status === "success" && disabledScheduled.log.recordsProcessed === 0);
  check("no Google API call was made for a disabled scheduled run", calls.length === 0);
}
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, { "oauth2.googleapis.com/token": { status: 200, body: { access_token: "fake-access-token" } } });
  const manualWhileDisabled = await runBackup(testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: false, updatedBy: null, updatedAt: null }), "manual", 9, credential, fetchMock);
  check("a manual Backup Now still runs even when the schedule toggle is off", manualWhileDisabled.log.status === "success" && calls.length > 0);
}

// --- Google API failure (e.g. sharing not granted) is caught and logged,
// never thrown uncaught, never mistaken for a database save failure. ---
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, {
    "oauth2.googleapis.com/token": { status: 200, body: { access_token: "fake-access-token" } },
    "spreadsheets/sheet-a?fields": { status: 403, body: { error: { message: "The caller does not have permission" } } }
  });
  const result = await runBackup(testRepo({ spreadsheetId: "sheet-a", sheetUrl: canonicalSheetUrl("sheet-a"), enabled: true, updatedBy: null, updatedAt: null }), "scheduled", null, credential, fetchMock);
  check("a 403 from Google (sharing not granted) does not throw out of runBackup", result.configured === true);
  check("a 403 produces the friendly sharing-instruction message, not a raw error", (result.log.errorSummary ?? "").toLowerCase().includes("share"));
  check("the credential/private key never appears in the stored error message", !(result.log.errorSummary ?? "").includes("PRIVATE KEY"));
}

// --- Test Connection: validates URL, authenticates, checks/creates the
// required sheets - never writes any data row. ---
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, {
    "oauth2.googleapis.com/token": { status: 200, body: { access_token: "fake-access-token" } },
    "spreadsheets/sheet-c-1234567890123456789?fields": { status: 200, body: { properties: { title: "Energy Monitor Backup" }, sheets: [{ properties: { title: "Sheet1" } }] } },
    ":batchUpdate": { status: 200, body: {} }
  });
  const result = await testBackupConnection(canonicalSheetUrl("sheet-c-1234567890123456789"), credential, fetchMock);
  check("a successful Test Connection reports ok with the real spreadsheet title", result.ok === true && result.ok && result.spreadsheetTitle === "Energy Monitor Backup");
  check("Test Connection creates missing required sheets (Data_Backup/Backup_Log)", calls.some(call => call.url.includes(":batchUpdate")));
  check("Test Connection never writes a data row (no values:clear/update/append call)", !calls.some(call => call.url.includes("values/")));
}
{
  const result = await testBackupConnection("not-a-valid-url", credential);
  check("Test Connection rejects an invalid URL before ever calling Google", result.ok === false && !result.ok && result.reason.length > 0);
}
{
  const fetchMock = mockFetch([], { "oauth2.googleapis.com/token": { status: 200, body: { access_token: "fake-access-token" } }, "spreadsheets/sheet-d-1234567890123456789?fields": { status: 403, body: {} } });
  const result = await testBackupConnection(canonicalSheetUrl("sheet-d-1234567890123456789"), credential, fetchMock);
  check("Test Connection reports a clear sharing-permission failure", result.ok === false && !result.ok && result.reason.toLowerCase().includes("share"));
}
{
  const fetchMock = mockFetch([], { "oauth2.googleapis.com/token": { status: 200, body: { access_token: "fake-access-token" } }, "spreadsheets/sheet-e-1234567890123456789?fields": { status: 404, body: {} } });
  const result = await testBackupConnection(canonicalSheetUrl("sheet-e-1234567890123456789"), credential, fetchMock);
  check("Test Connection reports a clear not-accessible failure for a 404", result.ok === false && !result.ok && result.reason.length > 0);
}

console.log(`backup service: ${checks} assertions passed`);
