# ADR-014: Authentication Platform v3.0

## Problem

`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` lists "Authentication
Platform" as one of nine **frozen** platform layers — modifiable only for
a confirmed defect, a security issue, a measurable performance
improvement, or an approved ADR. This is that ADR.

The frozen layer, as it stood: `lib/auth.ts` — a fully **stateless** JWT
(`jose`, HS256, the entire `SessionUser` spread directly as claims, a
single `mqr_session` cookie, 180-minute expiry) plus plain **unsalted
SHA-256** password hashing ("matches the legacy Apps Script hashes").
Concretely, that meant:

- **No server-side session record at all.** A session could not be
  listed, tied to a device, or revoked before its JWT naturally expired —
  "logout this session"/"logout all other devices"/an admin's "force
  logout all sessions" were all structurally impossible.
- **Password reset was 100% admin-driven.** `POST /api/admin/users/[id]/
  reset-password` let an admin type a new plaintext password directly
  into a SweetAlert2 prompt — no token, no email, no expiry, no
  self-service path at all.
- **No account lockout**, despite a half-built hook already sitting in
  `lib/db.ts`: `recentFailedLogins()` existed, queried `login_log`
  correctly, and was never called from anywhere.
- **No invitation flow.** An admin creating a user typed that user's
  actual initial password directly into the create-user form — the admin
  was the sole originator and holder of the credential; the user could
  never set their own first password.
- **No CSRF defense** beyond the incidental `sameSite: 'lax'` cookie
  attribute (which blocks some cross-site subrequests but not a
  top-level cross-site form POST).
- **No `user_sessions`/`password_reset_tokens`/`user_invitations` table**
  existed in the schema at all.

