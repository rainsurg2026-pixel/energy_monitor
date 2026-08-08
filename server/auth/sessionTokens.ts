import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_TOKEN_BYTES = 32;
const MAX_SESSION_TOKEN_LENGTH = 512;
const SESSION_TOKEN_HASH_HEX_LENGTH = 64;

function assertTokenInput(token: unknown): asserts token is string {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_SESSION_TOKEN_LENGTH) throw new Error("Session token input is invalid.");
}

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/** Store this digest only. The raw token belongs in the HttpOnly cookie. */
export function hashSessionToken(token: string): string {
  assertTokenInput(token);
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionTokenHashesEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/u.test(left) || !/^[0-9a-f]{64}$/u.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
