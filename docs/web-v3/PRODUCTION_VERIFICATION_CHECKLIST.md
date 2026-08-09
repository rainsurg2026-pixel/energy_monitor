# Production Verification Checklist — Energy Monitor Web v3

Run this against a live environment (Preview first, then Production after
Preview passes). Every item is grounded in a route, script, or component
that actually exists today — see the "Ref" column. If an item's Ref doesn't
exist yet, it isn't optional filler; flag it as a real gap before sign-off.

Legend: `[ ]` not run · `[x]` passed · `[!]` failed (record the issue) ·
`[-]` not applicable to this environment (say why).

## 0. Pre-flight

- [ ] `npm run vercel-build` succeeds from a clean clone (already verified
      locally as of `bb9de26` — re-confirm on the actual deploy commit).
- [ ] `npm run test:domain-parity` passes (24/24 desktop-v2.3.1 calculation
      parity assertions) — this is the gate that Desktop behavior hasn't
      silently drifted.
- [ ] `npm run test:phase3`, `test:phase35`, `test:phase6` all pass.
- [ ] `.env`/Vercel project environment has `DATABASE_URL`, `SESSION_SECRET`,
      `CSRF_SECRET`, and (Preview only) `READ_ONLY_MODE=true` set — confirm
      via Vercel dashboard, never by printing secret values.

## 1. Authentication

| # | Check | Ref |
|---|---|---|
| 1.1 | `[ ]` Login with valid admin credentials succeeds, session cookie set HttpOnly | `POST /api/v1/auth/login` |
| 1.2 | `[ ]` Login with wrong password returns a generic error (no "user not found" vs "wrong password" distinction) | `authService.login`, `GENERIC_LOGIN_FAILURE` |
| 1.3 | `[ ]` 5 consecutive wrong-password attempts locks the account (423), further correct-password attempts still rejected until lockout expires | `loginProtection.ts` |
| 1.4 | `[ ]` Session persists across page reload (`GET /api/v1/auth/session` returns the user) | |
| 1.5 | `[ ]` Logout clears the session cookie and immediately invalidates it server-side (a replayed old cookie gets 401) | `POST /api/v1/auth/logout` |
| 1.6 | `[ ]` A tampered session cookie (flip one character) is rejected, not silently accepted | JWT signature check, `sessionJwt.ts` |
| 1.7 | `[ ]` An expired session cookie is rejected and the user is redirected to `/login` | |
| 1.8 | `[ ]` Deactivating a user (admin action) immediately invalidates that user's active session on their very next request — don't wait for them to log out | `setUserActive` → `revokeAllSessions` |
| 1.9 | `[ ]` Changing a user's password revokes their other active sessions | `changePassword` → `revokeOtherSessions` |
| 1.10 | `[ ]` CSRF: a mutating request (`PUT`/`POST`/`PATCH`) without the `em_csrf` header/cookie pair is rejected | `server/http/security/csrf` |

## 2. Authorization / RBAC

| # | Check | Ref |
|---|---|---|
| 2.1 | `[ ]` A `user`-role account can read dashboard/energy/cost/electrical/racks/site-comparison | `PERMISSIONS` USER set |
| 2.2 | `[ ]` A `user`-role account gets 403 on every `/api/v1/admin/users*` route and on `PUT /api/v1/settings/display-period` | `canListUsers` etc., `server/authz/scope.ts` |
| 2.3 | `[ ]` An `admin`-role account can perform every admin action: list/create/update/activate/deactivate a user, assign a role, reset a password | |
| 2.4 | `[ ]` An admin cannot deactivate their own account (`SELF_DEACTIVATION_NOT_ALLOWED`, 409) | `setUserActive` |
| 2.5 | `[ ]` Unauthenticated requests to any `/api/v1/*` route other than `/health*`, `/auth/login`, `/auth/csrf` return 401, not a redirect or a 500 | |

## 3. Dashboard & core data workflows

