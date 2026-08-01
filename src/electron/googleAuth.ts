/**
 * Desktop Google OAuth - Authorization Code + PKCE with an RFC 8252 loopback
 * redirect, running entirely in the Electron main process. The renderer
 * never sees the client_secret, access_token, or refresh_token; it only
 * receives a coarse status (connecting/connected/authRequired/error) plus
 * the signed-in email, via IPC (see ipc/googleSheets.ts).
 *
 * Root cause this replaces: the previous implementation ran Firebase Auth's
 * signInWithPopup/signInWithRedirect entirely in the renderer - i.e. inside
 * Electron's own BrowserWindow - and cached the resulting Google access
 * token in that window's localStorage. Two independent problems follow from
 * that architecture, not one:
 *   1. Google's OAuth consent screen increasingly restricts/blocks embedded,
 *      non-standard browser contexts (an Electron BrowserWindow is exactly
 *      that), which is a losing, ever-shifting fight to keep patching around.
 *   2. Firebase's popup sign-in additionally depends on a same-origin
 *      "helper" iframe for postMessage-based result delivery between the
 *      popup and the main window - which breaks under third-party-cookie
 *      blocking. That is the literal "This third-party cookie will be
 *      blocked" failure this app's users were hitting; the prior fix
 *      (commit 8a3aff5, a redirect+popup fallback) treated the symptom, not
 *      the architecture.
 * The desktop-native fix is to never run OAuth inside Electron's own browser
 * surface at all: launch the user's real, already-trusted system browser via
 * shell.openExternal, receive the redirect on a local loopback HTTP listener
 * bound to 127.0.0.1 only, and keep every credential main-process-side.
 *
 * Token storage note: this app is a portable, single-executable tool that
 * deliberately keeps ALL of its state beside the exe (see paths.ts's header
 * comment) rather than in the OS's per-user AppData/userData profile - so
 * the encrypted token file lives in the same config/ folder as config.json,
 * not app.getPath('userData'). It is still encrypted at rest via Electron's
 * safeStorage (Windows DPAPI, tied to the OS user account) regardless of
 * which folder holds the ciphertext.
 */
import { shell, safeStorage } from "electron";
import { promises as fs } from "fs";
import path from "path";
import http from "http";
import { getAppRoot, getConfigDir, ensureDir, log } from "./paths";
import {
  base64url,
  makeCodeVerifier,
  makeCodeChallenge,
  makeState,
  isTokenStillValid,
  looksLikeRealCredential,
  parseClientConfig,
  isLikelyEncrypted,
  OAuthClientConfig
} from "./googleAuthPure";

export { isTokenStillValid, looksLikeRealCredential, parseClientConfig, isLikelyEncrypted, base64url, makeCodeChallenge };

