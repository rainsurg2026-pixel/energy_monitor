# Release Notes — Authentication Platform v3.0(.1) & Architecture Blueprint v1.1

No git tag created for this increment (not requested). This document
records what shipped since `v2.4.0-foundation`
(`docs/releases/RELEASE_NOTES_V2.4.0_FOUNDATION.md`), for the same
"documentation must be updated whenever architecture changes" reason
every prior increment got its own notes. See `docs/ROADMAP.md`'s
"Completed Milestones" / "Architecture Status" sections for how this
fits into ongoing planning.

## Completed

- **Platform Branding (MSEAL DMS)** — PR #33. Legacy "MASP"/"Market
  Quality Report" platform branding replaced with "MSEAL DMS" wherever it
  represents the application; centralized in `src/lib/branding.ts`
  (`APP_NAME`, `APP_VERSION`). MQR module name, record IDs, database, API
  routes, and business document titles deliberately unchanged.
- **Authentication Platform v3.0** — PR #32, merge commit `834d9da`.
  Session Platform Foundation (revocable, device-aware `user_sessions`,
  enforced on every request via `middleware.ts`), Login UX (Enter-key
  submit, duplicate-submit guard), self-service Change Password (scrypt
  hashing, password history, optional min-age/expiry), Forgot/Reset
  Password (single-use, time-limited, hashed tokens; email templates),
  User Invitation (7-day token, account stays inactive until accepted),
  First Login forced password change, Account Lock Protection (5 fails →
  15-minute lock, admin unlock), IP-based rate limiting
  (`rateLimitService.ts`, DB-backed), CSRF header enforcement on every
  mutating `/api/*` request, and a dedicated `auth_audit_log` covering all
  13 spec event types. `docs/adr/ADR-014-Authentication-Platform-v3.md`,
  `docs/architecture/AUTHENTICATION_PLATFORM.md`.
  - **Production-readiness review caught and fixed one regression before
    merge**: the pre-existing admin "Reset Password" route left
    `password_algo`/`password_salt` stale after writing a new plain
    sha256 hash, which would have permanently locked out any account
    already opportunistically upgraded to `scrypt`. Fixed in
    `resetUserPassword()` (`lib/db.ts`) - see
    `AUTHENTICATION_PLATFORM.md`'s Backward Compatibility section.
- **Architecture Blueprint v1.1** — PR #34, merge commit `503f2d3`.
  The long-term architecture for MSEAL DMS as an Engineering Intelligence
  Platform: North Star & Principles, Domain Model & Context Map, Machine
  Lifecycle & Timeline, Inspection Domain, Service & Quality Domains,
  Event Model, Knowledge Domain (incl. Knowledge Score, Knowledge
  Maturity, the Human Feedback Loop), Engineering Intelligence (incl. the
  AI Confidence Policy), Analytics, Machine Digital Passport, Database &
  API Evolution Strategy, Future Integrations Readiness, Roadmap &
  Migration Strategy, Risks & Technical Debt, Future Vision, ADR
  Recommendations, Business Capability Map, Canonical Event Catalog,
  Integration Boundary, and Architecture Governance. Design-only - no
  code, database, or API changed. `docs/architecture/blueprint/README.md`.
  **Status: APPROVED. Architecture Baseline: FROZEN** - see
  `docs/ROADMAP.md`'s Architecture Status section and the Blueprint's own
  `20-ARCHITECTURE-GOVERNANCE.md`.

- **Authentication Platform v3.0.1 (reliability patch)** — PR #35, merge
  commit `bad8734`. Production bug fix, not a redesign: Forgot Password's
  silent email-delivery failure was traced to (1) fire-and-forget
  `sendEmail()`/`logAuthEvent()` calls after the last `await` in several
  auth routes - unsafe on Vercel serverless, which can freeze execution
  the instant a response is sent - and (2) the Resend SDK resolving
  (never throwing) on provider-level errors, so `await` alone never
  meant the email was actually accepted. Fixed: every such call across
  `login`/`forgot-password`/`reset-password`/`change-password`/
  `accept-invitation`/`admin/users`/`sessionService` is now guaranteed to
  complete (`authServices/reliability.ts`'s `ensureCompletion()`) before
  the response returns; `email.ts` now inspects the provider's resolved
  error, times out after 10s, and returns a structured `EmailSendResult`.
  Also added: Email Health (`/admin/email-health`, SuperAdmin/
  CentralAdmin only), Admin Test Email, and per-user Email Missing/
  Verified/Forgot-Password-Available indicators in the admin Users
  table. New, additive `auth_audit_log` event types
  (`EMAIL_SEND_SUCCESS`/`EMAIL_SEND_FAILURE`) required a migration
  (`add_email_send_audit_event_types`) to extend the table's CHECK
  constraint - itself caught live during this patch's own verification.
  `docs/architecture/AUTHENTICATION_PLATFORM.md`'s "v3.0.1" section.

## Known Issues

Carried forward unchanged from `v2.4.0-foundation` (production alias
`DEPLOYMENT_NOT_FOUND`, Collaboration Layer deferred, Activity Timeline
photo pairing/virtualization limitations, PM's model-derivation fallback)
— see `docs/ROADMAP.md`'s Known Issues section for the current list.
Additionally:

- `canForceResetPassword`/`canForceLogoutAllSessions` (`scope.ts`) are
  defined per the Authentication Platform v3.0 spec's RBAC list but are
  not yet wired to any route - no admin UI exists to force-reset another
  user's password outside the existing temp-password flow, or to force-
  logout another user's sessions. Extension point, not a regression - see
  `AUTHENTICATION_PLATFORM.md`'s Remaining technical debt.
- No admin UI to view another user's active sessions (only their own).
- Knowledge Score (Blueprint 07) and Knowledge Maturity (Blueprint 07)
  are concepts only - no computation/promotion criteria defined, by this
  PR's explicit scope.
- `touchLastActivity()` (v3.0.1) remains intentionally fire-and-forget -
  runs on every authenticated request app-wide, carries no security/audit
  weight, deliberately scoped out of the reliability patch.
- "Email Verified" (v3.0.1) reflects this platform's own send history,
  not a confirmation-link verification flow, which doesn't exist here.
- Email Health's "Verification" (v3.0.1) is a sandbox-sender heuristic,
  not a live call to Resend's domain-verification API.

## Verification

All three PRs: lint clean (pre-existing warnings only), typecheck clean,
full test suite passing (601/601 after v3.0.1 - 18 new tests), production
build succeeds, architecture check 5/5 PASS, production deployment
verified via GitHub commit status (Vercel: success) for all three merge
commits. v3.0.1 additionally live-verified end-to-end against the real
dev environment (disposable `qa_test_temp` account): reset password with
successful login on the new password, full audit trail, real/invalid/
expired/reused token handling, per-IP rate limiting, and Email Health/
Admin Test Email correctly surfacing a real "not configured" failure
instead of silent success.
