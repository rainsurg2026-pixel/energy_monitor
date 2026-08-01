/**
 * Pure, Electron-independent logic used by googleAuth.ts - split into its
 * own module specifically so it can be unit-tested directly under plain
 * Node/tsx (see scripts/test-google-auth.ts). googleAuth.ts itself
 * transitively imports "electron" (via paths.ts), and Node's ESM loader
 * cannot synthesize named exports from that module outside a real Electron
 * process (its CJS export is a bare string, the path to the electron
 * binary, when required from plain Node) - importing it at all crashes a
 * plain-Node test at load time, before a single assertion runs. None of the
 * functions below need fs/http/crypto-from-electron/any Electron API, so
 * they live here instead, with no import of "electron" anywhere in their
 * transitive closure.
 */
import crypto from "crypto";

const TOKEN_REFRESH_SKEW_MS = 60 * 1000; // refresh a minute before real expiry, not exactly at it

export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function makeCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

export function makeCodeChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

export function makeState(): string {
  return base64url(crypto.randomBytes(16));
}

/** True if a token expiring at `expiresAt` is still safely usable at `now` -
 *  shared by getValidAccessToken and restoreGoogleAuthOnStartup so "is this
 *  token still good" is decided in exactly one place. */
export function isTokenStillValid(expiresAt: number, now: number): boolean {
  return now < expiresAt - TOKEN_REFRESH_SKEW_MS;
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

/** True for a real-looking credential value - rejects empty strings and the
 *  example template's literal "YOUR_..." placeholders, so an un-edited copy
 *  of google-oauth-desktop-config.example.json is treated as "not
 *  configured" rather than attempted against Google's OAuth endpoint. */
export function looksLikeRealCredential(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && !v.startsWith("YOUR_");
}

export function parseClientConfig(parsed: Partial<OAuthClientConfig>): OAuthClientConfig | null {
  return looksLikeRealCredential(parsed.clientId) && looksLikeRealCredential(parsed.clientSecret)
    ? { clientId: parsed.clientId, clientSecret: parsed.clientSecret }
    : null;
}

// safeStorage-encrypted buffers on Windows begin with a "v10"/"v11" DPAPI
// prefix; a plain JSON file starts with "{". Lets an unencrypted token file
// (encryption unavailable at the time it was written) still be read back
// correctly rather than failing decryption.
export function isLikelyEncrypted(bytes: Buffer): boolean {
  return bytes.length > 0 && bytes[0] !== "{".charCodeAt(0);
}