const OAUTH_CALLBACK_PORT = 51820;
const REDIRECT_URI = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/oauth/callback`;
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "openid", "email"];
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - matches the loopback server's own listen lifetime

export type GoogleAuthStatus = "disconnected" | "connecting" | "connected" | "authRequired" | "error";

export interface GoogleAuthState {
  status: GoogleAuthStatus;
  email: string | null;
  errorMessage: string | null;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch ms
  email: string | null;
}

let cachedClientConfig: OAuthClientConfig | null | undefined; // undefined = not yet loaded
let currentState: GoogleAuthState = { status: "disconnected", email: null, errorMessage: null };
let listeners: Array<(state: GoogleAuthState) => void> = [];
let activeSignInServer: http.Server | null = null;

export function onGoogleAuthStateChange(listener: (state: GoogleAuthState) => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

function setState(next: GoogleAuthState): void {
  currentState = next;
  for (const listener of listeners) listener(next);
}

export function getGoogleAuthState(): GoogleAuthState {
  return currentState;
}

// ---------------------------------------------------------------------------
// Client credentials (never hardcoded, never entered by the assistant - the
// user populates this file themselves from their own Google Cloud Console
// Desktop-app OAuth client; see google-oauth-desktop-config.example.json).
// ---------------------------------------------------------------------------

function clientConfigPath(): string {
  return path.join(getAppRoot(), "google-oauth-desktop-config.json");
}

async function loadClientConfig(): Promise<OAuthClientConfig | null> {
  if (cachedClientConfig !== undefined) return cachedClientConfig;
  try {
    const raw = await fs.readFile(clientConfigPath(), "utf8");
    cachedClientConfig = parseClientConfig(JSON.parse(raw) as Partial<OAuthClientConfig>);
  } catch {
    cachedClientConfig = null;
  }
  return cachedClientConfig;
}

// ---------------------------------------------------------------------------
// Token persistence - encrypted at rest, atomic write, portable-app location.
// ---------------------------------------------------------------------------

function tokenFilePath(): string {
  return path.join(getConfigDir(), "google-oauth-token.enc");
}

async function persistTokens(tokens: StoredTokens): Promise<void> {
  await ensureDir(getConfigDir());
  const json = JSON.stringify(tokens);
  const bytes = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, "utf8");
  const file = tokenFilePath();
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, file).catch(async () => {
    await fs.writeFile(file, bytes);
    await fs.unlink(tmp).catch(() => undefined);
  });
}

async function readPersistedTokens(): Promise<StoredTokens | null> {
  try {
    const bytes = await fs.readFile(tokenFilePath());
    const json = safeStorage.isEncryptionAvailable() && isLikelyEncrypted(bytes)
      ? safeStorage.decryptString(bytes)
      : bytes.toString("utf8");
    const parsed = JSON.parse(json) as StoredTokens;
    if (typeof parsed.accessToken !== "string" || typeof parsed.expiresAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function clearPersistedTokens(): Promise<void> {
  await fs.unlink(tokenFilePath()).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Google endpoints
// ---------------------------------------------------------------------------

async function exchangeCodeForTokens(config: OAuthClientConfig, code: string, codeVerifier: string): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: codeVerifier
    })
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresIn: data.expires_in };
}

async function refreshAccessToken(config: OAuthClientConfig, refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

async function fetchUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Loopback callback server
// ---------------------------------------------------------------------------

function successPageHtml(ok: boolean): string {
  const title = ok ? "Signed in" : "Sign-in failed";
  const body = ok
    ? "You're signed in to Energy Monitor. You can close this tab and return to the app."
    : "Sign-in did not complete. You can close this tab and return to the app to try again.";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:15px system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}main{text-align:center;max-width:26rem;padding:2rem}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

/**
 * Waits for exactly one OAuth redirect on the loopback listener, validating
 * `state` before returning the authorization code. Rejects on timeout,
 * user-denied consent, or a state mismatch (possible CSRF) - never resolves
 * with an unvalidated code.
 */
function waitForOAuthCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith("/oauth/callback")) {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      const finish = (err: Error | null, value?: string) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(successPageHtml(!err));
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        server.close();
        activeSignInServer = null;
        if (err) reject(err);
        else resolve(value as string);
      };

      if (error) {
        finish(new Error(error === "access_denied" ? "access_denied" : `oauth_error:${error}`));
        return;
      }
      if (!returnedState || returnedState !== expectedState) {
        finish(new Error("state_mismatch"));
        return;
      }
      if (!code) {
        finish(new Error("missing_code"));
        return;
      }
      finish(null, code);
    });

    activeSignInServer = server;
    server.on("error", err => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1");

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      activeSignInServer = null;
      reject(new Error("timeout"));
    }, AUTH_TIMEOUT_MS);
  });
}

function describeAuthError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "access_denied") return "You declined the Google sign-in request.";
  if (message === "state_mismatch") return "Sign-in could not be verified (state mismatch). Please try again.";
  if (message === "missing_code") return "Google did not return an authorization code. Please try again.";
  if (message === "timeout") return "Sign-in timed out waiting for a response. Please try again.";
  if (message === "EADDRINUSE") return "Local sign-in listener port is already in use. Close any other Energy Monitor sign-in attempt and retry.";
  return message;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Cancels an in-flight sign-in's loopback listener, if one is open (e.g. the
 *  window closed, or the user starts a second attempt). */
export function cancelPendingGoogleSignIn(): void {
  if (activeSignInServer) {
    activeSignInServer.close();
    activeSignInServer = null;
  }
}

export async function startGoogleSignIn(): Promise<void> {
  cancelPendingGoogleSignIn();
  const config = await loadClientConfig();
  if (!config) {
    setState({
      status: "error",
      email: null,
      errorMessage: `Google sign-in is not configured. Copy google-oauth-desktop-config.example.json to google-oauth-desktop-config.json (in ${getAppRoot()}) and fill in a Desktop-app OAuth client from Google Cloud Console.`
    });
    return;
  }

  setState({ status: "connecting", email: null, errorMessage: null });

  const codeVerifier = makeCodeVerifier();
  const codeChallenge = makeCodeChallenge(codeVerifier);
  const state = makeState();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  const callbackPromise = waitForOAuthCallback(state);

  try {
    await shell.openExternal(authUrl.toString());
  } catch (err) {
    cancelPendingGoogleSignIn();
    setState({ status: "error", email: null, errorMessage: `Could not open your system browser: ${(err as Error).message}` });
    return;
  }

  try {
    const code = await callbackPromise;
    const { accessToken, refreshToken, expiresIn } = await exchangeCodeForTokens(config, code, codeVerifier);
    const email = await fetchUserEmail(accessToken);
    const tokens: StoredTokens = { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000, email };
    await persistTokens(tokens);
    setState({ status: "connected", email, errorMessage: null });
    log.info(`Google sign-in succeeded (${email ?? "unknown email"}).`);
  } catch (err) {
    log.warn(`Google sign-in failed: ${describeAuthError(err)}`);
    setState({ status: "error", email: null, errorMessage: describeAuthError(err) });
  }
}

export async function signOutGoogle(): Promise<void> {
  cancelPendingGoogleSignIn();
  await clearPersistedTokens();
  setState({ status: "disconnected", email: null, errorMessage: null });
}

/**
 * Returns a currently-valid access token, transparently refreshing it first
 * if it is at/near expiry - callers (the Google Sheets IPC handlers) never
 * have to think about refresh themselves. Returns null (and moves state to
 * authRequired) if there is no session, or the refresh itself fails (e.g. the
 * refresh token was revoked), so a real re-sign-in is unambiguously required
 * rather than silently proceeding with a dead token.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const stored = await readPersistedTokens();
  if (!stored) {
    if (currentState.status !== "connecting") setState({ status: "authRequired", email: null, errorMessage: null });
    return null;
  }
  if (isTokenStillValid(stored.expiresAt, Date.now())) {
    if (currentState.status !== "connected" || currentState.email !== stored.email) {
      setState({ status: "connected", email: stored.email, errorMessage: null });
    }
    return stored.accessToken;
  }
  if (!stored.refreshToken) {
    await clearPersistedTokens();
    setState({ status: "authRequired", email: null, errorMessage: "Your Google session expired and cannot be refreshed automatically. Please sign in again." });
    return null;
  }
  try {
    const config = await loadClientConfig();
    if (!config) throw new Error("Google sign-in is not configured.");
    const { accessToken, expiresIn } = await refreshAccessToken(config, stored.refreshToken);
    const next: StoredTokens = { ...stored, accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    await persistTokens(next);
    setState({ status: "connected", email: next.email, errorMessage: null });
    return accessToken;
  } catch (err) {
    log.warn(`Google token refresh failed: ${(err as Error).message}`);
    await clearPersistedTokens();
    setState({ status: "authRequired", email: null, errorMessage: "Your Google session could not be refreshed. Please sign in again." });
    return null;
  }
}

/** Call once at app startup: restores a "connected" status from a still-valid
 *  persisted session without requiring the user to sign in again, but never
 *  blocks startup on a network call - refresh happens lazily on first real use. */
export async function restoreGoogleAuthOnStartup(): Promise<void> {
  const stored = await readPersistedTokens();
  if (!stored) {
    setState({ status: "disconnected", email: null, errorMessage: null });
    return;
  }
  if (isTokenStillValid(stored.expiresAt, Date.now())) {
    setState({ status: "connected", email: stored.email, errorMessage: null });
  } else if (stored.refreshToken) {
    // Session exists but is stale; report it as connected optimistically -
    // getValidAccessToken() will refresh (or demote to authRequired) on the
    // first actual Sheets call, never leaving a silently-broken "connected"
    // state that only fails much later.
    setState({ status: "connected", email: stored.email, errorMessage: null });
  } else {
    await clearPersistedTokens();
    setState({ status: "authRequired", email: null, errorMessage: null });
  }
}
