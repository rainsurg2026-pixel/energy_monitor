import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { MonthlyLog } from "../../src/types";
import { importLogsFromGoogleSheets, VerificationFailedError, writeMonthlyLogTransactional, type DataIntegrityReport } from "../../src/sheetsService";
import { validateLogsPayload, PayloadError } from "../../src/excel/WorkbookValidator";
import type { ServerConfig } from "../config/env";
import { HttpError } from "../errors";
import type { BackendRepository } from "../repositories/contracts";

const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "openid", "email"];
const TOKEN_CIPHER_VERSION = "v1";

export interface GoogleSheetsStatus {
  connected: boolean;
  email: string | null;
  updatedAt: string | null;
}

function base64url(value: Buffer): string { return value.toString("base64url"); }

function sha256(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }

function parseSpreadsheetId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpError(400, "INVALID_SPREADSHEET_ID", "spreadsheet_id must be a non-empty spreadsheet identifier.");
  }
  return value.trim();
}

function parseUserId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new HttpError(500, "INVALID_ACTOR", "Authenticated actor identity is invalid.");
  return value;
}

function encryptedValue(keyText: string, plainText: string): string {
  const key = sha256(keyText);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return [TOKEN_CIPHER_VERSION, base64url(iv), base64url(cipher.getAuthTag()), base64url(ciphertext)].join(".");
}

