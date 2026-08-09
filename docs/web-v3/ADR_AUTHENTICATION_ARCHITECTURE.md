# ADR: Web v3 Authentication Architecture

**Status:** Accepted, 2026-08-09
**Filed under `docs/web-v3/`**, not `docs/adr/` — that folder's `ADR-001`
through `ADR-038` document a different application (dealer/vehicle/NTR
domain, no relation to Energy Monitor) that appears to have been copied into
this repository by mistake. Reusing its numbering would collide with an
unrelated `ADR-001-Supabase.md`. This ADR follows `docs/web-v3/`'s existing
`PHASE*.md` documentation convention instead.

## Context

The web migration's standing instructions name `D:\Project\mqr-webapp-new`
as the authentication architecture reference: reuse its design, RBAC model,
session lifecycle, authorization rules, and security patterns, replacing
only framework-specific implementation where the target stack genuinely
requires it — not wherever it happens to differ.

Energy Monitor's web build is a Vite + React SPA behind an Express API
(`server/http/app.ts`), deployed to Vercel as a bundled serverless function.
`mqr-webapp-new` is a Next.js 14 App Router app using Edge Middleware. Before
this ADR, Energy Monitor's auth had already been built independently
(Phase 3, `docs/phase3-test-plan.md`) using opaque hashed session tokens and
a flat two-role permission table — functionally sound and independently
security-reviewed, but not a deliberate port of the reference architecture.

## Decision

### 1. Session lifecycle: signed JWT wrapping a DB-revocable secret

The session cookie is now a JWT (`jose`, HS256), matching mqr's
`lib/auth.ts` + `middleware.ts` hybrid model: **the JWT is never the sole
authority.** It carries `sid` (the same opaque secret this app already
hashed into `public.sessions.token_hash`), plus `userId`/`role` claims. On
every request, the JWT's signature and expiry are checked first (fast,
stateless); the `sid` claim is then hashed and looked up in
`public.sessions` exactly as before, and that DB row's `revoked_at`/
`expires_at`/account-active state remains the real, immediate authority.

This preserves mqr's actual design intent — revocation (logout, admin
deactivation, password change) must take effect on the *next request*, not
merely on next token expiry, which a pure stateless JWT cannot do. mqr's own
Edge Middleware makes the identical trade-off (a REST call to check
`user_sessions.revoked_at` on every request, despite already having a valid
JWT). Implementation: `server/auth/sessionJwt.ts`. No database schema
change was required — `token_hash` already stores `sha256(raw value)`
regardless of what the raw value's format is.

**Session lifecycle operations already had parity before this ADR** and are
unchanged: `revokeSessionByTokenHash`, `revokeOtherSessions`,
`revokeAllSessions`, `cleanupExpiredSessions` (`server/auth/repository.ts`)
match mqr's `sessionService.ts` (`revokeSession`, `revokeAllOtherSessions`,
`revokeAllSessions`) one-for-one. Only the token *format* changed.

### 2. Password hashing: Argon2id retained, not switched to scrypt

mqr uses salted scrypt (migrated off legacy unsalted SHA-256). Energy
Monitor uses Argon2id. **Decision: keep Argon2id.** This is the one place a
literal port was rejected on its merits, not adapted for a framework
reason:

- Argon2id is OWASP's current primary recommendation for password hashing
  when available (memory-hard, GPU/ASIC-resistant by design more directly
  than scrypt); it is not a weaker or older choice than scrypt.
