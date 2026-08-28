# Release Handoff — Energy Monitor CleanWebApp (`feat/web-clean-v1`)

Prepared 2026-08-11 (Asia/Bangkok). This is the release package for
promoting `feat/web-clean-v1` to Production. **Production has not been
deployed.** This document stops at the approval gate, per explicit
instruction.

## 1. Final commit

```
commit ea237793233d461b6c7e24f1ee49c851cd3466c9
Author: patamin-lab <rainsurg2026@gmail.com>
Date:   2026-08-11 15:13:47 +0700
Branch: feat/web-clean-v1 (clean working tree, nothing uncommitted)

    feat: remove Google Sheets Backup from product scope
```

Commit history for this release pass (newest first):

| Commit | Summary |
| --- | --- |
| `ea23779` | Remove Google Sheets Backup from product scope |
| `ade2e87` | docs: record Google OAuth/Export Browser UAT and the final readiness gate |
| `daf7cf3` | fix(export): open PDF report popup synchronously to avoid browser blocking |
| `96d5c38` | docs: record the UPS History root cause, fix, and live verification |
| `f61f024` | fix(ups-history): compute and persist UPS Group History server-side |
| `84a07d6` | feat(backup): replace Google service-account credential with Admin-connected OAuth (superseded by `ea23779`'s removal) |
| `4e0bdda` | fix(db): apply Preview migrations 003-009 + new 010 users DELETE grant |

Migration `011_backup_google_oauth_link.sql` (added after `4e0bdda`, before
the OAuth-removal decision) is also applied on Preview — see §3 for what
that means for Production.

## 2. Preview URL

```
https://energy-monitor-git-feat-web-clean-v1-dcm15.vercel.app/
```

Verified healthy at time of handoff:
- `GET /api/v1/health` → `200 {"status":"ok"}`
- `GET /api/v1/readiness` → `200 {"status":"ready"}` (confirms live Supabase connectivity from Vercel's side)

## 3. Production deployment checklist

**Not executed. For the approver to run when ready.**

1. Confirm `main`'s current state and the intended merge target/strategy (repo's configured default — do not force a strategy).
2. Re-confirm PR mergeability fresh at merge time (`MERGEABLE`/`CLEAN`), not from this document — approval and state can go stale between now and execution, per `.claude/rules/git.md`.
3. Re-run the full local gate immediately before merge: lint, typecheck, build, full regression battery (all 20+ suites) — do not merge on a stale test run.
4. Merge via the repo's configured standard strategy only.
5. **Database**: migrations `003`–`011` must be applied to the **Production** Supabase project (`ajidkjzufpgyibagvvco` — the authoritative Production ref hardcoded in `scripts/lib/productionTargetGuard.ts`; **not** `tofdgndrrpnnyhbuurbx`, which is the Preview / dev-test project. This doc was prepared 2026-08-11, before the Production project was provisioned on 2026-08-13.) before or immediately as part of deploy — they are additive-only (verified: zero `DROP TABLE`/`DROP COLUMN`/`DROP CONSTRAINT` across all of them), safe to apply ahead of the code that depends on them. Apply in filename order, exactly as done on Preview. **Do not apply migration `011` if Production has independently decided against ever restoring Google Backup** — it only adds a nullable, harmless column (`backup_config.connected_google_user_id`) that current code no longer reads either way, so applying it is safe but not required.
6. Confirm Production environment variables are set (`DATABASE_URL`, `SESSION_SECRET`, `CSRF_SECRET`, `APP_ORIGIN`, `SUPABASE_DB_CA_CERT`, etc. — same shape as Preview's). **Do not set `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`/`GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON`/`CRON_SECRET`** — the feature that read them no longer exists in this release; setting them would be inert but pointless.
7. Confirm `vercel.json` has no `crons` entry expected (this release removed the only one that existed) — nothing to configure.
8. Deploy to Production (merge-triggered or manual promote, per the repo's existing Vercel project configuration).
9. Do **not** flip `READ_ONLY_MODE` off/on as part of this deploy unless it's already part of standard practice — no code in this release depends on that flag differently than before.

## 4. Smoke test checklist (run immediately after Production deploy)

Minimum bar before calling the deploy successful:

- [ ] `GET /api/v1/health` → `200`
- [ ] `GET /api/v1/readiness` → `200` (proves live DB connectivity from Production, not just that the process started)
- [ ] Unauthenticated `GET /api/v1/settings` → `401 UNAUTHORIZED`
- [ ] Log in as a real Admin account → Dashboard loads with real, non-zero values
- [ ] Facility switch Rangsit ↔ Srinakarin → values change, no cross-facility leakage
- [ ] History → UPS Loads History → real values present for the current month (backfills automatically on first read if genuinely missing — do not manually seed data)
- [ ] Dashboard → Engineering View → UPS Groups table matches History's values for the same month
- [ ] Data Entry → open current month → Save (even a no-op re-save of unchanged values) → succeeds, no error
- [ ] Exports & Report → CSV and Excel → both download with real, non-empty content
- [ ] Exports & Report → PDF → click as a real user (not automation) → print dialog opens with correct facility/month/values
- [ ] Settings → confirm no "Data Backup" section is present anywhere
- [ ] `/api/v1/admin/backup/status` (or any former backup path) → `404`
- [ ] User Management (as Admin) → real user list renders; a non-admin account gets `403` on the same routes

If any item fails: do not attempt an in-place fix on Production. Follow §5.

## 5. Rollback plan

Full detail already exists in `docs/web-v3/ROLLBACK_PLAN.md` — this
section is the summary specific to this release, not a replacement.

1. **First move, if something is wrong but not catastrophic**: flip
   `READ_ONLY_MODE=true` in Production's Vercel env. Blocks all mutating
   routes immediately, no redeploy required, reads keep working. Buys
   diagnosis time.
2. **Application rollback**: Vercel deployments are immutable and
   independently addressable. Use Vercel's Instant Rollback (dashboard or
   `vercel rollback`) to repoint the Production domain at the last
   known-good deployment — no rebuild, no wait.
3. **In parallel**: open a dedicated rollback/hotfix PR per
   `.claude/rules/git.md` — never patch `main` directly, never force-push,
   never rewrite history. Document the reason in the PR.
4. **Database**: do **not** roll back the schema. Every migration in this
   release (`003`–`011`) is additive-only — an older code build is
   forward-compatible with the current schema by construction. Rolling
   code back via step 2 is sufficient for the overwhelming majority of
   incidents.
5. Confirm the rollback actually took effect via `GET /api/v1/health` and
   `/api/v1/readiness` against the real Production URL — a dashboard
   saying "rolled back" is not itself proof.

## 6. Known intentional limitations

These are accepted, documented product-scope decisions — not defects,
not blockers:

- **Google Sheets Backup**: permanently removed from product scope
  (this release). `backup_config`/`backup_log`/`google_oauth_states`/
  `google_sheets_connections` tables remain in Supabase, unused, retained
  for audit/history — not dropped.
- **Rack Capacity is read-only on Web**: no editor (create/edit racks)
  exists; consequently **Rack Capacity History stays empty** until a
  future sprint adds that capability. This is expected, not a bug — the
  "record automatically on save" copy in the UI describes a save action
  that doesn't exist yet on Web.
- **Rack Unit Capacity 12-month trend/image**: out of scope, no
  corresponding API (Desktop-only today).
- **PDF export's print-dialog delivery**: uses the browser's native
  `window.open()` + `window.print()`, not a blob-download — this is the
  deliberate architecture (matches Desktop's own print convention, avoids
  adding a new PDF-generation dependency). A handful of legacy API
  routes (`/sites`, `/settings`, `/periods`, `/dashboard`, `/energy`,
  `/cost`, `/electrical`) have no caller in the shipped frontend
  (orphaned from an earlier, superseded app) — dead code, zero runtime
  impact, not a security surface (still permission-gated).
- **Desktop's own per-user Google Sheets sync** (`src/electron/
  googleAuth.ts`) is unrelated to the removed Backup feature and remains
  fully intact, Electron-only, untouched by any of this release's work.

## 7. Final PASS/FAIL matrix

| Area | Status | Evidence |
| --- | --- | --- |
| Supabase migrations / RLS / grants / data integrity | PASS | Live-verified, multiple passes |
| UPS History | PASS | Root-caused, fixed, live browser UAT, both facilities |
| Dashboard UPS Groups | PASS | Live browser UAT, both facilities |
| Rack Capacity | PASS | Live browser UAT, both facilities, real distinct data |
| Rack Capacity History | PASS (intentional empty state) | See §6 — not a defect |
| Data Entry / Save / Refresh | PASS | Live save + persistence across full page reload |
| Site Comparison | PASS | Live, both facilities, distinct values |
| User Management | PASS | Live, real users rendered, RBAC enforced |
| Theme (Light/Dark) | PASS | Live, both verified |
| Facility isolation | PASS | Verified across every workflow |
| CSV export | PASS | Live download + byte-level content verification |
| Excel export | PASS | Live download + byte-level content verification |
| PDF export | **PASS** | Human-verified live click-through (this turn); content independently proven correct via tests + shared-input cross-check |
| Google Backup | OUT OF SCOPE | Removed from product entirely |
| Security (auth, RBAC, secrets) | PASS | Fresh unauthenticated/RBAC/secret-scan checks |
| Regression / Lint / Build | PASS | Full battery, zero regressions |
| Preview deployment | PASS | Current, healthy, verified live |
| Production | UNTOUCHED | Confirmed independent, unaffected |

### Production readiness: **READY FOR PRODUCTION**

No unresolved P0/P1 issues. No open verification gaps. Awaiting explicit
approval to proceed with §3.