function decryptedValue(keyText: string, encoded: string): string {
  try {
    const [version, ivText, tagText, ciphertextText] = encoded.split(".");
    if (version !== TOKEN_CIPHER_VERSION || !ivText || !tagText || !ciphertextText) throw new Error("invalid encrypted value");
    const decipher = createDecipheriv("aes-256-gcm", sha256(keyText), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new HttpError(503, "GOOGLE_TOKEN_UNAVAILABLE", "The stored Google authorization is unavailable. Sign in with Google again.");
  }
}

function configured(config: ServerConfig): { clientId: string; clientSecret: string; redirectUri: string; encryptionKey: string } {
  if (!config.googleClientId || !config.googleClientSecret || !config.googleRedirectUri || !config.googleTokenEncryptionKey) {
    throw new HttpError(503, "GOOGLE_SHEETS_NOT_CONFIGURED", "Google Sheets synchronization is not configured on this server.");
  }
  return { clientId: config.googleClientId, clientSecret: config.googleClientSecret, redirectUri: config.googleRedirectUri, encryptionKey: config.googleTokenEncryptionKey };
}

async function responseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function googleError(response: Response, operation: string): Promise<never> {
  // Do not return Google's response body: it can include token/error details
  // and is not a safe application error contract.
  await response.arrayBuffer().catch(() => undefined);
  throw new HttpError(502, "GOOGLE_API_ERROR", `${operation} could not be completed (Google HTTP ${response.status}).`);
}

export class GoogleSheetsService {
  constructor(private readonly repository: BackendRepository, private readonly config: ServerConfig) {}

  async startAuthorization(userId: number, sessionId: string): Promise<string> {
    const oauth = configured(this.config);
    if (!/^\d+$/.test(sessionId)) throw new HttpError(500, "INVALID_SESSION", "Authenticated session identity is invalid.");
    const state = randomBytes(32).toString("hex");
    const verifier = base64url(randomBytes(32));
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", oauth.clientId);
    url.searchParams.set("redirect_uri", oauth.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
    url.searchParams.set("code_challenge", base64url(sha256(verifier)));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    await this.repository.saveGoogleOAuthState({
      stateHash: sha256(state).toString("hex"),
      userId: parseUserId(userId),
      sessionId,
      encryptedCodeVerifier: encryptedValue(oauth.encryptionKey, verifier),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });
    return url.toString();
  }

  async completeAuthorization(state: string, code: string, userId: number, sessionId: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/i.test(state) || typeof code !== "string" || code.trim() === "") throw new HttpError(400, "INVALID_GOOGLE_CALLBACK", "The Google authorization callback is invalid.");
    const oauth = configured(this.config);
    const record = await this.repository.consumeGoogleOAuthState(sha256(state).toString("hex"), parseUserId(userId), sessionId);
    if (!record) throw new HttpError(400, "GOOGLE_OAUTH_STATE_INVALID", "The Google authorization session expired or does not match this login session.");
    const verifier = decryptedValue(oauth.encryptionKey, record.encryptedCodeVerifier);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: code.trim(), client_id: oauth.clientId, client_secret: oauth.clientSecret, redirect_uri: oauth.redirectUri, grant_type: "authorization_code", code_verifier: verifier })
    });
    if (!response.ok) await googleError(response, "Google sign-in");
    const tokens = await responseJson<{ access_token?: string; refresh_token?: string; expires_in?: number }>(response);
    if (!tokens.access_token || !tokens.refresh_token) throw new HttpError(502, "GOOGLE_REFRESH_TOKEN_MISSING", "Google did not return a refresh token. Please grant consent again.");
    let email: string | null = null;
    try {
      const userInfo = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` } });
      if (userInfo.ok) email = (await responseJson<{ email?: string }>(userInfo)).email ?? null;
    } catch { /* email is display metadata; connection remains valid */ }
    await this.repository.saveGoogleSheetsConnection({ userId: parseUserId(userId), encryptedRefreshToken: encryptedValue(oauth.encryptionKey, tokens.refresh_token), email, updatedAt: new Date().toISOString() });
  }

  async status(userId: number): Promise<GoogleSheetsStatus> {
    configured(this.config);
    const connection = await this.repository.getGoogleSheetsConnection(parseUserId(userId));
    return connection ? { connected: true, email: connection.email, updatedAt: connection.updatedAt } : { connected: false, email: null, updatedAt: null };
  }

  async signOut(userId: number): Promise<void> { await this.repository.deleteGoogleSheetsConnection(parseUserId(userId)); }

  private async accessToken(userId: number): Promise<string> {
    const oauth = configured(this.config);
    const connection = await this.repository.getGoogleSheetsConnection(parseUserId(userId));
    if (!connection) throw new HttpError(401, "GOOGLE_AUTH_REQUIRED", "Sign in with Google before synchronizing.");
    const refreshToken = decryptedValue(oauth.encryptionKey, connection.encryptedRefreshToken);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: oauth.clientId, client_secret: oauth.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) throw new HttpError(401, "GOOGLE_AUTH_REQUIRED", "The Google authorization expired or was revoked. Sign in again.");
      await googleError(response, "Google token refresh");
    }
    const tokens = await responseJson<{ access_token?: string; refresh_token?: string }>(response);
    if (!tokens.access_token) throw new HttpError(502, "GOOGLE_ACCESS_TOKEN_MISSING", "Google did not return an access token.");
    if (tokens.refresh_token) await this.repository.saveGoogleSheetsConnection({ ...connection, encryptedRefreshToken: encryptedValue(oauth.encryptionKey, tokens.refresh_token), updatedAt: new Date().toISOString() });
    return tokens.access_token;
  }

  async syncMonth(userId: number, spreadsheetId: unknown, rawLog: unknown): Promise<{ report: DataIntegrityReport }> {
    const [log] = this.validateLogs([rawLog]);
    const result = await writeMonthlyLogTransactional(await this.accessToken(userId), parseSpreadsheetId(spreadsheetId), log);
    return { report: result.report };
  }

  async exportAll(userId: number, spreadsheetId: unknown, rawLogs: unknown): Promise<{ report: DataIntegrityReport | null }> {
    const logs = this.validateLogs(rawLogs);
    if (logs.length === 0) throw new HttpError(400, "NO_LOCAL_DATA", "No local data is available to export.");
    const token = await this.accessToken(userId);
    let lastReport: DataIntegrityReport | null = null;
    for (const log of logs) {
      try {
        lastReport = (await writeMonthlyLogTransactional(token, parseSpreadsheetId(spreadsheetId), log)).report;
      } catch (error) {
        if (error instanceof VerificationFailedError) throw new VerificationFailedError(`${log.month}: ${error.message}`, error.mismatches);
        throw error;
      }
    }
    return { report: lastReport };
  }

  async importAll(userId: number, spreadsheetId: unknown, siteId: number | null, persist: boolean, actorUserId: number, correlationId: string): Promise<{ logs: MonthlyLog[]; persisted: boolean }> {
    const logs = await importLogsFromGoogleSheets(await this.accessToken(userId), parseSpreadsheetId(spreadsheetId));
    if (!persist) return { logs, persisted: false };
    if (!siteId) throw new HttpError(400, "SITE_REQUIRED_FOR_IMPORT", "site_id is required when importing into Web data.");
    const site = await this.repository.getSite(siteId);
    if (!site?.active) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    await this.repository.withTransaction(async repository => {
      const periods = await repository.listPeriods(siteId);
      const versions = new Map(periods.map(period => [period.month, period.rowVersion]));
      for (const log of logs) {
        await repository.saveMonthlyLog({
          siteId,
          log,
          expectedRowVersion: versions.get(log.month) ?? null,
          correlationId: `${correlationId}:${log.month}`,
          actorUserId,
          provenance: { sourceType: "google-sheets", sourceSheet: "UPS Loads; Air Conditioning; DC Power Panels; Energy & Cost", sourceLocation: parseSpreadsheetId(spreadsheetId) }
        });
      }
    });
    return { logs, persisted: true };
  }

  private validateLogs(raw: unknown): MonthlyLog[] {
    try { return validateLogsPayload(raw); }
    catch (error) { throw new HttpError(400, "INVALID_LOGS", error instanceof PayloadError ? error.message : "The Google Sheets payload contains invalid log data."); }
  }
}