| # | Check | Ref |
|---|---|---|
| 3.1 | `[ ]` `/dashboard` loads and matches the Desktop app's numbers for the same facility/month (spot-check at least one full month for each site) | `GET /api/v1/dashboard` vs. Desktop |
| 3.2 | `[ ]` `/energy`, `/cost`, `/electrical` each load and match Desktop for the same month | |
| 3.3 | `[ ]` `/racks` and `/rack-units` (Rack Capacity / Rack Unit Capacity) match Desktop | these are explicitly in the parity scope per `docs/web-v3.md` |
| 3.4 | `[ ]` `/site-comparison` correctly unions months across sites and shows nulls (not zeros) for a site missing a given month | `getSiteComparison` |
| 3.5 | `[ ]` Switching the site/facility selector updates every page's data, not just the one currently visible | |
| 3.6 | `[ ]` A month outside the configured Display Period is not selectable and not returned by the API | `docs/authentication.md`'s Display Period gate |
| 3.7 | `[ ]` Editing/saving a monthly log (`PUT /api/v1/sites/:siteId/periods/:month`) round-trips correctly and is reflected immediately on reload | operational-data write path |

## 4. Settings & admin

| # | Check | Ref |
|---|---|---|
| 4.1 | `[ ]` `/settings` loads current global settings and Display Period for an admin | `GET /api/v1/settings` |
| 4.2 | `[ ]` Updating the Display Period with a stale `expected_row_version` is rejected (optimistic concurrency), not silently overwritten | `updateSettings` |
| 4.3 | `[ ]` `/settings/users` list/create/edit/deactivate/reset-password all work end-to-end for an admin | |

## 5. Data migration / Excel-origin data integrity

The web app does **not** expose live Excel editing or file upload/download
today — those remain Desktop-only. What the web app *does* expose is data
that originated from a one-time Excel-workbook migration into Postgres.
Verify the migration, not an Excel UI that doesn't exist here:

