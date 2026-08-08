import * as argon2 from "argon2";
import { assertPasswordPolicy, DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from "./passwordPolicy";

export const ARGON2ID_PASSWORD_VERSION = "argon2id-v1";

export interface Argon2idParameters {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  hashLength: number;
  saltLength: number;
}

export const DEFAULT_ARGON2ID_PARAMETERS: Readonly<Argon2idParameters> = Object.freeze({
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16
});

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
  needsRehash(encodedHash: string): boolean;
}

function isArgon2idHash(encodedHash: string): boolean {
  return typeof encodedHash === "string" && encodedHash.startsWith("$argon2id$");
}

function validParameters(parameters: Argon2idParameters): boolean {
  return Object.values(parameters).every(value => Number.isSafeInteger(value) && value > 0);
}

export class Argon2idPasswordHasher implements PasswordHasher {
  private readonly parameters: Readonly<Argon2idParameters>;

  constructor(parameters: Partial<Argon2idParameters> = {}) {
    this.parameters = Object.freeze({ ...DEFAULT_ARGON2ID_PARAMETERS, ...parameters });
    if (!validParameters(this.parameters)) throw new Error("Argon2id parameters are invalid.");
  }

  async hash(password: string): Promise<string> {
    return argon2.hash(password, { ...this.parameters, type: argon2.argon2id });
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    if (!isArgon2idHash(encodedHash)) return false;
    try {
      return await argon2.verify(encodedHash, password);
    } catch {
      return false;
    }
  }

  needsRehash(encodedHash: string): boolean {
    if (!isArgon2idHash(encodedHash)) return true;
    try {
      return argon2.needsRehash(encodedHash, {
        memoryCost: this.parameters.memoryCost,
        timeCost: this.parameters.timeCost,
        parallelism: this.parameters.parallelism
      });
    } catch {
      return true;
    }
  }
}

export async function hashNewPassword(
  password: unknown,
  hasher: PasswordHasher = new Argon2idPasswordHasher(),
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY
): Promise<string> {
  assertPasswordPolicy(password, policy);
  return hasher.hash(password);
}

export function isArgon2idEncodedHash(encodedHash: string): boolean {
  return isArgon2idHash(encodedHash);
}