- It is already implemented, already passed independent security review
  (`docs/phase3-test-plan.md`), and already has rehash-on-login upgrade
  logic wired (`authService.ts`'s `verified.needsRehash` path).
- Switching would require re-hashing (or dual-verifying against) every
  existing stored credential with no security improvement to show for it —
  pure migration risk for a cosmetic parity win.

### 3. RBAC: table-driven permissions, exposed through named predicates

mqr's `lib/scope.ts` is a set of individually named, documented boolean
predicates (`canManageUsers`, `canDelete`, `canExport`, ...) evaluated
against a 4-tier dealer/branch role hierarchy. Energy Monitor has two roles
(`admin`/`user`) with permissions declared once in a table
(`server/authz/permissions.ts`: `PERMISSIONS` + `ROLE_PERMISSIONS`).

**Decision:** keep the table as the single source of truth (it is simpler
and no less correct for a two-role system, and rewriting it into dozens of
hand-written predicate functions would be pure churn with no behavior
change), but add `server/authz/scope.ts` — named predicates
(`canManageGlobalSettings`, `canListUsers`, `canCreateUsers`,
`canAssignRoles`, `canResetPasswords`, etc.) that wrap the table, giving
call sites the same documented-boundary ergonomics mqr's `scope.ts` has.
`authService.ts`'s admin actions call these via the new `requireScope()`
primitive (`server/authz/policies.ts`), alongside the pre-existing
`requirePermission()`.

**Not ported:** mqr's `authorization.ts` per-record dealer/branch tenancy
scoping (`AuthorizationContext`, `canView`/`canEdit` gated by `dealerId`/
`branchId`). Energy Monitor has no per-record ownership concept — by
explicit, documented product decision (`docs/rbac.md`: "Operational data is
shared across authorized users. There is no per-user ownership rule."). This
is a business-domain gap, not a framework one: mqr's tenancy predicates are
written against dealers and branches, concepts this application's domain
does not have. Fabricating that shape here would be new, unrequested
business logic, not a port of an existing rule.

### 4. Security patterns already at parity (no change needed)

- **CSRF:** double-submit cookie (`em_csrf`) vs. mqr's custom-header
  presence check — different mechanism, equivalent protection against the
  same cross-site-form-POST threat model. Kept as-is.
- **Transport:** HttpOnly session cookie either way.
- **Centralized authorization gate:** `createAuthContextMiddleware` +
  per-route `withPermission()`/`requireScope()` calls is structurally the
  same split mqr uses (`middleware.ts` for authentication + `scope.ts`
  predicates called from pages/routes for authorization), not a weaker
  substitute for it.

## Consequences

**Positive:**
- A future maintainer familiar with `mqr-webapp-new` recognizes the session
  model and RBAC call-site pattern immediately.
- The JWT signature check is a genuine, if modest, defense-in-depth
  addition: a tampered or expired token is now rejected before any database
  round-trip, where previously every token (even obviously garbage) reached
  the hash-and-lookup step.
- Zero database migration required; zero disruption to already-tested
  session-lifecycle behavior.

**Trade-offs, stated plainly:**
- Energy Monitor's Express/Vite architecture does not have mqr's split
  Edge-Middleware-vs-Server-Component runtime, so the JWT layer does not
  save a database round-trip here the way it does in mqr's deployment — the
  DB lookup still happens on every request regardless. The benefit is
  architectural consistency and the added signature-check guard, not a
  performance win.
- One more dependency (`jose`) and one more secret-management concern
  (`SESSION_SECRET`, already present and validated, now actually used).
  Rotating this secret invalidates every active session immediately — see
  `ROLLBACK_PLAN.md`'s environment-recovery section.
- The two applications still do not share code — this is convergent design,
  not a shared library. A future refactor extracting a common `@internal/
  auth-core` package was considered out of scope for this migration.

## Alternatives considered

1. **Full port to Next.js Edge Middleware** to literally match mqr's file
   structure — rejected: would require rebuilding the web frontend on a
   different framework, contradicting the standing "do not recreate the
   application" rule, to match an implementation detail rather than a
   security property.
2. **Document the divergence and change nothing** — the initial approach
   taken in this migration, explicitly rejected by the Product Owner:
   framework differences do not, by themselves, justify not reusing a
   portable design.
3. **Switch to scrypt for full parity** — rejected as a security regression
   with no offsetting benefit (see Decision §2).

## Verification

- `server/auth/sessionJwt.test.ts` — sign/verify round-trip, wrong-secret
  rejection, expiry rejection, garbage-input handling.
- `server/authz/authz.test.ts` — every `scope.ts` predicate checked against
  both roles; `requireScope`'s authenticate-then-check-then-throw behavior.
- Full pre-existing Phase 3/3.5/6 suites (`npm run test:phase3`,
  `test:phase35`, `test:phase6`) pass unchanged after this refactor.
- Re-verified against `docs/phase3-test-plan.md`: all Critical/High findings
  remain resolved (auth boundary wired, RLS-as-defense-in-depth with
  `energy_monitor_runtime` role grants, CORS allowlisting, audited actor
  identity, durable rate limiting).

## References

- `docs/authentication.md` — implementation-level detail and the
  architecture-decision section this ADR formalizes.
- `docs/rbac.md`, `docs/supabase-security.md`, `docs/phase3-test-plan.md`.
- `server/auth/sessionJwt.ts`, `server/authz/scope.ts`,
  `server/authz/policies.ts`.
- `D:\Project\mqr-webapp-new\src\lib\auth.ts`, `middleware.ts`,
  `lib/scope.ts`, `lib/authorization.ts`, `lib/authServices/sessionService.ts`.
