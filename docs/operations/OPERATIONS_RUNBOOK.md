# Operations Runbook (RC1)

For deployment steps and environment setup, see
`docs/deployment/DEPLOYMENT_GUIDE.md`. This document covers day-2
operations: backup/restore, and troubleshooting the failure modes this
system has actually hit or is architecturally exposed to.

## 1. Backup

- **Database**: Supabase manages automatic backups for the project
  (Point-in-Time Recovery availability depends on the project's Supabase
  plan tier — verify current plan in the Supabase dashboard before
  relying on a specific retention window). No custom backup job exists
  in this codebase.
- **Files (Google Drive)**: no separate backup process — Drive is the
  system of record for every photo/video/PDF. Google Workspace's own
  trash/version history (30-day default) is the only recovery path for
  an accidentally-deleted file; this app never hard-deletes a Drive file
  itself (soft-deleting a `records`/`pm_records` row does not delete its
  photos from Drive).
- **Before any manual/destructive database operation** (bulk data fix,
  manual `UPDATE`/`DELETE` via the Supabase SQL editor): take an explicit
  snapshot first if the project's plan doesn't include continuous PITR,
  or confirm the PITR window covers the intended rollback point.

## 2. Restore

- **Single soft-deleted record** (`records.record_status = 'Deleted'` or
  `pm_records.record_status = 'Deleted'`): the row still exists in the
  database — no restore procedure needed, just flip `record_status` back
  to `'Active'` via a direct SQL update (there is no in-app "undo delete"
  UI). Always check `deleted_reason` (PM only) first to understand why it
  was deleted before restoring a **locked** record.
- **Full database restore**: use Supabase's Point-in-Time Recovery from
  the dashboard (Database → Backups). This is a project-level operation —
  confirm with the team before initiating, since it can affect all
  tables simultaneously, including ones unrelated to the incident.
- **Audit trail is never itself restorable-into** — `record_audit_log`
  has no UPDATE/DELETE RLS policy (immutable by design). If a PITR
  restore rolls the whole database back, `record_audit_log` rolls back
  with it like every other table; there's no separate retention for it.

## 3. Common operational failures

### 3.1 Google Drive upload fails for everyone
**Likely cause**: `GOOGLE_OAUTH_REFRESH_TOKEN` expired or was revoked.
**Check**: Vercel function logs for `/api/upload*` routes — look for
`invalid_grant` in the error response from Google's token endpoint.
**Fix**: see `docs/deployment/DEPLOYMENT_GUIDE.md` §4 (refresh token renewal).

### 3.2 A specific large file (video, high-res photo) fails to upload
**Likely cause**: the >4MB chunked-relay path
(`/api/upload/init`→`chunk`→`finalize`) hit a transient network error
mid-chunk. `putFileViaServerRelay()` (client-side, in
`components/shared/upload/uploadFileSmart.ts`) retries each chunk up to 3
times with backoff before giving up.
**Check**: does the failure reproduce on retry from the UI (the whole
upload restarts, not just the failed chunk, since there's no resumable
upload UI)? If it fails consistently for one specific file, check the
file's actual size/type — HEIC/HEIF conversion only happens on the ≤4MB
direct-proxy path (`/api/upload/route.ts`), not the chunked path.
**Fix**: usually transient — ask the user to retry. If it's not
transient, check Vercel function logs for the specific `/api/upload/chunk`
request's error.

### 3.3 A newly-uploaded video shows "still processing" in the player
**Not a bug** — normal Google Drive transcoding delay for a
just-uploaded video. Documented in root `CLAUDE.md` §8.2. Do not
investigate as an upload failure.

