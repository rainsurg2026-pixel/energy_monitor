export const DEFAULT_PASSWORD_POLICY = Object.freeze({
  minLength: 6,
  maxLength: 1024
});

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
}

export type PasswordPolicyViolationCode =
  | "PASSWORD_NOT_STRING"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_WHITESPACE_ONLY";

export interface PasswordPolicyViolation {
  valid: false;
  code: PasswordPolicyViolationCode;
  message: string;
}

export interface PasswordPolicySuccess {
  valid: true;
}

export type PasswordPolicyResult = PasswordPolicySuccess | PasswordPolicyViolation;

export class PasswordPolicyError extends Error {
  constructor(readonly code: PasswordPolicyViolationCode, message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function validPolicy(policy: PasswordPolicy): boolean {
  return Number.isSafeInteger(policy.minLength)
    && Number.isSafeInteger(policy.maxLength)
    && policy.minLength > 0
    && policy.maxLength >= policy.minLength;
}

export function validatePassword(
  password: unknown,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY
): PasswordPolicyResult {
  if (!validPolicy(policy)) throw new Error("Password policy bounds are invalid.");
  if (typeof password !== "string") return { valid: false, code: "PASSWORD_NOT_STRING", message: "Password must be a string." };
  if (/^\s*$/u.test(password)) return { valid: false, code: "PASSWORD_WHITESPACE_ONLY", message: "Password must not be blank or whitespace-only." };

  const length = codePointLength(password);
  if (length < policy.minLength) return { valid: false, code: "PASSWORD_TOO_SHORT", message: `Password must contain at least ${policy.minLength} characters.` };
  if (length > policy.maxLength) return { valid: false, code: "PASSWORD_TOO_LONG", message: `Password must not exceed ${policy.maxLength} characters.` };
  return { valid: true };
}

export function assertPasswordPolicy(
  password: unknown,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY
): asserts password is string {
  const result = validatePassword(password, policy);
  if (result.valid === false) throw new PasswordPolicyError(result.code, result.message);
}

export function normalizeUsername(username: unknown): string {
  if (typeof username !== "string") throw new Error("Username must be a string.");
  const normalized = username.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (normalized.length === 0) throw new Error("Username must not be blank.");
  if (Array.from(normalized).length > 128) throw new Error("Username is too long.");
  if (/[\u0000-\u001F\u007F]/u.test(normalized)) throw new Error("Username contains prohibited control characters.");
  return normalized;
}
