import crypto from "node:crypto";

/**
 * PKCE (RFC 7636) and refresh-token-at-rest encryption for the Admin
 * Google OAuth backup connection. Deliberately reimplemented here rather
 * than importing src/electron/googleAuthPure.ts - that module lives on
 * the Desktop/Electron side of the codebase; importing across that
 * boundary into server/ (a Vercel serverless/Express runtime with no
 * Electron available) would be a real coupling hazard even though the
 * underlying algorithm (base64url + SHA-256) is identical by design.
 *
 * Token encryption reuses SESSION_SECRET via HKDF (RFC 5869) to derive a
 * purpose-separated subkey, rather than requiring a brand-new provisioned
 * secret - a single high-entropy secret can safely derive multiple
 * independent subkeys as long as each derivation uses a distinct "info"
 * label, which is exactly what HKDF is for. This follows the same
 * "reuse before rewrite" principle as the rest of this codebase's secret
 * handling (SESSION_SECRET/CSRF_SECRET are already both provisioned,
 * independent 32+ character values - see docs/web-v3/ROLLBACK_PLAN.md).
 */

const HKDF_INFO = "energy-monitor-google-oauth-token-encryption-v1";
const HKDF_SALT = "energy-monitor-backup";

export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function makeCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

export function makeCodeChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

export function makeOAuthState(): string {
  return base64url(crypto.randomBytes(24));
}

export function hashState(state: string): string {
  return crypto.createHash("sha256").update(state).digest("hex");
}

function deriveEncryptionKey(sessionSecret: string): Buffer {
  const derived = crypto.hkdfSync("sha256", sessionSecret, HKDF_SALT, HKDF_INFO, 32);
  return Buffer.from(derived);
}

/** AES-256-GCM, random 12-byte IV per call, output as
 *  "v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>" - never a raw
 *  token, never logged, never returned to the browser. Used for both the
 *  long-lived refresh token (google_sheets_connections) and the
 *  short-lived PKCE code_verifier (google_oauth_states) - both are
 *  secret-adjacent values for however long they're stored, even though
 *  the state row is single-use and short-lived. */
export function encryptSecret(plaintext: string, sessionSecret: string): string {
  const key = deriveEncryptionKey(sessionSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export class TokenDecryptionError extends Error {
  readonly code = "TOKEN_DECRYPTION_FAILED";
}

export function decryptSecret(encoded: string, sessionSecret: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new TokenDecryptionError("Unrecognized encrypted token format.");
  const [, ivPart, authTagPart, ciphertextPart] = parts;
  try {
    const key = deriveEncryptionKey(sessionSecret);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64"));
    decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64")), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new TokenDecryptionError("Stored token could not be decrypted - it may have been encrypted under a different SESSION_SECRET.");
  }
}
