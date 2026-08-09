import { SignJWT, jwtVerify } from "jose";

/**
 * Session lifecycle, ported from mqr-webapp-new's `lib/auth.ts` /
 * `middleware.ts` hybrid model: a signed JWT is the cookie value, but it is
 * never trusted as the sole authority. It wraps the same opaque session
 * secret this app already hashes and stores in `public.sessions.token_hash`
 * (see `sessions.ts`/`sessionTokens.ts`, both unchanged) so the existing
 * DB-backed revocation check - the actual authority - still runs on every
 * request exactly as before. The JWT only adds a fast, stateless signature
 * check ahead of that DB lookup, and self-describes `userId`/`role` the way
 * mqr's `SessionUser` claims do.
 *
 * Deliberately not reused as-is: mqr signs the full `SessionUser` business
 * object (including its dealer/branch tenancy fields) because its Edge
 * Middleware trusts the JWT alone for those claims. This app re-derives
 * `role`/`active` from the DB on every request regardless (see
 * `authService.ts#authenticateSession`), so the claims below are limited to
 * what's needed to locate and describe the session, not authorize it.
 */
export interface SessionTokenClaims {
  /** The opaque session secret whose SHA-256 hash is the DB lookup key. */
  sid: string;
  userId: string;
  role: string;
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSessionJwt(claims: SessionTokenClaims, secret: string, expiresAt: Date): Promise<string> {
  return new SignJWT({ sid: claims.sid, userId: claims.userId, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(encodeSecret(secret));
}

export async function verifySessionJwt(token: string, secret: string): Promise<SessionTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, encodeSecret(secret));
    const { sid, userId, role } = payload;
    if (typeof sid !== "string" || sid.length === 0) return null;
    if (typeof userId !== "string" || userId.length === 0) return null;
    if (typeof role !== "string" || role.length === 0) return null;
    return { sid, userId, role };
  } catch {
    return null;
  }
}
