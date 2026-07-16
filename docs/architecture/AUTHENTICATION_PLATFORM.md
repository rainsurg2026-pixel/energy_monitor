# Authentication Platform v3.0

The reopened, v3.0 evolution of the frozen Authentication Platform layer
(`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s Foundation Freeze list).
Rationale for reopening it: `docs/adr/ADR-014-Authentication-Platform-v3.md`.

## v3.0.1 — production reliability patch

**Production bug, not a redesign.** A live incident traced Forgot
Password not delivering email back to a real root cause: `sendEmail()`
and `logAuthEvent()` calls after the last `await` in several routes were
fire-and-forget (`.catch(() => {})`, never `await`ed). Vercel can freeze
a serverless function's execution the instant its HTTP response is sent
— neither call was guaranteed to run to completion before that happened.
Direct evidence: a `PASSWORD_RESET_REQUEST` audit row that never got
written despite the `auth_tokens` insert immediately before it (in the
same code path) succeeding. Separately, the Resend SDK *resolves* (never
throws) on provider-level errors — the old code never checked the
resolved `error` field, so a provider rejection was indistinguishable
from success.

Six issues fixed, all reliability-only — **no change to any route's
response shape, status codes, or the anti-enumeration security model**:

1. **Fire-and-forget execution** — every background call in the
   Authentication Platform (email sends, audit log writes, session
   revocations) is now `await`ed through `authServices/reliability.ts`'s
   `ensureCompletion()`, which never throws and never changes what the
   caller returns, so completion is guaranteed without changing behavior.
2. **Email provider result** — `email.ts`'s `sendAuthEmail()` now inspects
   the Resend SDK's resolved `{ data, error }` response explicitly, wraps
   the call in a 10s timeout (`withTimeout()`, since awaiting it per
   Issue 1 means a hung provider could otherwise block the response
   forever), and returns a structured `EmailSendResult` instead of `void`.
3. **Email Health service** — `authServices/emailHealthService.ts`,
   `GET /api/admin/email-health`. Exposes provider, sender, configuration,
   a sandbox-sender heuristic ("Verification"), last send, last failure,
   and an overall status, derived from env vars + `auth_audit_log`.
4. **Admin Test Email** — `POST /api/admin/email-health/test` +
   `/admin/email-health` page's "Send Test Email" button. Exercises the
   exact same `sendAuthEmail` path as every real auth email.
5. **User Email Completeness** — `GET /api/admin/users` and the admin
   Users table now surface, per user: Email Missing, Email Verified
   (derived from the latest `EMAIL_SEND_SUCCESS`/`EMAIL_SEND_FAILURE` for
   that user — not a confirmation-link flow, which doesn't exist here),
   and Forgot Password Available (the exact `eligible` check the route
   itself uses).
6. **Audit reliability** — `PASSWORD_RESET_REQUEST` is now logged for
   *every* request that reaches the route (including an empty identifier
   and the outer-catch error branch, both previously silent gaps), always
   awaited.

New, additive `AuthAuditEventType` values: `EMAIL_SEND_SUCCESS`,
`EMAIL_SEND_FAILURE`. New scope predicate: `canManageEmailHealth`
(`SuperAdmin`/`CentralAdmin` only — email configuration has no
dealer-scoping to speak of, unlike the per-user admin actions).

**Migration required and applied**: `auth_audit_log.event_type` has a
Postgres CHECK constraint enumerating every valid value — additive
`AuthAuditEventType` values in TypeScript do not, by themselves, update
it. Caught live during this patch's own verification (every
`EMAIL_SEND_SUCCESS`/`EMAIL_SEND_FAILURE` write failed with
`violates check constraint "auth_audit_log_event_type_check"`, itself
swallowed by `logAuthEvent`'s own never-throws contract — an ironic
near-miss for a patch about not silently losing audit records). Fixed by
migration `add_email_send_audit_event_types` (additive: drops and
re-adds the constraint with the same 13 existing values plus the 2 new
ones — no existing row is affected). Anyone adding a new
`AuthAuditEventType` in the future must remember this same step, or the
new event type will silently fail to insert exactly the same way.

## Architecture summary

```
Browser
  │  mqr_session cookie (JWT: SessionUser + sessionId + forcePasswordChange)
  ▼
middleware.ts (Edge runtime)
  │  1. jwtVerify (signature/expiry)
  │  2. raw REST fetch → user_sessions row: revoked_at/expires_at check
  │  3. forcePasswordChange → gate everything except /change-password
  ▼
Route Handler / Server Component
  │  getSession() (lib/auth.ts) - re-verifies JWT, fire-and-forget
  │  touchLastActivity(sessionId)
  ▼
src/lib/authServices/*  ──────────────►  Supabase (users, user_sessions,
  sessionService / passwordService /        auth_tokens, auth_audit_log,
  passwordResetService / invitationService  password_history)
  / auditService
  │
  ▼
lib/email.ts (Resend) - Invitation / Password Reset / Password Changed /
                          Account Locked templates
```

No part of this reuses or duplicates `record_audit_log` (business-record
audit trail) or the Activity Timeline platform — this is a parallel,
account-security-scoped concern with its own table (`auth_audit_log`).

## Event model (`auth_audit_log`)

```ts
interface AuthAuditEvent {
  id: string;
  event_type:
    | 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'ACCOUNT_LOCKED' | 'ACCOUNT_UNLOCKED'
    | 'PASSWORD_RESET_REQUEST' | 'PASSWORD_RESET_SUCCESS' | 'PASSWORD_CHANGED'
    | 'SESSION_CREATED' | 'SESSION_REVOKED' | 'SESSION_REVOKED_ALL'
    | 'USER_INVITED' | 'INVITATION_ACCEPTED' | 'FORCE_PASSWORD_CHANGE_COMPLETED'
    | 'EMAIL_SEND_SUCCESS' | 'EMAIL_SEND_FAILURE'; // v3.0.1, additive
  username: string | null;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
```

`logAuthEvent()` (`lib/authServices/auditService.ts`) never throws — an
audit-log write failure must never break the auth action it describes,
the same contract `lib/email.ts`'s notification sends already use.

## ER diagram (new tables + `users` additions)

```mermaid
erDiagram
    users ||--o{ user_sessions : "has"
    users ||--o{ auth_tokens : "has"
    users ||--o{ password_history : "has"
    users ||--o{ auth_audit_log : "acted as"

    users {
        uuid id PK
        text password_algo "sha256 | scrypt"
        text password_salt "scrypt only"
        boolean force_password_change
        int failed_login_attempts
        timestamptz locked_until
        timestamptz password_changed_at
    }
    user_sessions {
        uuid id PK
        uuid user_id FK
        text session_id UK "opaque JWT lookup key"
        text device_name
        text browser
        text os
        text ip_address
        text user_agent
        text approx_location
        timestamptz last_activity
        timestamptz created_at
        timestamptz expires_at
        timestamptz revoked_at
        text revoked_reason
    }
    auth_tokens {
        uuid id PK
        uuid user_id FK
        text purpose "password_reset | invitation"
        text token_hash UK "sha256(raw token)"
        timestamptz created_at
        timestamptz expires_at
        timestamptz used_at
        text created_by
    }
    auth_audit_log {
        uuid id PK
        text event_type
        text username
        uuid user_id
        text ip_address
        text user_agent
        jsonb metadata
        timestamptz created_at
    }
    password_history {
        uuid id PK
        uuid user_id FK
        text password_hash "salt:hash"
        timestamptz created_at
    }
```

## Sequence diagrams

### Login (with lockout + Session Foundation)

```mermaid
sequenceDiagram
    participant B as Browser
    participant M as middleware.ts
    participant R as /api/auth/login
    participant D as users / user_sessions

    B->>R: POST username, password
    R->>D: findUserByUsername
    R->>R: checkLockStatus(user)
    alt locked
        R-->>B: 423 "account locked, retry in 15m"
    else not locked
        R->>R: verifyPassword (scrypt or legacy sha256)
        alt wrong password
            R->>D: recordFailedLogin (may transition to locked)
            R-->>B: 401 invalid credentials
        else correct
            R->>D: resetFailedLogins
            R->>D: opportunistic sha256→scrypt upgrade
            R->>D: createSession → user_sessions row
            R->>B: Set-Cookie mqr_session (JWT incl. sessionId)
        end
    end
    Note over B,M: every later request
    B->>M: any request (cookie attached)
    M->>D: REST fetch - is session_id revoked/expired?
    M-->>B: 200 / 401 / redirect
```

### Forgot / Reset Password

```mermaid
sequenceDiagram
    participant B as Browser
    participant F as /api/auth/forgot-password
    participant Rs as /api/auth/reset-password
    participant D as auth_tokens
    participant E as Resend

    B->>F: POST identifier (username or email)
    F->>D: find user, generateResetToken (if found+active+has email)
    F->>E: await sendPasswordResetEmail (v3.0.1 - awaited, not fire-and-forget)
    F->>D: await logAuthEvent(PASSWORD_RESET_REQUEST) (always, every branch)
    F-->>B: 200 generic message (always, regardless of outcome)

    B->>Rs: POST token, newPassword, confirmPassword
    Rs->>D: validateResetToken (not_found | expired | used | valid)
    alt invalid
        Rs-->>B: 400 distinct reason message
    else valid
        Rs->>D: applyNewPassword + recordPasswordHistory + consumeResetToken
        Rs->>D: revokeAllSessions (every existing session, not just others)
        Rs->>E: sendPasswordChangedEmail
        Rs-->>B: 200 → client redirects to /login
    end
```

### User Invitation

```mermaid
sequenceDiagram
    participant A as Admin (users-table.tsx)
    participant C as POST /api/admin/users
    participant U as /accept-invitation
    participant D as users / auth_tokens
    participant E as Resend

    A->>C: create user, invite=true, email required
    C->>D: createUserAdmin(active=false, placeholder password_hash)
    C->>D: generateInvitationToken (purpose=invitation, 7d)
    C->>E: sendInvitationEmail
    Note over U: user opens the emailed link
    U->>D: validateInvitationToken
    U->>D: applyNewPassword + activateUserAccount + consumeInvitationToken
    U-->>A: 200 → client redirects to /login
```

## API design

No generic public "Activity/Auth API" was introduced — every route above
is a thin, purpose-specific Next.js Route Handler under `/api/auth/*`
calling straight into the services above, matching every other route in
this codebase. `GET /api/auth/sessions` is the one read endpoint (Active
Sessions list), scoped to the caller's own `user_id` only — there is no
admin endpoint to list another user's sessions in this PR (an admin's
"force logout all sessions" acts blind, by user id, without seeing the
list first — a reasonable v1 limitation, not a security gap, since it
still requires `canForceLogoutAllSessions`).

## Extension points

- **New event types**: add to `AuthAuditEventType` in `auditService.ts` —
  purely additive, no redesign (matches how `ActivityEventType` in the
  Activity Timeline platform was designed for the same additive-only
  future).
- **New token purposes**: add to `auth_tokens.purpose`'s check constraint
  and a new `purpose` value — the generate/validate/consume shape is
  already generic across reset and invitation.
- **A future admin Sessions-across-users view**: `sessionService.ts`'s
  `listSessionsForUser(userId)` already exists; a new admin route would
  just call it with a different `userId`, gated by a new
  `canViewOtherSessions`-style predicate — no service change needed.

## Pagination / performance strategy

`listSessionsForUser()` has no pagination — a single user's active
session count is realistically small (this app has no "hundreds of
devices" use case). If that assumption ever breaks, the same
`.slice()`-based "Load more" pattern the Activity Timeline platform uses
is the documented fallback, not a redesign.

## Security review

| Area | Status |
|---|---|
| Password storage | Salted scrypt going forward; legacy sha256 rows upgrade opportunistically on next login. Never plaintext, never logged. |
| Reset/invitation tokens | `crypto.randomBytes(32)`, only `sha256(token)` stored, single-use, time-limited (30m / 7d). |
| Account enumeration | Forgot Password always returns the same generic message/shape, including on internal error - never distinguishes "not found" from "found." |
| Brute force (per-account) | 5 failed attempts → 15-minute lock, checked before password comparison; every attempt logged to both `login_log` and `auth_audit_log`. |
| Rate limiting (per-IP) | `rateLimitService.ts` - counts `auth_audit_log` rows by IP within a window (DB-backed, not in-memory, since Vercel serverless functions don't share memory across invocations). Login: 30 attempts/15m; Forgot Password: 5 requests/hour - catches distributed attempts across many usernames from one IP, which per-account lockout can't see. |
| Session revocation | Real, DB-backed, checked on every request via `middleware.ts` - not merely "wait for the JWT to expire." |
| CSRF | Custom-header check on every mutating `/api/*` request (Legacy Import explicitly, narrowly exempted - see ADR-014). |
| RBAC | Invite (`/api/admin/users` invite mode) and unlock (`/api/admin/users/[id]/unlock`) are gated by dedicated `scope.ts` predicates (`canInviteUsers`/`canUnlockAccounts`), checked server-side - never UI-only. `canForceResetPassword`/`canForceLogoutAllSessions` were added per spec section 13's RBAC list but are **not yet wired to any route** in this PR - see Remaining technical debt below. |
| Email enumeration via invite/reset | Both flows require the actor to already know a valid identifier or have admin access; neither leaks account existence beyond the deliberately-generic Forgot Password response. |
| Email delivery reliability (v3.0.1) | Every auth email send and its audit record are now `await`ed before the response returns (`ensureCompletion()`), with a 10s provider timeout and explicit inspection of the provider's resolved error response - closes the exact gap the production incident found (see "v3.0.1" above). |

## Backward compatibility

- **Password verification**: `verifyPassword()` branches on `password_algo` - every existing `users` row (`password_algo` defaults to `'sha256'`) verifies exactly as it did before this PR; nothing is force-migrated. A row upgrades to `scrypt` only opportunistically, on its own next successful login.
- **No breaking schema change**: every new column is nullable or defaulted (`force_password_change boolean default false`, `failed_login_attempts int default 0`, etc.) and every new table is additive - no existing table/column is altered or dropped (11's Database Evolution Strategy discipline, applied here first).
- **Admin-set temporary passwords** (`/api/admin/users/[id]/reset-password`, pre-existing route) write a plain sha256 hash, matching the existing convention - and now explicitly reset `password_algo`/`password_salt` back to that legacy shape in the same write, so an account already opportunistically upgraded to `scrypt` is not left in an inconsistent, unrecoverable state after an admin resets its password (fixed during this PR's final production-readiness review - see `resetUserPassword()` in `lib/db.ts`).
- **One-time side effect on deploy**: every JWT issued before this PR ships has no `sessionId` claim. `middleware.ts` treats that as an invalid session, so **every currently logged-in user is signed out once, the first time they load any page after this deploys**, and must log in again (which immediately issues a session-backed JWT). This is expected, unavoidable given the session model change, and should be communicated to users/support ahead of the production deploy - it is not a bug.

## Remaining technical debt

1. No dedicated unit tests for `sessionService.ts`, `auditService.ts`, or
   most route handlers beyond `login/route.test.ts` (covered by live UAT
   instead - see ADR-014).
2. No admin UI to view another user's active sessions (only their own) -
   an admin's "force logout all" acts without a preview list.
3. Real geo-IP and multi-factor authentication are out of scope for this
   PR (see ADR-014's "Not changed" section). IP-based rate limiting
   *was* added (`rateLimitService.ts`) after being initially deferred.
4. Password expiration/minimum-age ship disabled by default - turning
   them on for real accounts (if ever needed) is a config change, not a
   code change, but has not been exercised against real user data.
5. The invited-but-not-yet-accepted state shows in the admin Users table
   as a plain "inactive" badge, identical to a manually-disabled account -
   a future enhancement could distinguish "pending invitation" visually.
6. `canForceResetPassword`/`canForceLogoutAllSessions` (`scope.ts`) are
   defined per spec section 13's RBAC list but have no route wired to
   them yet - the existing `/api/admin/users/[id]/reset-password` route
   uses `canManageUsers` (unchanged from before this PR), and there is no
   admin "force logout all of this user's sessions" route at all yet
   (only self-service `/api/auth/sessions/revoke-all` for one's own
   sessions). Extension point, not a gap in what shipped - see
   `AUTHENTICATION_PLATFORM.md`'s Extension points section above.
7. **(v3.0.1)** `touchLastActivity()` in `lib/auth.ts`'s `getSession()`
   remains intentionally fire-and-forget, not awaited - it runs on every
   authenticated request in the entire app (not just Authentication
   Platform routes), so awaiting it would add a DB round-trip to every
   page load for a value (a "last seen" timestamp) that carries no
   security or audit weight. A stale/lost update here is cosmetic; a lost
   password-reset email or audit record is not. Scoped out of this patch
   deliberately, not missed.
8. **(v3.0.1)** "Email Verified" (Issue 5) is derived from this
   platform's own send history, not a confirmation-link verification
   flow - which does not exist in this system and was not added by this
   patch (would be a new feature, not a reliability fix). A user who has
   never triggered an auth email shows `Unknown`, not `false`.
9. **(v3.0.1)** Email Health's "Verification" field is a heuristic (is a
   custom `RESEND_FROM_EMAIL` configured, i.e. not the Resend sandbox
   sender) rather than a live call to Resend's domain-verification API -
   deliberately, to avoid a second external API dependency/failure mode
   in a reliability patch whose whole point is reducing failure modes.
10. **(v3.0.1)** The pre-existing MQR record-notification email path
    (`sendRecordNotification`, `lib/email.ts`) was already `await`ed at
    both call sites (`api/records/route.ts`, `api/records/[jobId]/
    route.ts`) - not affected by, and out of scope for, this
    Authentication-only patch.