| # | Check | Ref |
|---|---|---|
| 5.1 | `[ ]` `npm run test:migration-tooling` passes (preview-only, no live writes) | |
| 5.2 | `[ ]` For each migrated site, spot-check 2-3 months of migrated dashboard/energy/cost figures against the source `.xlsm` directly (not just against the API's own domain-parity suite, which tests calculation logic, not migrated data fidelity) | `docs/data-migration.md` |
| 5.3 | `[ ]` Migration is confirmed idempotent — re-running the importer against an already-migrated source does not duplicate rows (checked by source-hash, not by re-running against Production) | `docs/data-migration.md`'s provenance/hash design |
| 5.4 | `[-]` Live Excel import re-run against Production — **do not do this casually**; it's a deployment gate of its own (`LIVE_PHASE4_IMPORT_PENDING` in `docs/authentication.md`), not a routine verification step |

## 6. Reporting

**Scope note:** report generation (PDF/HTML/Excel export) is a Desktop-only
capability today (`src/reports/`, `src/reporting/`); the web API has no
`/reports` or `/export` route (confirmed against `server/http/app.ts`).
Nothing in this section applies to Production sign-off for Web v3 unless a
reporting feature actually ships in a route list before that sign-off — if
so, add its own checklist rows here before relying on this section. Until
then:

| # | Check | Ref |
|---|---|---|
| 6.1 | `[-]` Web report generation — not applicable, feature not present in web build |
| 6.2 | `[ ]` If the desktop reporting pipeline itself changed in this release cycle, re-run `npm run test:all-report` and `test:report-image-pipeline` before claiming "reports match Desktop" in the release notes | Desktop-only, listed for completeness |

## 7. Read-only mode (Preview safety gate)

| # | Check | Ref |
|---|---|---|
| 7.1 | `[ ]` With `READ_ONLY_MODE=true` (Preview default), every mutating route (`PUT`/`POST`/`PATCH`, except login/logout/change-password) returns 423, not a silent write | `READ_ONLY_OPERATIONS`, `evaluateReadOnlyOperation` |
| 7.2 | `[ ]` Confirm `READ_ONLY_MODE` is **not** set (or explicitly `false`) in the Production environment before go-live — the opposite mistake (Read-Only accidentally left on in Production) is just as real a bug | Vercel project env vars |

## 8. Performance

| # | Check | Ref |
|---|---|---|
| 8.1 | `[ ]` `npm run vercel-build`'s chunk-size warning (`App-*.js` ~900KB gzip ~231KB, as of the last local build) hasn't grown further; if it has, that's worth a note even though it isn't a hard gate | Vite build output |
| 8.2 | `[ ]` Time-to-interactive for `/dashboard` on a throttled connection (Chrome DevTools "Slow 4G") is reviewed at least once, not assumed acceptable | manual |
| 8.3 | `[ ]` `/api/v1/health` and `/api/v1/readiness` respond in well under 1s from the deployed region | |
| 8.4 | `[ ]` No N+1-looking pattern when switching months/sites rapidly (watch the Network tab, not just "it feels fine") | manual |

## 9. Browser / responsive validation

| # | Check | Ref |
|---|---|---|
| 9.1 | `[ ]` Chrome (latest) — login through to dashboard/energy/cost/electrical/racks/site-comparison/settings | |
| 9.2 | `[ ]` Edge (latest) — same walkthrough | |
| 9.3 | `[ ]` Firefox (latest) — same walkthrough | |
| 9.4 | `[ ]` Safari (if any stakeholder uses macOS/iOS) — same walkthrough | |
| 9.5 | `[ ]` Mobile viewport (real device or DevTools emulation) — layout doesn't break, tables/charts are at least usable if not optimized | mobile-first is a stated project convention |
| 9.6 | `[ ]` No JS console errors on any of the above during a normal walkthrough | |

## 10. Security spot-checks

| # | Check | Ref |
|---|---|---|
| 10.1 | `[ ]` Response headers show no wildcard CORS (`Access-Control-Allow-Origin: *`) — must be the exact configured origin | `server/http/security/cors.ts` |
| 10.2 | `[ ]` Session cookie has `HttpOnly`, `Secure`, and an appropriate `SameSite` attribute in the deployed (HTTPS) environment | |
| 10.3 | `[ ]` No stack traces or internal error detail leak to the client on a forced 500 (trigger one safely, e.g. malformed JSON body) | |
| 10.4 | `[ ]` `.phase7-db-url` / `.phase7-supabase-ca.cer` (or any equivalent local secret file) are absent from the deployed bundle — spot-check the Vercel deployment's file listing if possible | see `.gitignore` hardening in this migration |

## 11. Deployment / infra sanity

| # | Check | Ref |
|---|---|---|
| 11.1 | `[ ]` `scripts/test-preview-http.ts` run (with real `PREVIEW_URL`/`DEV_ADMIN_PASSWORD`/`DEV_USER_PASSWORD`) passes in full — this is the closest thing to an automated version of sections 1-7 above | `npm run test:preview-http` |
| 11.2 | `[ ]` DB connectivity confirmed via the pooled `DATABASE_URL` path actually used at runtime (not just `DIRECT_DATABASE_URL`, which migration scripts use) | `docs/web-v3/PHASE7_1_VERCEL_PREVIEW.md` |
| 11.3 | `[ ]` TLS to Supabase verified (`SUPABASE_DB_CA_CERT` present and valid, connections not falling back to unverified TLS) | |
| 11.4 | `[ ]` Vercel function cold-start time is acceptable (check the first request after a deploy, not just a warm one) | |

## Sign-off

- [ ] All applicable items above are `[x]` or have a recorded, accepted `[!]`/`[-]` with reasoning.
- [ ] Any `[!]` failures have either been fixed and re-verified, or explicitly accepted as a known limitation with a named owner and follow-up.
- [ ] This checklist's result is attached to the PR before requesting merge approval.
