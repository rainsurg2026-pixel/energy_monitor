# Deployment Guide (RC1)

## 1. Hosting model

- **Vercel** (team `MSEAL`, Hobby plan), project auto-deploys every push
  to `main`. There is currently no branch/PR-gated deploy — direct-to-main
  is the existing convention (see `docs/DEVELOPMENT_GUIDE.md` §5).
- **Supabase** project `lhlzzxjayywqhqtjzfiu` (Postgres 17, region
  `ap-northeast-2`) — one shared project for all environments; there is
  no separate staging database today.
- **Google Drive** — one real-account OAuth2 client (not a service
  account) is the file store for every photo/video attachment in both
  MQR and PM.

## 2. Environment variables

All required for a working deployment. None are new to this RC except
where noted.

| Variable | Used by | Purpose |
|---|---|---|
| `SESSION_SECRET` | `lib/auth.ts`, `middleware.ts` | HS256 signing key for the `mqr_session` JWT cookie |
| `SUPABASE_URL` | `lib/supabase.ts` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `lib/supabase.ts` | Supabase anon key — **all** app access uses this key; tenant isolation is enforced in application code, not via a privileged key (see `docs/architecture/SYSTEM_ARCHITECTURE.md` §6) |
| `GOOGLE_OAUTH_CLIENT_ID` | `lib/googleDrive.ts` | Drive OAuth2 client id |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `lib/googleDrive.ts` | Drive OAuth2 client secret |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | `lib/googleDrive.ts` | Long-lived refresh token — see §4 "Renewing the Google OAuth refresh token" below |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | `lib/googleDrive.ts` | Root folder every dealer/module subfolder is created under |
| `TRACTOR_SHEET_ID` | `lib/tractorSheet.ts` | Google Sheet id for the "Tractor IN" vehicle master feed |
| `TRACTOR_SHEET_GID` | `lib/tractorSheet.ts` | Sheet tab (gid) within that spreadsheet |
| `RESEND_API_KEY` | `lib/email.ts` | Transactional email (MQR create/close notifications) |
| `RESEND_FROM_EMAIL` | `lib/email.ts` | From-address for outgoing email |
| `MQR_NOTIFY_EMAIL` | `lib/email.ts` | Notification recipient |

Provided automatically by Vercel — do not set manually:
- `VERCEL_URL` — used by `features/maintenance/utils/fetchMaintenance.ts`
  as the fallback base URL for server-to-server fetches when
  `NEXT_PUBLIC_APP_URL` isn't set (this was a real production bug fixed
  in an earlier milestone — see `PROJECT_STATE.md`'s M6.5 entry — do not
  remove this fallback).
- `NODE_ENV` — read by `api/auth/login/route.ts` for cookie `secure` flag
  behavior.

Optional, not currently set: `NEXT_PUBLIC_APP_URL` (would take priority
over `VERCEL_URL` if ever set).

**Before deploying**: confirm every variable above is set in the Vercel
project's Environment Variables settings for the Production environment.
A missing `SUPABASE_URL`/`SUPABASE_ANON_KEY` fails loudly
(`getSupabase()` throws an explicit "env vars are not set" error, not a
silent crash) — every other missing variable fails at the point of first
use (login, upload, email, or Tractor sync), not at build time, since
none of them are read at module-import time (confirmed via the M6.3
build-time audit noted in `PROJECT_STATE.md`).

## 3. Standard deployment steps

1. Confirm the working tree is clean and you're on the intended branch
   (`git status`).
2. Run the full local verification pass (matches CI):
   ```
   npm run typecheck
   npm run lint
   npm run build
   npm test
   ```
3. Push to `main` (or merge the PR into `main`). Vercel picks up the push
   automatically — no manual deploy trigger needed.
4. Watch the Vercel deployment dashboard for "Ready." A failed build
   blocks the deploy; the previous production deployment stays live.
5. **Live-verify** the changed flow on the deployed site (this is a
   standing project convention, not optional for user-facing changes —
   see root `CLAUDE.md` §7.7): exercise the actual feature, not just a
   green build.
6. If the change included a Supabase migration, confirm it was applied
   to the **live** project before the code that depends on it ships (see
   §5 below — migrations in this project are applied directly via the
   Supabase MCP/dashboard, independent of the Vercel deploy).

## 4. Renewing the Google OAuth refresh token

