import { Argon2idPasswordHasher, isArgon2idEncodedHash, type PasswordHasher } from "./passwordHasher";
import type { AuthUserId, LocalCredential } from "./types";

export const GENERIC_LOGIN_FAILURE = Object.freeze({
  code: "INVALID_CREDENTIALS",
  message: "Invalid username or password."
});

export interface CredentialVerificationSuccess {
  authenticated: true;
  userId: AuthUserId;
  needsRehash: boolean;
}

export interface CredentialVerificationFailure {
  authenticated: false;
  userId: null;
  needsRehash: false;
  failure: typeof GENERIC_LOGIN_FAILURE;
}

export type CredentialVerificationResult = CredentialVerificationSuccess | CredentialVerificationFailure;

/**
 * Verifies credentials without exposing whether a user exists or whether a
 * stored hash is malformed. A dummy Argon2id hash is required so unknown
 * usernames perform the same expensive verification operation as known ones.
 */
export class CredentialVerifier {
  constructor(
    private readonly dummyPasswordHash: string,
    private readonly hasher: PasswordHasher = new Argon2idPasswordHasher()
  ) {
    if (!isArgon2idEncodedHash(dummyPasswordHash)) throw new Error("A valid Argon2id dummy hash is required.");
  }

  async verify(password: unknown, credential: LocalCredential | null): Promise<CredentialVerificationResult> {
    const passwordText = typeof password === "string" ? password : "";
    const encodedHash = credential && isArgon2idEncodedHash(credential.passwordHash)
      ? credential.passwordHash
      : this.dummyPasswordHash;
    const matched = await this.hasher.verify(passwordText, encodedHash);

    if (!credential || !matched) {
      return { authenticated: false, userId: null, needsRehash: false, failure: GENERIC_LOGIN_FAILURE };
    }
    return { authenticated: true, userId: credential.userId, needsRehash: this.hasher.needsRehash(credential.passwordHash) };
  }
}
