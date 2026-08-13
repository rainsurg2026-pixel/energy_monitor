import type { AuthIdentityKey, AuthProvider } from "./types";

export const AUTH_PROVIDERS: readonly AuthProvider[] = ["local", "entra"];

export function assertAuthIdentityKey(key: AuthIdentityKey): void {
  if (!AUTH_PROVIDERS.includes(key.provider)) throw new Error("Authentication provider is not supported.");
  if (typeof key.providerSubject !== "string" || key.providerSubject.trim() === "") throw new Error("Provider subject is required.");
  if (/\s/u.test(key.providerSubject)) throw new Error("Provider subject must not contain whitespace.");
  if (key.providerTenant !== undefined && key.providerTenant !== null && key.providerTenant.trim() === "") throw new Error("Provider tenant must not be blank.");
}

/**
 * A deterministic lookup key for a unique (provider, tenant, subject) tuple.
 * It is not an authorization claim and must not replace the stable user ID.
 */
export function authIdentityLookupKey(key: AuthIdentityKey): string {
  assertAuthIdentityKey(key);
  return [key.provider, key.providerTenant ?? "", key.providerSubject].join("\u001f");
}