### 3.4 PDF export fails or is missing photos
**Likely cause**: a photo's Drive URL is unreachable at PDF-render time
(link sharing permission not yet propagated, network blip, or a
`thumbnail?id=...`-style URL Google occasionally rejects a server-side
fetch for). `fetchImageAsDataUri()` (`lib/pdf/fetchImage.ts`) has a 10s
timeout per photo and degrades to a "โหลดรูปไม่สำเร็จ" placeholder on
failure — this should never crash the whole PDF. If the **entire** PDF
export 500s (not just one missing photo):
**Check**: Vercel function logs for the export route
(`/api/records/[jobId]/export`, `/api/pm-records/[id]/export`,
`/api/records/export`, `/api/pm-records/history/export`) — look for a
font-loading error (`Unknown font format`) first, since that has
historically been caused by Vercel Deployment Protection intercepting the
font self-fetch; this project's fonts are read from disk specifically to
avoid that class of failure (see `lib/pdf/fonts.ts`'s doc comment) — if
this error reappears, something changed the font-loading approach back
to an HTTP fetch.

### 3.5 CSV export shows garbled Thai text in Excel
**Likely cause**: opened directly by double-clicking rather than via
Excel's "Data → From Text/CSV" import, on a very old Excel version that
doesn't respect the UTF-8 BOM `buildCsv()` (`lib/exportCsv.ts`) prefixes
every export with. Modern Excel (2016+) on Windows handles the BOM
correctly.
**Fix**: none needed in-app; if this recurs on a specific dealer's
machine, have them import via "From Text/CSV" and manually select UTF-8.

### 3.6 A PM record can't be edited / shows "ถูกล็อก"
**Not a bug** — the PM Lock Policy (see
`docs/architecture/SYSTEM_ARCHITECTURE.md` §6). A record locks 24h after
creation, or immediately once a newer record exists for the same
vehicle. Central/SuperAdmin can open a 24h temporary unlock
(`POST /api/pm-records/[id]/unlock`) from the record detail page. If a
DealerAdmin/DealerUser reports this, direct them to ask a Central/SuperAdmin
for a temporary unlock rather than treating it as a defect.

### 3.7 Vehicle 360 shows "ยังไม่ได้ผูกกลุ่มผลิตภัณฑ์" (no Product Family) for a vehicle
**Not a bug** — every tractor model must be explicitly assigned to a
Product Family (`/admin/product-family-models`) before the Maintenance
Due/Compliance/Health engine has anything to evaluate against. A newly
Tractor-IN-synced model with no admin mapping yet correctly shows no
maintenance program, by design (matches the same "zero mapping = zero
options" behavior the old model-based PM Program had).
**Fix**: an admin must configure the mapping; not a code defect.

### 3.8 Tractor IN sheet sync appears stale
**Likely cause**: `lib/tractorSheet.ts` reads live from the public Google
Sheet on each request that needs it (not a scheduled background sync) —
check `TRACTOR_SHEET_ID`/`TRACTOR_SHEET_GID` are still correct and the
sheet's sharing settings still allow public/anyone-with-link read access
(a sharing-settings change on the source sheet is the most common cause
of this silently breaking).

### 3.9 Login fails for a user with a correct password
**Likely cause**: `SESSION_SECRET` mismatch between what signed an
existing cookie and what's currently deployed (e.g. right after a
`SESSION_SECRET` rotation, every existing session becomes invalid — this
is expected, not a bug, but will generate a burst of "please log in
again" reports right after such a rotation). Check `users.active` and
`password_algo`/`password_hash` if it's isolated to one user rather than
everyone.

### 3.10 A dealer/branch-restricted user sees data outside their scope
**Treat as a P0 security incident, not a routine bug.** This should never
happen given the two-layer isolation model (RLS + `applyScope()`/
repository-level scoping — see `docs/architecture/SYSTEM_ARCHITECTURE.md`
§6). If reproduced: identify the exact API route and query involved,
check whether it correctly re-derives `dealer_id`/`branch_id` from the
session server-side rather than trusting a request parameter (the exact
class of bug fixed in this RC for
`features/maintenance/utils/parseHistoryFilter.ts` — see release notes).

## 4. Where to look first, in order

1. Vercel function logs for the specific route involved (every route in
   this app `console.error`s before returning an error response).
2. Supabase logs (`get_logs`) if the failure looks database-side.
3. `docs/PROJECT_STATE.md` — has this exact area been touched recently,
   and is there a documented "accepted limitation" that explains the
   behavior rather than a defect?
4. This runbook's §3 for a known pattern.
5. If genuinely novel, reproduce locally against the same Supabase
   project (there is no separate staging database) with extreme care
   around any write operation.
