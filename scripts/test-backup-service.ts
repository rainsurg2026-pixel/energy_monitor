import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { runBackup } from "../server/backup/backupService";
import { loadBackupConfig, isAuthorizedCronRequest } from "../server/backup/backupConfig";
import { fixtureLog } from "../server/testFixtures";

let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

// --- Config loading: must never throw, absence is a normal, expected state. ---
check("backup config is null when service account JSON is missing", loadBackupConfig({ GOOGLE_BACKUP_SPREADSHEET_ID: "sheet-1" }) === null);
check("backup config is null when spreadsheet ID is missing", loadBackupConfig({ GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON: "{}" }) === null);
check("backup config loads when both are present", loadBackupConfig({ GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON: "{}", GOOGLE_BACKUP_SPREADSHEET_ID: "sheet-1" })?.spreadsheetId === "sheet-1");

// --- Cron authorization: shared-secret bearer header only, never a session. ---
check("cron request without CRON_SECRET configured is never authorized", !isAuthorizedCronRequest("Bearer anything", {}));
check("cron request with the correct bearer token is authorized", isAuthorizedCronRequest("Bearer correct-secret", { CRON_SECRET: "correct-secret" }));
check("cron request with the wrong bearer token is rejected", !isAuthorizedCronRequest("Bearer wrong-secret", { CRON_SECRET: "correct-secret" }));
check("cron request with no header at all is rejected", !isAuthorizedCronRequest(undefined, { CRON_SECRET: "correct-secret" }));

// --- runBackup: not configured -> graceful failure, never throws, never
// blocks (this IS the "Database Save: SUCCESS, Google Backup: FAILED"
// requirement - a save already succeeded before backup ever runs). ---
function testRepo(): InMemoryRepository {
  return new InMemoryRepository({
    sites: [{ id: 1, code: "rangsit", name: "Rangsit", active: true }, { id: 2, code: "srinakarin", name: "Srinakarin", active: true }],
    logs: { 1: [fixtureLog("2026-06", 10, 100000, 500000)], 2: [fixtureLog("2026-06", 20, 120000, 600000)] }
  });
}

const unconfiguredResult = await runBackup(testRepo(), "manual", 1, null);
check("unconfigured backup does not throw and reports configured=false", unconfiguredResult.configured === false);
check("unconfigured backup is logged as failed with a clear reason", unconfiguredResult.log.status === "failed" && (unconfiguredResult.log.errorSummary ?? "").includes("not configured"));
check("unconfigured backup processes zero records", unconfiguredResult.log.recordsProcessed === 0);

// --- runBackup: configured, Google API mocked (no live credentials used or
// required, per instruction). The RSA key below is generated fresh, locally,
// for this test run only - it is a synthetic cryptographic fixture for
// exercising the JWT-signing code path, not a credential for any real
// account or service; fetch is fully mocked, so no network call is ever made.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const fakeServiceAccount = JSON.stringify({ client_email: "backup-test@example-project.iam.gserviceaccount.com", private_key: privateKey });
const config = { serviceAccountJson: fakeServiceAccount, spreadsheetId: "test-spreadsheet-id" };

interface MockCall { url: string; init?: RequestInit }
function mockFetch(calls: MockCall[], responses: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(responses).find(pattern => url.includes(pattern));
    const response = key ? responses[key] : { status: 200, body: {} };
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, {
    "oauth2.googleapis.com/token": { status: 200, body: { access_token: "fake-access-token", expires_in: 3600 } },
    ":clear": { status: 200, body: {} },
    "values/Data_Backup": { status: 200, body: {} },
    ":append": { status: 200, body: {} }
  });
  const result = await runBackup(testRepo(), "manual", 7, config, fetchMock);
  check("configured backup with a successful mocked Google API reports configured=true", result.configured === true);
  check("configured backup with a successful mocked Google API is logged success", result.log.status === "success");
  check("configured backup processes a non-zero number of records", result.log.recordsProcessed > 0);
  check("records processed equals records succeeded on a clean run", result.log.recordsProcessed === result.log.recordsSuccess && result.log.recordsFailed === 0);
  check("the token exchange call was made", calls.some(call => call.url.includes("oauth2.googleapis.com/token")));
  check("the sheet was cleared before being written (snapshot, not append, for Data_Backup)", calls.some(call => call.url.includes(":clear")));
  check("the sheet was written with the new snapshot", calls.some(call => call.url.includes("values/Data_Backup") && call.init?.method === "PUT"));
  check("a Backup_Log row was appended (genuinely append-only, unlike Data_Backup)", calls.some(call => call.url.includes("Backup_Log") && call.url.includes(":append")));
  const writeCall = calls.find(call => call.url.includes("values/Data_Backup") && call.init?.method === "PUT");
  const writtenBody = JSON.stringify(writeCall?.init?.body ?? "");
  check("backup rows include real facility names from the database", writtenBody.includes("Rangsit") && writtenBody.includes("Srinakarin"));
  check("backup rows never include password/secret/token-shaped keys", !/password|secret|token|credential/i.test(writtenBody));
}

// --- runBackup: configured, but the Google API itself fails (e.g. token
// exchange rejected) - must be caught and logged, never thrown uncaught,
// never mistaken for a database save failure. ---
{
  const calls: MockCall[] = [];
  const fetchMock = mockFetch(calls, { "oauth2.googleapis.com/token": { status: 401, body: { error: "invalid_grant" } } });
  const result = await runBackup(testRepo(), "scheduled", null, config, fetchMock);
  check("a Google API failure does not throw out of runBackup", result.configured === true);
  check("a Google API failure is logged as failed with a captured reason", result.log.status === "failed" && (result.log.errorSummary?.length ?? 0) > 0);
  check("a Google API failure still records which backup type ran", result.log.backupType === "scheduled");
}

console.log(`backup service: ${checks} assertions passed`);