The Drive integration uses a real user-account OAuth2 client, not a
service account, so the refresh token can expire or be revoked (Google
invalidates a refresh token after 6 months of inactivity, or immediately
if the authorizing user's Google Account password changes, the app's
OAuth consent is revoked from the user's Google Account security page, or
the token simply exceeds Google's per-client token limit).

**Symptom**: any upload/Drive-folder operation starts failing; check
Vercel function logs for an `invalid_grant` error from Google's token
endpoint.

**Renewal procedure**:
1. Run `scripts/get-google-refresh-token.mjs` locally (Node, not a
   Vercel/production script — it's an interactive one-off OAuth2 setup
   helper, never run in prod). This starts a local OAuth consent flow.
2. Sign in with the Google account that owns the target Drive
   (`GOOGLE_DRIVE_ROOT_FOLDER_ID` must belong to this account, or be
   shared with edit access to it).
3. Approve the requested Drive scope.
4. The script prints a new refresh token to the console.
5. Update `GOOGLE_OAUTH_REFRESH_TOKEN` in the Vercel project's
   Environment Variables (Production, and any other environment that
   uses it) with the new value.
6. Redeploy (a new environment variable value requires a fresh deployment
   to take effect on Vercel — trigger one, e.g. an empty commit or the
   Vercel dashboard's "Redeploy" action, rather than assuming it applies live).
7. Verify by performing a real upload on the live site.

Do not commit the refresh token to the repository at any point in this
procedure — it is a credential, handled exactly like every other secret
in this project (see `.claude/rules/03-data-access-security.md`).

## 5. Supabase migrations

This project's migrations are tracked via Supabase's own migration
history (`list_migrations`), applied directly against the live project —
there is no local Postgres, no migration-runner CLI step in the deploy
pipeline, and no separate staging database to test against first.

**Convention observed throughout this project** (see every migration in
`docs/PROJECT_STATE.md`'s phase-by-phase history): every migration is
strictly additive — `CREATE TABLE`, `ALTER TABLE ADD COLUMN`,
`CREATE INDEX`, `CREATE POLICY`. No migration in this project's history
has dropped a table, dropped a column, or renamed anything that existing
code depends on. Follow this convention for any future schema change:
prefer additive changes over destructive ones, even at the cost of a
temporarily-unused legacy column.

**Applying a new migration**:
1. Write the migration with a clear, snake_case descriptive name.
2. Apply it directly to the live project (via the Supabase MCP
   `apply_migration` tool or the Supabase dashboard's SQL editor).
3. Confirm it applied cleanly (`list_tables`/`list_migrations`).
4. Only then deploy the application code that depends on the new
   schema — never the reverse order, to avoid a window where deployed
   code expects a column that doesn't exist yet.
5. Run `get_advisors` (security + performance) after any schema change —
   this project's tables use a deliberately permissive RLS model (see
   `docs/architecture/SYSTEM_ARCHITECTURE.md` §6), so the advisor's
   `rls_policy_always_true` warnings on a new table are expected, not a
   regression; a genuinely new finding class is worth a second look.

## 6. Storage structure (Google Drive)

- One root folder (`GOOGLE_DRIVE_ROOT_FOLDER_ID`).
- One subfolder per dealer, named from the dealer's `short_name`
  (sanitized: `.replace(/[^a-zA-Z0-9ก-๙_-]/g, '')` — applied consistently
  everywhere a folder name is constructed from dealer data, in both
  `api/records/route.ts` and `api/pm-records/route.ts`).
- Newly-uploaded files land in a dealer's `_pending` subfolder first
  (uploaded before the parent record exists yet, so there's no business
  id to file them under); once the record is created and its business
  number (`job_id`/`pm_number`) is known, `relocatePendingFiles()`
  (`lib/googleDrive.ts`) moves them into `{dealer}/{businessNumber}/`. A
  relocate failure never fails the create — the files still work from
  `_pending`, just not yet organized.
- MQR photo categories: named slots (`odometer`, `vehicle_serial`,
  `damage_point_1/2/3`, `after_repair`) plus 2 legacy categories kept for
  old records' display only.
- PM photo categories: `meter`, `nameplate`, `report` (all 3 required at
  creation).
- Public sharing permissions are set at finalize time
  (`/api/upload/finalize`) — every uploaded file is link-shareable, not
  restricted to specific Google accounts (matches how PDF/detail pages
  embed these URLs directly as `<img src>`/download links).

## 7. Fonts and branding assets

- Sarabun Thai font: `public/fonts/Sarabun-Regular.ttf` /
  `Sarabun-Bold.ttf` — required for every PDF export (MQR and PM). Loaded
  from disk at render time (`lib/pdf/fonts.ts`), not fetched over HTTP;
  `next.config.mjs`'s `outputFileTracingIncludes` must include
  `public/fonts/**` or the Vercel serverless function won't have these
  files bundled.
- Mahindra logo: `public/assets/branding/mahindra-logo.png` — **not
  present in this repository as of RC1** (see release notes' "Known
  Limitations"). `lib/pdf/PdfBrandLogo.tsx` gracefully renders a
  correctly-sized blank slot when this file is absent — no crash, no
  placeholder image. Drop the real PNG at this exact path and every PDF
  document (MQR + PM) picks it up automatically on the next deploy, no
  code change required. `outputFileTracingIncludes` already includes
  `public/assets/**` for this.

## 8. Rollback

There is no automated rollback tooling. To roll back a bad deploy:
1. Use Vercel's dashboard to "Promote" the previous known-good
   deployment back to Production (instant, no rebuild needed).
2. If the bad deploy included a Supabase migration, evaluate whether the
   migration itself needs reverting — since this project's convention is
   additive-only migrations, a rollback of application code alone
   usually doesn't require a schema rollback (older code simply ignores
   new columns it doesn't know about). Only revert a migration if it
   changed behavior the old code actively depends on differently (rare,
   given the additive-only convention).