This ADR is the v3.0 evolution of that layer: Login UX polish, Forgot/
Reset Password, Change Password, Session Management, First Login
Password Change, User Invitation, and Account Lock Protection, built as
one PR of sequenced commits (confirmed with the user before
implementation, alongside a second confirmed decision: no new npm
dependency for User-Agent parsing — a hand-rolled parser instead of
`ua-parser-js`, per this repo's "no new dependency casually" convention).

## Decision

### Session Platform Foundation (the one real architectural shift)

Every session now gets a `user_sessions` row (`sessionService.ts`); the
JWT carries only an opaque `sessionId` used to look it up. `middleware.ts`
validates that row (not revoked, not expired) on every request via a raw
`fetch()` against Supabase's REST API — deliberately not
`@supabase/supabase-js`, since this file runs on the Edge runtime (same
reason it already reimplemented its own `jwtVerify` rather than importing
`lib/auth.ts`, which pulls in `next/headers`). This is the one accepted
performance tradeoff: one extra DB round trip per request, in exchange for
"logout this session" actually being immediate. Accepted because this
system's real traffic is small (a handful of dealer accounts) — documented
here as a future optimization point (a short-TTL cache in front of the
revocation check) if traffic ever grows, not solved speculatively now.

`SessionUser` gained two fields: `sessionId` (the lookup key above) and
`forcePasswordChange` (a JWT claim `middleware.ts` also checks, gating
every route except `/change-password` — First Login Password Change and
an expired password both set it, through the same mechanism).

### New services, `src/lib/authServices/` (plain function modules, matching this repo's existing `lib/auth.ts`/`lib/db.ts`/`lib/email.ts` style — not classes)

- **`sessionService.ts`** — create/validate/revoke (one, others, all)/list,
  plus `userAgentParser.ts` (hand-rolled device/browser/OS detection) and
  IP (`x-forwarded-for`) / approximate location (Vercel's automatic
  `x-vercel-ip-country`/`x-vercel-ip-city` request headers — zero new
  dependency, zero external geo-IP call, degrades to `null` off-Vercel).
- **`passwordService.ts`** — salted **scrypt** hashing (Node's built-in
  `crypto`, no new dependency — `users.password_algo`/`password_salt`
  already existed, and a dead `upgradePasswordHash()` helper in `db.ts`
  already anticipated exactly this migration). `verifyPassword()` branches
  on `password_algo`: a legacy row still verifies against its sha256 hash
  unchanged, and is opportunistically upgraded to scrypt the moment it
  next authenticates successfully — never a forced bulk migration.
  Complexity validation (8+ chars, letter + number), password history
  (last 5, self-contained `salt:hash` entries in a new `password_history`
  table), and the Minimum Password Age / Password Expiration policy knobs
  (both shipped **disabled by default** — `0` — per the spec's own
  "(optional)"/"(configurable)" wording).
- **`passwordResetService.ts`** / **`invitationService.ts`** — structurally
  identical token lifecycles (generate/validate/consume), sharing one
  new `auth_tokens` table with a `purpose` discriminator
  (`'password_reset'` | `'invitation'`) rather than two near-duplicate
  tables. Tokens: `crypto.randomBytes(32)`, only a `sha256` hash ever
  stored, single-use (`used_at`), expiring in 30 minutes (reset) or 7 days
  (invitation).
- **`auditService.ts`** — `auth_audit_log`, a **new, dedicated** table for
  exactly the 13 event types the spec names — deliberately *not* folded
  into `record_audit_log`/`AuditEventType`, which is business-record-scoped
  (`module`+`record_id` tied to an actual mqr/pm/ntr row); auth events
  aren't record events, and widening that type for something it doesn't
  fit would cost more than a second small table.
- **`lib/email.ts`** extended (not replaced) with a shared
  `buildEmailLayout()` reusing the existing brand-red inline-style
  pattern, plus the four templates the spec names (Invitation, Password
  Reset, Password Changed, Account Locked) — same "never throws, never
  blocks the caller" contract `sendRecordNotification` already established.

### Rate limiting

`rateLimitService.ts` counts `auth_audit_log` rows by IP within a time
window — deliberately DB-backed, not an in-memory limiter: this app runs
on Vercel serverless functions, which don't share memory across
invocations/cold starts, so an in-memory counter would silently not work
in production. Wired into `POST /api/auth/login` (30 attempts/15
minutes, counting both successes and failures) and
`POST /api/auth/forgot-password` (5 requests/hour). This is distinct from
Account Lock Protection, which only ever counts one *account's* own
failures — rate limiting catches many attempts spread across many
*different* usernames/emails from one IP, which per-account lockout
structurally cannot see. `forgot-password` now logs
`PASSWORD_RESET_REQUEST` unconditionally (found or not), not only when a
real account matched, so the count actually reflects total request
volume rather than only "hits" — the response shape is unaffected either
way, preserving the existing non-enumeration guarantee.

### CSRF

`lib/fetchJson.ts` attaches a custom header to every request;
`middleware.ts` rejects any mutating (`POST`/`PUT`/`PATCH`/`DELETE`)
`/api/*` request missing it. A simple cross-site `<form>` POST can't
attach a custom header — only same-origin `fetch`/XHR can, and a
cross-origin one would trigger a CORS preflight this app never allows.
The two call sites that bypassed `fetchJson` (logout;
`uploadAttachment.ts`'s direct `PUT` to a Supabase-signed URL, which isn't
even one of our own routes) got the header directly or didn't need it.
**NTR Legacy Import's upload route is explicitly exempted by prefix**
rather than modifying `legacy-import-tool.tsx` — root `CLAUDE.md`: "never
modify Legacy Import unless explicitly requested."

### RBAC

`canInviteUsers`/`canUnlockAccounts`/`canForceResetPassword`/
`canForceLogoutAllSessions` in `scope.ts` all alias the existing
`canManageUsers` boundary (`role !== 'DealerUser'`) — the same mapping
this codebase's 4 roles already use for "Admin or SuperAdmin."

## Data model

Five migrations, purely additive:

- `users` gains `force_password_change`, `failed_login_attempts`,
  `locked_until`, `password_changed_at`.
- `user_sessions` (new) — see `docs/architecture/AUTHENTICATION_PLATFORM.md`
  for the full column list and ER diagram.
- `auth_tokens` (new) — unifies reset + invitation tokens.
- `auth_audit_log` (new) — the 13 spec event types.
- `password_history` (new) — last 5 per user.

RLS: the same permissive-anon/app-layer-boundary model every other table
in this schema already uses (no Supabase Auth; `docs/standards/
SECURITY_STANDARD.md` documents why) — enforcement lives in the services
above, not in RLS policies.

## Not changed / explicitly out of scope

- **NTR Legacy Import** — untouched, per the constraint above.
- **Real geo-IP** beyond Vercel's request headers.
- **Multi-factor authentication** — not requested.
- **Enforced password expiration/min-age** — shipped as disabled-by-default
  config knobs, not turned on.
- Dedicated unit tests for `sessionService.ts`, `auditService.ts`, and
  most API route handlers beyond `login/route.test.ts` — covered by live
  UAT on the Preview deploy instead; tracked as remaining technical debt.

## Rollback

Every migration is additive (new tables, new nullable/defaulted columns)
— no data loss, no destructive schema change. Reverting this PR's commits
restores the prior stateless-JWT/admin-only-reset behavior exactly;
`middleware.ts`'s session-revocation check and `forcePasswordChange` gate
are the only pieces that would need to be reverted carefully together
(they're additive gates, not replacements, so a partial revert can't
leave the app in a state where a session is checked against a table that
no longer exists — reverting the whole PR removes both the check and the
table's schema-dependency together).

## Consequences

- Session revocation ("logout this device," an admin's forced logout) is
  now real, not merely theoretical until a JWT's natural 180-minute
  expiry.
- Every password older than this PR is a plain unsalted SHA-256 hash
  until its owner's next successful login — by design, not an oversight;
  see the "opportunistic upgrade" note above.
- The frozen Authentication Platform layer is reopened deliberately, once,
  through this ADR — not a precedent for casual future changes to it;
  the same confirmed-defect/security-issue/perf-issue/approved-ADR bar
  from `PLATFORM_ARCHITECTURE_STANDARDS.md` still applies going forward.
