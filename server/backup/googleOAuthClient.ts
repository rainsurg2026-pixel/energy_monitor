/**
 * Google OAuth2 "Web application" client - authorization-code + PKCE flow
 * for the Admin-initiated backup Google account connection. Distinct from
 * server/backup/googleServiceAccountAuth.ts's JWT-bearer service-account
 * flow (no longer used for backups per the updated requirement) and from
 * Desktop's own Electron-side OAuth (src/electron/googleAuth.ts, a
 * different Google Cloud OAuth client of the "Desktop app" type - the two
 * are never interchangeable; a Desktop-app client has no client_secret
 * and cannot be used for a server-side redirect flow).
 */

export interface GoogleOAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET must come from a
 *  Google Cloud Console "Web application" OAuth client with this exact
 *  redirect URI registered - an external, human setup step this function
 *  cannot perform. Absent config returns null (never throws), matching
 *  the existing isAuthorizedCronRequest()/getBackupConfig() pattern of
 *  "not configured" being an observable, non-fatal state.
 *  appOrigin is taken as an explicit parameter (ServerConfig.appOrigin,
 *  already validated non-empty at server startup for any hosted
 *  deployment) rather than re-read from the environment here, so the
 *  redirect URI is always built from the same origin value the rest of
 *  the app already trusts (CORS/cookies), never a second, independently
 *  parsed one. */
export function loadGoogleOAuthClientConfig(appOrigin: string, environment: NodeJS.ProcessEnv = process.env): GoogleOAuthClientConfig | null {
  const clientId = environment.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !appOrigin) return null;
  return { clientId, clientSecret, redirectUri: `${appOrigin.replace(/\/$/, "")}/api/v1/admin/backup/google/callback` };
}

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/userinfo.email"];

export function buildAuthorizationUrl(config: GoogleOAuthClientConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export class GoogleOAuthError extends Error {
  readonly code = "GOOGLE_OAUTH_ERROR";
  constructor(message: string, readonly status?: number) { super(message); }
}

export interface ExchangedTokens { accessToken: string; refreshToken: string | null; expiresInSeconds: number }

/** Never logs the authorization code, code_verifier, or any token -
 *  errors are built only from HTTP status + a truncated response body,
 *  matching every other Google API error path in server/backup/*. */
export async function exchangeCodeForTokens(config: GoogleOAuthClientConfig, code: string, codeVerifier: string, fetchImpl: typeof fetch = fetch): Promise<ExchangedTokens> {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    }).toString()
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GoogleOAuthError(`Google token exchange failed (${response.status}): ${text.slice(0, 500)}`, response.status);
  }
  const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.access_token) throw new GoogleOAuthError("Google token exchange response had no access_token.");
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, expiresInSeconds: body.expires_in ?? 3600 };
}

export async function refreshAccessToken(config: GoogleOAuthClientConfig, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }).toString()
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GoogleOAuthError(`Google token refresh failed (${response.status}): ${text.slice(0, 500)}`, response.status);
  }
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new GoogleOAuthError("Google token refresh response had no access_token.");
  return { accessToken: body.access_token, expiresInSeconds: body.expires_in ?? 3600 };
}

export async function fetchGoogleAccountEmail(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const response = await fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  const body = await response.json() as { email?: string };
  return body.email ?? null;
}

/** Best-effort: Google's revoke endpoint returns 200 even for an
 *  already-invalid/expired token, and a revoke failure must never block
 *  a local disconnect (the stored connection is deleted regardless by
 *  the caller) - so this never throws. */
export async function revokeGoogleToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
  } catch {
    // Network failure revoking with Google is not fatal to a local disconnect.
  }
}
