import { SignJWT, importPKCS8 } from "jose";

export interface GoogleServiceAccountKey {
  client_email: string;
  private_key: string;
}

export class GoogleAuthError extends Error {
  readonly code = "GOOGLE_AUTH_ERROR";
}

/** Parses the standard Google service-account JSON key format. Never logs
 *  or returns the raw private key - callers only ever see the parsed
 *  object in-memory for the duration of a single token exchange. */
export function parseServiceAccountKey(json: string): GoogleServiceAccountKey {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new GoogleAuthError("GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON is not valid JSON."); }
  const key = parsed as Partial<GoogleServiceAccountKey>;
  if (!key.client_email || !key.private_key) throw new GoogleAuthError("Service account JSON is missing client_email or private_key.");
  return { client_email: key.client_email, private_key: key.private_key };
}

/** Exchanges a service-account key for a short-lived Google OAuth2 access
 *  token via the standard JWT Bearer grant (RFC 7523) - no browser, no
 *  per-user consent, no refresh token to store. Scoped to Sheets only. */
export async function getGoogleAccessToken(key: GoogleServiceAccountKey, fetchImpl: typeof fetch = fetch): Promise<string> {
  const privateKey = await importPKCS8(key.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/spreadsheets" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(key.client_email)
    .setSubject(key.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString()
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new GoogleAuthError(`Google token exchange failed (${response.status}): ${bodyText.slice(0, 500)}`);
  }
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new GoogleAuthError("Google token exchange response had no access_token.");
  return body.access_token;
}
