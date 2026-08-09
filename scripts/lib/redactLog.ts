/**
 * Defense-in-depth log scrubber shared by network-only Preview/Production
 * verification scripts. Each entry redacts its ENTIRE match, never a
 * substring derived from it - an earlier version tried to preserve a
 * "key=" prefix by splitting the matched text, which silently failed to
 * redact a bare JWT and a multi-word "Authorization: Bearer <token>"
 * value (the split found no separator inside the match, so the original
 * secret text was reassembled with "=[REDACTED]" appended after it).
 * Replacing the whole match with a fixed marker cannot leak a fragment
 * the way that approach could.
 */
const SENSITIVE_LOG_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bauthorization\s*:\s*.+$/giu, replacement: "authorization: [REDACTED]" },
  { pattern: /\b(?:set-)?cookie\s*:\s*.+$/giu, replacement: "cookie: [REDACTED]" },
  { pattern: /\b(?:em_csrf|session|token)=[^\s;,"']+/giu, replacement: "[REDACTED]" },
  { pattern: /\bBearer\s+\S+/giu, replacement: "Bearer [REDACTED]" },
  // JWT-shaped: header.payload.signature
  { pattern: /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, replacement: "[REDACTED]" }
];

export function maskSensitive(value: string): string {
  let masked = value;
  for (const { pattern, replacement } of SENSITIVE_LOG_PATTERNS) masked = masked.replace(pattern, replacement);
  return masked;
}

export function safeLog(message: string): void { console.log(maskSensitive(message)); }
export function safeError(message: string): void { console.error(maskSensitive(message)); }
