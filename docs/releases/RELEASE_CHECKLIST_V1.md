# Release Checklist — V1.0 (MQR + PM)

**Scope:** Market Quality Report (MQR) and Preventive Maintenance (PM) only.
NTR, PDI, Warranty, Campaign, and Dashboard-AI are out of scope for this
release and must not be enabled.

Use this checklist for every production deployment of this release, not
just the first one. Check every box; do not skip items because "it worked
last time."

## 1. Environment

- [ ] `.env` / Vercel Project → Environment Variables reviewed against
      `.env.example` — no missing keys, no stale keys pointing at a
      decommissioned resource.
- [ ] `SESSION_SECRET` is a production-grade secret, not the value used in
      any lower environment.
- [ ] `NEXT_PUBLIC_*` variables reviewed — confirm nothing sensitive is
      exposed client-side.
- [ ] Resend API key is the production key (not sandbox/test mode).
- [ ] Google OAuth2 client (Drive) credentials are the production OAuth
      app, not a personal/dev project, and its consent screen is in
      "Published" (not "Testing") status so refresh tokens don't expire.
- [ ] Confirm `NODE_ENV=production` in the deployed environment.

## 2. Google Drive (attachment storage)

- [ ] Production Drive folder(s) for photo/video attachments exist and
      are shared with the correct service account / OAuth identity used
      by `lib/googleDrive.ts`.
- [ ] Drive storage quota checked — enough headroom for expected
      photo/video volume before the next review cycle.
- [ ] Resumable upload flow (`/api/upload/init` → `/api/upload/chunk` →
      `/api/upload/finalize`) smoke-tested against the **production**
      Drive credentials, not just a dev/test Drive account (permissions
      and sharing settings can differ between accounts).
- [ ] Sharing permissions applied by `finalize` produce a publicly
      viewable-but-not-editable link, verified by opening a freshly
      uploaded file's link in an incognito/private browser window.
- [ ] "Tractor IN" Google Sheet → Supabase vehicle sync (`tractorSheet.ts`)
      points at the correct production spreadsheet, and the sync
      schedule/trigger is confirmed active.

## 3. Supabase

- [ ] Confirm the deployed app points at the intended production Supabase
      project (`lhlzzxjayywqhqtjzfiu` or its successor) — not a branch or
      staging project.
- [ ] `list_tables` reviewed — no pending/unapplied migrations.
- [ ] RLS is enabled on every table touched by this release (`records`,
      `job_seq`, PM's maintenance tables, `dealers`, `branches`,
      `technicians`, `users`, `vehicles`, `problem_codes`) — verify via
      Supabase dashboard or `get_advisors`, not assumption.
- [ ] `get_advisors` (security + performance) run and reviewed; no new
      unresolved advisories introduced by this release's schema changes.
- [ ] `next_job_seq()` RPC verified to produce the Dealer Standard format
      (`<Module>-<DealerCode>-<Year>-<Running>`) for both MQR and PM in
      the production project, not just in a dev/branch project.
- [ ] Connection pooling / pgbouncer mode confirmed appropriate for
      Vercel's serverless concurrency model.

## 4. Storage & Backup

- [ ] Confirm what is backed up and what is not: Supabase Postgres data
      is backed up via Supabase's own point-in-time recovery; Google
      Drive attachments are **not** separately backed up by this
      application — confirm this is an accepted risk or arrange a backup
      policy on the Drive side before go-live.
- [ ] Supabase automated backup schedule/retention window confirmed
      (dashboard → Database → Backups) and matches the business's data
      retention expectation.
- [ ] Export a manual pre-release snapshot (Supabase dashboard "Backups"
      or `pg_dump` via connection string) immediately before applying any
      release-day migration, independent of the automated schedule.

## 5. Restore

- [ ] Restore procedure documented and known to at least one engineer:
      Supabase dashboard → Backups → Restore (or `pg_dump`/`psql` for a
      manual snapshot).
- [ ] Restore has been **tested at least once** against a Supabase branch
      (not production) so the procedure is proven, not theoretical.
- [ ] Confirm restoring the database does not silently orphan Google
      Drive attachment links (i.e. a restored `records`/PM row still
      points at a live Drive file) — note the two systems are not
      transactionally consistent with each other.

## 6. Deployment

- [ ] Merge target confirmed (`feature/pm-record-workflow-redesign` →
      `main`) and PR reviewed/approved per `.claude/rules/git.md` — no
      force-push, no history rewrite, no tag/release created without
      explicit instruction.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build` all pass clean
      on the exact commit being deployed.
- [ ] Vercel deployment target confirmed as the production project
      (team `MSEAL`), not a preview/staging project.
- [ ] Deployment observed to reach "Deployed (completed)" / "Active" in
      Vercel's dashboard before considering the release complete.
- [ ] Confirm `/fonts/*` remains excluded from the auth middleware (PDF
      generation depends on unauthenticated font fetch — a regression
      here silently breaks every PDF export).

## 7. Smoke Test (post-deploy, in production)

Run through each of these as a real user, not just a build check:

- [ ] Login works for at least one account per role (SuperAdmin,
      CentralAdmin, DealerAdmin, DealerUser).
- [ ] MQR: create a report end-to-end (serial lookup, photo upload,
      GPS capture, submit) and confirm the generated `job_id` follows
      `MQR-<DealerCode>-<Year>-######`.
- [ ] MQR: change status on the test record through at least one
      transition; confirm the audit trail/timeline entry appears.
- [ ] MQR: export the test record as PDF and CSV; confirm both open
      correctly and contain the expected data.
- [ ] PM: search for a known vehicle, create a maintenance record
      end-to-end (photos, GPS, hour meter), confirm `pm_number` follows
      the Dealer Standard format.
- [ ] PM: open the created record's detail page; confirm Due/Health/
      Compliance figures render (not blank/error).
- [ ] PM: export the test record as PDF; confirm it renders correctly
      (shares `sharedPdfStyles` with MQR — a regression in one can affect
      both).
- [ ] Vehicle 360 page loads for the test vehicle and shows the new MQR
      and PM records in its timeline.
- [ ] Soft-delete the test MQR/PM records created above and confirm they
      disappear from list views (cleanup so smoke-test data doesn't
      pollute production reporting).

## 8. Rollback

- [ ] Rollback path confirmed: Vercel dashboard → previous deployment →
      "Promote to Production" (instant, no rebuild needed) — verify this
      button is available and the previous deployment is still listed
      before you need it under pressure.
- [ ] If this release includes a Supabase migration, confirm whether it
      is backward-compatible with the previous app version (i.e. can you
      roll back the app without rolling back the database?). If not,
      document the exact manual DB rollback steps here before deploying,
      not after something breaks.
- [ ] Rollback decision owner identified (who has authority to trigger a
      rollback without waiting for further approval) before deployment
      begins.

---

*This checklist accompanies the Production Acceptance Report for the*
*MQR + PM Production Acceptance Sprint. See that report for open defects*
*that should be resolved (or explicitly accepted as known risk) before*
*checking off "Deployment" above.*
