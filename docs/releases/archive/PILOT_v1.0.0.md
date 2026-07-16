# MASP Pilot Release v1.0.0

> **ARCHIVED — superseded by `docs/releases/MASP_PLATFORM_FOUNDATION_V1.0.md`.**
> This was an earlier, narrower-scope (MQR+PM only) pilot release record,
> written before this branch's Attachment Platform/NTR migration work.
> Kept as a historical record, not current status.

**Status: PENDING — not yet merged to `main`, not yet deployed.** This
document is written ahead of the actual merge/deploy so the pilot has a
release record from the start; the fields marked `TBD` below must be
filled in by whoever performs the merge, deploy, and live smoke test (see
`docs/standards/GIT_BRANCH_STANDARD.md`'s Quality Gates — an AI agent
session prepared everything up to this point but does not have
deployment tooling or production login credentials, and does not merge
without explicit approval per `.claude/rules/git.md`).

## Deployment date

`TBD` — fill in once merged to `main` and Vercel's auto-deploy completes.

## Commit hash

- Branch prepared: `feature/pm-record-workflow-redesign`, HEAD `b0a86d2`
  (pushed to `origin`, PR not yet opened/merged as of this writing —
  open via https://github.com/patamin-lab/mqr-mahindra/pull/new/feature/pm-record-workflow-redesign).
- **Production commit hash: `TBD`** — record the actual `main` merge
  commit SHA once merged (this is what "v1.0.0" refers to going forward,
  not the feature-branch HEAD above).

## Environment

- **Hosting:** Vercel, team `MSEAL`, Hobby plan, auto-deploy on push to `main`.
- **Database:** Supabase Postgres 17 (`ap-northeast-2`), project
  `lhlzzxjayywqhqtjzfiu` — confirmed `ACTIVE_HEALTHY` as of this writing.
- **File storage:** Google Drive, OAuth2 real-account client.
- **Email:** Resend.
- Required production environment variables (names only — verify actual
  values are set in the Vercel dashboard, not here): `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SESSION_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`,
  `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
  `MQR_NOTIFY_EMAIL`, `TRACTOR_SHEET_ID`, `TRACTOR_SHEET_GID`,
  `NEXT_PUBLIC_APP_URL`. Local `.env.local` only carries the first three
  (Drive/Resend/Sheet integration isn't exercised in local dev) — this
  session has no visibility into the actual Vercel production env var
  values and could not verify them; confirm in the Vercel dashboard
  before/after deploy.

## Modules

- **MQR (Market Quality Report)** — production-ready per the Production
  Acceptance Sprint (see below).
- **PM (Preventive Maintenance)** — production-ready per the same sprint,
  including the search-first workflow, Maintenance Due/Health/Compliance
  engines, and Maintenance Program Versioning.
- NTR, PDI, Warranty, Campaign, Dashboard, AI Copilot — **not included**,
  not started. Do not begin per this release's explicit instruction.

## Known limitations

Carried forward from the Production Acceptance Report (Medium/Low
severity, not release-blocking, triaged separately):

- `pm-records` list page and the MQR report-creation form
  (`report-form.tsx`) are not yet migrated to the shared PageHeader/Card/
  SearchToolbar components from the UI consolidation sprint.
- Several MQR/PM files still contain hardcoded (non-`t()`) strings —
  `report-form.tsx`, `records/page.tsx`, `records/[jobId]/delete-button.tsx`,
  `maintenance-search.tsx`, `maintenance-history.tsx`, and others (see the
  Production Acceptance Report's Localization section).
- Google Translate's website-translator widget is still active in the
  root layout as a transitional fallback for un-migrated strings —
  `docs/standards/DOMAIN_LANGUAGE_STANDARD.md` currently states it is
  "NOT part of the production UI," which is stale relative to the actual
  code; this needs reconciling.
- No confirmation dialog before terminal MQR status transitions
  (Closed/Rejected).
- No versioning/audit trail for Maintenance Program interval edits —
  editing an interval retroactively changes Compliance/Due figures for
  historical vehicles with no record that the program itself changed.
- **Supabase security advisories (pre-existing, not introduced by this
  release):** `get_advisors` reports that nearly every table's RLS policy
  grants the `anon` role unrestricted `INSERT`/`UPDATE`/`DELETE`
  (`USING (true)`/`WITH CHECK (true)`), and `next_job_seq()` is callable
  by `anon` as a `SECURITY DEFINER` function. This is consistent with the
  documented architecture (no Supabase Auth; the app's own JWT session +
  `applyScope()` is the enforcement layer, not RLS) — but it means the
  Supabase anon key alone, if leaked, grants direct read/write access to
  every table via the REST API, bypassing the Next.js application
  entirely. This is a known, accepted architectural tradeoff today, not a
  new regression — flagged here so the pilot's risk acceptance is
  explicit rather than assumed.

## Pilot dealers

Enabled for pilot usage: **MSEAL** (central/administrator), **KTV**,
**CRR**. All other dealer codes remain available only after onboarding —
enforce this at the `users`/`dealers` master-data level (only create
login accounts for these three dealer codes during the pilot window), not
by relying on a code change, since dealer access is already governed by
existing `dealer_id`/RBAC scoping, not a pilot-specific flag.

## Smoke test

**Not yet run — `TBD`.** Checklist to execute against the live production
deployment once merged/deployed (fill in ✅/❌ per item and attach
screenshots/notes where useful):

### Administrator (MSEAL)
- [ ] Login
- [ ] Create MQR
- [ ] Upload Photos
- [ ] Generate PDF
- [ ] Export CSV
- [ ] Create PM
- [ ] Search Tractor
- [ ] View Tractor Profile
- [ ] Timeline
- [ ] Audit Trail

### Dealer (KTV)
- [ ] Login
- [ ] Create PM
- [ ] Upload Photos
- [ ] Generate PDF
- [ ] Verify Dealer Scope (KTV sees only its own dealer's records)

### Dealer (CRR)
- [ ] Login
- [ ] Verify Dealer Isolation (CRR cannot see KTV's or MSEAL's records)

## Rollback procedure

1. **Application:** Vercel dashboard → Deployments → select the previous
   (pre-v1.0.0) deployment → **Promote to Production**. Instant, no
   rebuild required. Identify the rollback decision owner (whoever is
   on-call for this pilot) before deploying, not after something breaks.
2. **Database:** This release does not include a destructive migration
   (no column drops, no data rewrite) — the PM redesign's schema changes
   are additive. If rollback of the application alone is insufficient
   (e.g. a pilot dealer has already created records using a new column
   the rolled-back app version doesn't know about), those records remain
   in the database unused by the older app version; they are not deleted
   by rolling back and can be reconciled manually rather than requiring a
   database rollback.
3. **Google Drive attachments:** Not affected by an application rollback
   — uploaded files and their share links remain valid regardless of
   which app version is live.
4. **Pilot dealer communication:** If a rollback happens during the pilot
   window, notify MSEAL/KTV/CRR pilot users directly (this is a small,
   known user set) rather than relying on them to notice.

## Verification performed (this document's authoring session)

- [x] `tsc --noEmit` — clean
- [x] `next lint` — 0 errors, 7 pre-existing warnings (unchanged)
- [x] `vitest run` — 228/228 passing
- [x] `next build` — succeeds, all routes compile
- [x] Supabase connectivity — project `lhlzzxjayywqhqtjzfiu` confirmed `ACTIVE_HEALTHY`
- [ ] Google Drive upload — **not verified this session** (no live
      credentials/browser access available; verify via the Administrator
      smoke test's "Upload Photos" step post-deploy)
- [ ] Live production build/deploy — **not performed this session** (no
      Vercel deploy tool available; requires the branch above to be
      merged to `main`, which then auto-deploys)

## Verification

This document was authored ahead of the actual merge/deploy so the pilot
has a release record from the start. It does not itself constitute proof
of a successful deployment — the `TBD` fields above must be completed
after the real merge, deploy, and smoke test.
