/**
 * Unit tests for the pure, Electron-independent logic in
 * src/electron/googleAuth.ts (PKCE math, token-expiry decision, client-
 * config validation). The rest of that module (loopback HTTP listener,
 * shell.openExternal, safeStorage, real Google endpoints) can only be
 * meaningfully exercised inside a real Electron process - see
 * scripts/e2e-cdp.mjs's Google Sheets checks for that coverage (everything
 * short of real user consent, which is a genuine external blocker).
 */
import {
  base64url,
  makeCodeChallenge,
  isTokenStillValid,
  looksLikeRealCredential,
  parseClientConfig,
  isLikelyEncrypted
} from "../src/electron/googleAuthPure";

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

// ---- PKCE: RFC 7636 Appendix B official test vector ----
// https://www.rfc-editor.org/rfc/rfc7636#appendix-B
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
check("PKCE code_challenge matches RFC 7636 Appendix B test vector", makeCodeChallenge(RFC_VERIFIER) === RFC_CHALLENGE);
check("base64url never emits '+', '/', or '=' padding", (() => {
  // A buffer whose plain base64 encoding is guaranteed to contain '+', '/', and '='.
  const buf = Buffer.from([0xfb, 0xff, 0xbf]);
  const plain = buf.toString("base64");
  const url = base64url(buf);
  return plain.includes("+") && plain.includes("/") && !/[+/=]/.test(url);
})());
check("base64url output is deterministic for the same input", base64url(Buffer.from("energy-monitor")) === base64url(Buffer.from("energy-monitor")));

// ---- Token expiry decision ----
const NOW = 1_700_000_000_000;
check("a token expiring 10 minutes from now is still valid", isTokenStillValid(NOW + 10 * 60 * 1000, NOW) === true);
check("a token expiring in 30 seconds (inside the 60s refresh skew) is NOT valid", isTokenStillValid(NOW + 30 * 1000, NOW) === false);
check("a token that already expired is NOT valid", isTokenStillValid(NOW - 1000, NOW) === false);
check("a token expiring exactly at the skew boundary is NOT valid (skew is exclusive)", isTokenStillValid(NOW + 60 * 1000, NOW) === false);
check("a token expiring just past the skew boundary IS valid", isTokenStillValid(NOW + 60 * 1000 + 1, NOW) === true);

// ---- Client credential validation ----
check("a real-looking client id is accepted", looksLikeRealCredential("123456-abcdef.apps.googleusercontent.com") === true);
check("an empty string is rejected", looksLikeRealCredential("") === false);
check("the example template's placeholder is rejected", looksLikeRealCredential("YOUR_DESKTOP_OAUTH_CLIENT_ID.apps.googleusercontent.com") === false);
check("a non-string value is rejected", looksLikeRealCredential(undefined) === false);
check("a fully real-looking config parses to a non-null client", parseClientConfig({ clientId: "real-id", clientSecret: "real-secret" }) !== null);
check("a config with a real id but placeholder secret is rejected entirely (all-or-nothing)", parseClientConfig({ clientId: "real-id", clientSecret: "YOUR_DESKTOP_OAUTH_CLIENT_SECRET" }) === null);
check("an empty config object is rejected", parseClientConfig({}) === null);

// ---- Token file encryption sniffing ----
check("a plain JSON buffer is detected as NOT encrypted", isLikelyEncrypted(Buffer.from('{"accessToken":"x"}', "utf8")) === false);
check("a non-JSON (DPAPI-prefixed-looking) buffer is detected as encrypted", isLikelyEncrypted(Buffer.from([0x76, 0x31, 0x30, 0x01, 0x02])) === true);
check("an empty buffer is treated as NOT encrypted (nothing to decrypt)", isLikelyEncrypted(Buffer.alloc(0)) === false);

console.log(failures === 0 ? "\nALL GOOGLE AUTH UNIT TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
