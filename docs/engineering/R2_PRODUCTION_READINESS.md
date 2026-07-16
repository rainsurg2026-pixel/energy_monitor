# Cloudflare R2 — Production Readiness Review

Review date: 2026-07-04. Scope: `src/shared/attachments/CloudflareR2Provider.ts`,
`r2Config.ts`, `StorageProviderFactory.ts`, `AttachmentService.ts`,
`AttachmentRepository.ts`, `AttachmentErrors.ts`, `/api/attachments/*`
routes, plus live checks against the actual dev R2 bucket (`masp`) and
Supabase DB configured in `.env.local`. **R2 is enabled in the
development environment only** (`STORAGE_PROVIDER=CLOUDFLARE_R2` in
`.env.local`); no production environment variable has been touched.

This is a review-and-harden pass only. One narrow, additive code change
was made as part of this review (object-key sanitization — see §7); no
other production behavior, architecture, or business module was changed.

> **Update (Final Production Hardening milestone):** blocker #3
> (R2-as-archive permanent public URLs) **RESOLVED** in code -
> `CloudflareR2Provider.upload()` now returns `url: null`, and
> `StorageProviderFactory.createArchiveProvider()` rejects
> `ARCHIVE_PROVIDER=CLOUDFLARE_R2` outright.
>
> **Update (Production Infrastructure Hardening milestone):** blocker #1
> (public bucket access) is **RESOLVED** - re-verified live this session,
> the same public-dev-URL request that returned `200` (fully readable, no
> auth) in the original review now returns **`401`**. Someone with
> Cloudflare dashboard access has disabled the "R2.dev subdomain" setting
> between reviews. Blocker #2 (CORS) is **still open** - live-verified
> this session that both reading (`GetBucketCorsCommand`) and writing
> (`PutBucketCorsCommand`) the bucket's CORS configuration via this app's
> R2 API token return `AccessDenied`; a real CORS preflight against the
> live presigned-PUT endpoint still returns `403` with no
> `Access-Control-Allow-Origin` header. This app's own credentials cannot
> configure CORS - it requires separate Cloudflare dashboard access (see
> Production Checklist).

## Verdict: **STILL NOT production-ready** - two of three original blockers are now resolved; one remains (CORS), and it requires a Cloudflare dashboard action this app's own API token cannot perform

---

## 1. Bucket configuration

| Check | Result |
|---|---|
| Private access | **PASS - RESOLVED this milestone** |
| No anonymous object access | **PASS - RESOLVED this milestone** |
| Bucket policy | WARNING (still unverifiable via API token) |
| Least privilege | PASS (inferred) |

**PASS — Public access disabled, confirmed live this session.** The same
public-dev-URL request that returned `200` (full anonymous read) in the
original review now returns **`401 Unauthorized`** for a freshly uploaded
test object at the same guessable key pattern
(`module/entityType/entityId/timestamp-filename`). The "Public
Development URL" (`https://pub-<hash>.r2.dev`) setting has been disabled
in the Cloudflare dashboard since the last review. Combined with the
prior milestone's code fix (no code path ever constructs or relies on
that URL - §4/§7), **there is now no way to read an object from this
bucket without a valid signature** - evidence: `fetch()` against the
known public host for a live key → `401`.

**Bucket policy** could not be inspected via the API token in use — see
CORS finding below; the token appears scoped to object-level
read/write/delete only, not bucket administration. Confirming the actual
bucket policy (public access block, R2 API token scope) requires the
Cloudflare dashboard directly.

**Least privilege (inferred PASS):** the `GetBucketCorsCommand` call
during this review returned `AccessDenied` rather than succeeding — a
positive signal that the API token is *not* an account-wide admin token
and can't manage bucket configuration, only read/write/delete objects.
This is consistent with least privilege, but should be explicitly
confirmed in the Cloudflare dashboard (token scope, not inferred from one
denied call).

## 2. CORS

| Check | Result |
|---|---|
| Configuration present | **FAIL - confirmed absent, not just unverifiable** |
| Browser upload (signed PUT) | **FAIL - real preflight tested, blocked** |
| Allowed origins | Not configured (none) |
| Allowed methods | Not configured (none) |

**This app's own R2 API token cannot read or write bucket CORS
configuration** - live-verified again this session: both
`GetBucketCorsCommand` and `PutBucketCorsCommand` return `AccessDenied`.
Attempting to apply the required CORS rule programmatically (as part of
this milestone's "configure and verify CORS" task) failed for exactly
this reason - this is bucket-level administration the token is correctly
*not* scoped for (good for least privilege - see §7 - but it does mean
CORS must be set by whoever holds separate Cloudflare account/dashboard
access, not by this application or its credentials).

**A real CORS preflight was sent this session** - not inferred, an actual
`OPTIONS` request to the live presigned-PUT URL with
`Origin: https://mqr-mahindra.vercel.app` (the production origin as
documented in root `CLAUDE.md` at the time this review was written -
since corrected, see below), `Access-Control-Request-Method: PUT`,
`Access-Control-Request-Headers: content-type` - and it returned **`403`
with no `Access-Control-Allow-Origin` header at all**. A real browser
would block the actual `PUT` before sending it. This confirms (not just
infers) that the large-file direct-upload path is broken for any real
browser today, while R2 is enabled.

**Correction (2026-07-16)**: `mqr-mahindra.vercel.app` was never actually
the live production alias (it 404s with `DEPLOYMENT_NOT_FOUND`) - the
real, working production URL is `masp-mseal.vercel.app`. The `403`/no-
CORS-header result above still stands (no origin is currently allowed at
all, per the bucket's own empty CORS config checked earlier in this
doc), but the required configuration below now lists the correct origin.

**Required CORS configuration** (exact JSON, to be applied via
Cloudflare dashboard → R2 → bucket `masp` → Settings → CORS Policy):

```json
[
  {
    "AllowedOrigins": [
      "https://masp-mseal.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**Per-permission justification** (each one checked against actual code,
not assumed):

- `AllowedOrigins`: `masp-mseal.vercel.app` is the documented production
  origin (root `CLAUDE.md`); `localhost:3000` is this app's local dev
  server default (`next dev`) - both genuinely needed, since R2 is
  currently exercised from local dev only, and the production origin will
  need this the moment R2 is ever enabled there. **Required.**
- `PUT`: the one method `uploadAttachment.ts` actually sends
  cross-origin, for the large-file direct-upload path. **Required.**
- `GET`: not currently used by any browser `fetch()` -
  `AttachmentViewer.tsx` renders previews/downloads via `<img>`/`<video>`/
  `<audio>`/`<iframe>`/`<a href download>` tags, confirmed by grep (zero
  `fetch()` calls against a signed URL anywhere in client code); these
  tags are not subject to CORS for basic rendering. **Not strictly
  required by any code that exists today** - included per the milestone's
  explicit requirement and as reasonable headroom for a future
  `fetch()`-based preview feature, but flagged here rather than silently
  presented as load-bearing.
- `HEAD`: same reasoning as `GET` - no code issues a cross-origin `HEAD`
  today. **Not strictly required**, included for the same forward-looking
  reason.
- `Content-Type` (AllowedHeaders): the one custom header the client's PUT
  actually sets (`uploadAttachment.ts`: `headers: { 'Content-Type':
  file.type }`). **Required.**
- `ETag` (ExposeHeaders): not read by any client code today (no
  `fetch()`-based response-header inspection exists) - **not currently
  required**, but harmless to expose and consistent with the milestone's
  request; would matter if a future feature cross-checks R2's ETag
  against the app's own sha256 checksum client-side (see §3's
  recommendation).
- `MaxAgeSeconds: 3600`: reasonable preflight cache duration, no
  functional risk either way.

Net: this exact configuration is safe and consistent with least privilege
in spirit (no method/header is exploitable if unused), but three of the
eight requested permissions (`GET`, `HEAD`, `ETag`) are not load-bearing
for any code that exists today - documented so a future reviewer
understands which parts are "needed now" versus "provisioned ahead of a
feature that doesn't exist yet."

## 3. Object metadata

| Field | Result |
|---|---|
| Content-Type | PASS |
| Cache-Control | **WARNING** |
| Content-Disposition | **WARNING** |
| ETag | PASS (informational only) |
| Content-Length | PASS |

Re-verified live this session via `HeadObject` on a fresh test object:
`Content-Type: text/plain` (correct), `Content-Length: 46` (correct),
`ETag: "d5ac444ca2194d81746032b2cba86c6c"` (present) - all **PASS**, every
uploaded object genuinely carries all three. `Cache-Control` and
`Content-Disposition` remain **not set** by `upload()` - unchanged, no
code was touched this milestone (infrastructure-validation-only scope).

**Recommended values, by attachment type** (not applied - a code change,
out of scope for this milestone):

| Type | `Cache-Control` | `Content-Disposition` | Why |
|---|---|---|---|
| Images (`MeterPhoto`/`NameplatePhoto`/`ReportPhoto`/`DefectPhoto`/`RepairPhoto`/`CustomerSignature`) | `private, max-age=3600` | `inline` | Re-rendered repeatedly (Machine 360, PM/MQR detail pages) - caching cuts repeat signed-URL fetches; `private` since these are dealer/customer-specific, never shared CDN-cacheable; `inline` so they display in `<img>` rather than prompting a download |
| PDF | `private, max-age=3600` | `inline; filename="<original filename>"` | Same caching rationale; `inline` lets the browser's built-in PDF viewer render it in the `<iframe>` `AttachmentViewer.tsx` already uses, with a sensible filename if a user does choose to save it |
| Video | `private, max-age=86400` | `inline` | Videos are larger and re-watched less mid-session but still benefit from a day's caching if replayed; `inline` for the `<video>` tag |
| Excel/Other | `private, no-cache` | `attachment; filename="<original filename>"` | These aren't previewable inline (`AttachmentViewer.tsx` already falls back to a download prompt for these) - `attachment` triggers a proper "Save As" with the right filename instead of the browser guessing; `no-cache` since these are typically fetched once, downloaded, and not re-viewed the way a photo is |

`ETag` is present and correct but is never cross-checked against the
app's own sha256 `checksum` column - two independent integrity signals
that currently never talk to each other. Not fixed this milestone (a code
change); listed under Recommended Improvements.

## 4. Signed URLs

| Check | Result |
|---|---|
| Preview | PASS |
| Download | PASS |
| Expiration | PASS |
| Replay risk | WARNING (inherent, not a defect) |
| Permanent-URL leak (upload/archive path) | **RESOLVED this milestone** |

Live-verified: `getSignedUrl()` produces a valid presigned `GetObject` URL
that a plain `fetch()` (no additional auth) can retrieve, with bytes
matching the original upload exactly. Default expiry is 3600 seconds
(1 hour), matching `SupabaseStorageProvider`'s default - consistent
across providers. **Replay risk is inherent to presigned URLs generally**
(anyone holding the URL can use it until expiry, and R2/S3 presigned URLs
have no single-use enforcement) - this is a known, accepted trade-off of
the presigned-URL pattern itself, not something specific to this
implementation, and matches how Google Drive's own share links already
behave (no single-use enforcement there either). Worth documenting as a
standing characteristic, not fixing.

**RESOLVED this milestone:** the previous review found
`CloudflareR2Provider.upload()` returned a permanent, non-expiring public
URL (`${this.publicUrl}/${path}`) in its `StoredObject.url` field,
mirroring `GoogleDriveStorageProvider`'s share-link pattern - unused when
R2 is primary, but persisted as `drive_url` (bypassing `getSignedUrl()`
entirely for every future read) if R2 were ever the *archive* provider.
Fixed two ways: (1) `CloudflareR2Provider.upload()` now returns `url:
null` unconditionally - live-verified this session; (2)
`StorageProviderFactory.createArchiveProvider()` now throws if
`ARCHIVE_PROVIDER=CLOUDFLARE_R2` is set at all, rather than allowing a
configuration `AttachmentService.getUrl()` can't safely serve. `R2Config`/
`r2Config.ts` no longer has a `publicUrl` field, and `R2_PUBLIC_URL` is no
longer read anywhere - confirmed by a full-repository search (no code
constructs an `*.r2.dev` URL or any other permanent object URL). The only
way to get a usable URL for any R2 object, at any point in its lifecycle,
is `AttachmentService.getUrl()` calling `getSignedUrl()` on demand.

## 5. Upload strategy

| Check | Result |
|---|---|
| Small files (<=4MB, proxied) | PASS |
| Large files (signed PUT) | PASS (live-verified upload path; browser CORS untested - see §2) |
| Multipart upload | Not implemented (WARNING) |
| Retry | PASS (SDK-level only) |
| Interrupted upload recovery | **FAIL** |

Small-file uploads (`/api/attachments` POST, HEIC conversion, single-shot
`PutObjectCommand`) work identically regardless of provider - live-verified.
Large-file direct-PUT-to-signed-URL was live-verified at the
`CloudflareR2Provider`/`AttachmentService` level (this review's live E2E
run used a small test file; the *mechanism* - `createSignedUploadUrl()` +
`finalizeDirectUpload()`'s `HeadObjectCommand` confirmation - is identical
code regardless of file size, so this is a reasonable inference, not a
literal multi-GB test).

**No multipart upload support** - `PutObjectCommand` is single-shot,
capped in practice by R2 to 5GiB per single `PUT` (a real, if generous,
ceiling) and by Vercel's function memory/timeout for anything routed
through our own server (not applicable to the direct-PUT path, which
bypasses our server entirely). Not a blocker at today's expected
attachment sizes (photos, PDFs, short videos), but a real limitation for
arbitrarily large files.

**Retry** exists only at the AWS SDK's own default layer (3 attempts,
exponential backoff, for retryable/transient errors) - there is no
application-level retry, resume, or idempotency key on top of that.

**Interrupted upload recovery is a real gap (FAIL):** if a browser's
direct PUT to a signed URL is interrupted partway (network drop, tab
closed), `finalizeDirectUpload()` will find no object at that key
(`statObject()` returns `null`) and throw - correctly refusing to
finalize a broken upload. But the *placeholder* attachment row created by
`initDirectUpload()` (status effectively `ACTIVE`, `sizeBytes: 0`,
`checksum: null`) is never cleaned up in that failure case - it becomes
an orphan row with no corresponding object, indistinguishable from a
row whose upload simply hasn't finished yet. See §6 (orphan detection).

## 6. Lifecycle

| Check | Result |
|---|---|
| Retention | PASS (config exists) |
| Archive | PASS - R2-as-archive is now rejected outright, not silently broken (see §4) |
| Restore | PASS (live-verified in the prior milestone) |
| Orphan detection | **FAIL** |
| Cleanup | WARNING |

Retention (`attachment_retention_policies`, `enqueueArchiveEligible()`)
and restore (`AttachmentService.restore()`, live-verified end-to-end in
the previous milestone's report) both work as designed and are
provider-independent. Archive-to-R2's latent public-URL issue (§4) is
resolved by rejecting that configuration at `StorageProviderFactory`
level - Google Drive remains the only archive provider until
`AttachmentService.getUrl()` is taught to sign against a non-Drive
archive (out of scope for this hardening pass - a real feature).
**Orphan detection does not exist**: neither the direct-upload
placeholder-row case (§5) nor a `delete()` call that fails after removing
the object but before removing the DB row (or vice versa - the two are
not transactional) are ever detected or reconciled by anything today.
There is no periodic job that cross-checks `attachments` rows against
actual bucket contents (in either direction).

## 7. Security

| Check | Result |
|---|---|
| Secrets | PASS |
| IAM permissions | WARNING (needs manual dashboard confirmation) |
| Path traversal | **FIXED this pass (was WARNING, now PASS)** |
| Object key validation | **FIXED this pass** |

**Secrets**: `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` are read from env
vars only (`r2Config.ts`), never logged, never echoed in any error path.
Re-verified live this session with a deliberately hostile fake error
(`"AccessDenied: User arn:aws:iam::123:user/r2-token is not authorized on
bucket masp with key r2-secret-abc123"`) fed through
`toUserFacingAttachmentError()` - the mapped message was exactly
`"Attachment is temporarily unavailable."`, containing neither the bucket
name, the ARN, nor any credential fragment. PASS, confirmed twice now.

**IAM permissions**: re-confirmed this session - the app's R2 API token
gets `AccessDenied` on *both* `GetBucketCorsCommand` and (new this
session) `PutBucketCorsCommand`. Two independent denied bucket-admin
calls is stronger evidence than the single one in the original review:
this token is genuinely object-scoped (read/write/delete objects only),
not a bucket- or account-admin token. Still recommend an explicit,
one-time confirmation directly in the Cloudflare dashboard (token
permissions list) as final sign-off, since this is inferred from
behavior, not read directly from a permissions API.

**Path traversal / object key validation - fixed during this review**:
`buildStoragePath()` (`AttachmentService.ts`) previously sanitized only
the `filename` segment; `module`/`entityType`/`entityId` were passed
straight through unsanitized. The generic `/api/attachments` POST/init
routes accept these as plain client form-data/JSON strings with only an
empty-string check - nothing prevented a client from supplying
`entityId: "../../../other-module"`. Object storage has no real
filesystem traversal semantics (a key literally containing `../`
characters doesn't escape the bucket), but an unsanitized segment could
still collide with another module's key prefix or corrupt `list()`/
archive-folder scoping. Added `sanitizePathSegment()` (allowlists
`[a-zA-Z0-9_-]`, applied to `module`/`entityType`/`entityId` before key
construction) - a single, narrow, additive fix at the one shared
call site every upload path (`upload()`, `initDirectUpload()`) already
goes through. New unit test added confirming a malicious `module`/
`entityType`/`entityId` never produces a key containing `..` or an
unexpected number of path segments. No existing valid input (today's
`module`/`entityType` values are simple literals like `'mqr'`/`'record'`;
`entityId` values are job IDs/UUIDs, all already within the allowed
charset) changes behavior.

## 8. Performance

| Check | Result |
|---|---|
| Upload latency | PASS (not benchmarked quantitatively) |
| Download latency | PASS (not benchmarked quantitatively) |
| Parallel uploads | Not tested |
| Large file handling | WARNING (see §5) |

Live-verified upload/download/signed-URL/list/exists/delete all completed
in what felt like normal interactive latency (sub-second each) during
this review's live runs, but no quantitative latency benchmark (p50/p95,
under load, from a real deployed environment rather than a local dev
machine) has been run. Parallel/concurrent upload behavior (multiple
attachments uploading simultaneously, e.g. PM's three photo slots) has
not been load-tested against R2 specifically.

## 9. Cost

| Check | Result |
|---|---|
| Storage | Not assessed - no volume estimate exists |
| Requests | Not assessed |
| Egress | PASS (R2's headline feature - zero egress fees, unlike S3) |
| Archive growth | Not assessed |

R2's zero-egress-fee model is a genuine cost advantage over S3-compatible
alternatives for a read-heavy attachment workload (Machine 360 re-viewing
photos repeatedly). No actual volume/cost projection exists yet for this
app's expected attachment volume (per-dealer photo counts, retention
windows already defined in `attachment_retention_policies` but not
translated into a storage-growth estimate). This is a business/finance
input this review cannot produce without real usage data - flagged as an
open item, not a pass/fail.

## 10. Disaster recovery

| Check | Result |
|---|---|
| Provider outage | WARNING |
| Rollback procedure | PASS (see Rollback Checklist below) |
| Restore verification | PASS (live-verified in prior milestone) |

**Provider outage**: if R2 is unreachable, every `AttachmentService` call
using it as primary fails outright - there is no automatic failover to a
second provider (by design; `StorageProviderFactory` picks one provider
per role, not a fallback chain). Recovery today means an operator
changing `STORAGE_PROVIDER` back to `SUPABASE` and restarting/redeploying
- not an automated or instant failover.

**Rollback procedure - re-verified live this session, both directions**:
with `STORAGE_PROVIDER` unset (in-process only, `.env.local` never
touched), `StorageProviderFactory.createPrimaryProvider()` returned
`SupabaseStorageProvider`; setting it back to `CLOUDFLARE_R2` returned
`CloudflareR2Provider` again. Confirms task 5's requirement directly:
switching between `SUPABASE` and `CLOUDFLARE_R2` requires only the env
var - no code, no redeploy of application logic (a process
restart/redeploy is still needed for the new env var to take effect,
since it's read at `AttachmentService` construction time, but that's an
operational step, not a code change). **Restore verification**
(`AttachmentService.restore()`, R2 archive → active) was live-verified
end-to-end in the prior milestone's report.

## 11. Observability

| Check | Result |
|---|---|
| Logging | WARNING |
| Metrics | **FAIL** |
| Provider health | **FAIL** |
| Error reporting | PASS (mapped, non-leaking - see §7) |

**Logging**: `AttachmentErrors.ts`'s `toUserFacingAttachmentError()` does
`console.error('[attachments:${context}]', err)` before returning the
sanitized message - so real errors do reach server logs, not just a
generic message to the user. There is no structured logging (no request
ID correlation, no attachment ID consistently included, no log level
distinction) - adequate for debugging by hand, not for production
alerting.

**Metrics**: nothing today counts uploads/downloads/failures per
provider, tracks latency, or exposes a dashboard-friendly signal.
**Provider health**: there is no health check / readiness probe for R2
(or Supabase Storage, or Drive) - a provider outage is discovered only
when a real upload/download fails, not proactively.

**Monitoring recommendations** (task 6 - advisory only, no code changed):

- **Storage metrics**: Cloudflare's own R2 dashboard already exposes
  per-bucket stored bytes and object count with no integration work - the
  recommendation is to actually look at it periodically/set a threshold
  alert there, not to build a custom exporter for something Cloudflare
  already tracks.
- **Request metrics**: same - R2's dashboard shows Class A (write/list)
  and Class B (read) operation counts, which map directly to this app's
  cost model (see §9). Recommend alerting on a sudden spike (a runaway
  loop calling `list()` or `upload()` repeatedly would show up here
  before it shows up as a bill).
- **Error alerts**: `AttachmentErrors.ts`'s `console.error()` calls are
  the only current signal - recommend routing these to whatever
  log-aggregation this app already uses (if any) with an alert on
  `[attachments:*]`-prefixed error rate, rather than building bespoke R2
  alerting from scratch.
- **Cost alerts**: Cloudflare supports account-level billing/budget
  alerts natively - recommend setting one once a real usage baseline
  exists (see §9's "not assessed" note), rather than guessing a threshold
  now with zero production volume data.

None of these require an application code change - they're either
Cloudflare dashboard configuration (storage/request/cost) or a
routing/aggregation decision for logs that already exist (errors).

## 12. Compatibility

| Check | Result |
|---|---|
| Business modules remain provider-independent | **PASS** |

Confirmed by code inspection and this session's live testing: MQR, PM,
and Machine 360 call only `AttachmentService`'s public methods
(`upload`/`getUrl`/`delete`/`list`/`verifyChecksum`/`markBusinessComplete`)
- none reference `CloudflareR2Provider`, `SupabaseStorageProvider`, or
`GoogleDriveStorageProvider` by name anywhere. Switching
`STORAGE_PROVIDER=CLOUDFLARE_R2` in `.env.local` required editing zero
business-module files, zero API routes beyond what already existed, and
zero UI components - verified live this session (full `next build` +
live E2E run with R2 as primary, no code changes). This is the one
category with no reservations.

---

## Critical blockers (must fix before any production rollout decision)

1. **~~Public bucket access~~ (§1) - RESOLVED.** Re-verified live this
   session: the public dev URL now returns `401` for a real object
   (previously `200`, fully readable). Disabled in the Cloudflare
   dashboard since the last review.
2. **CORS unconfirmed for the browser large-file-upload path** (§2) -
   **STILL OPEN, dashboard action required, now confirmed with a real
   preflight (not just inferred).** A live `OPTIONS` request to the
   actual presigned-PUT URL returned `403` with no
   `Access-Control-Allow-Origin` header - a real browser would block this
   today. This app's R2 API token cannot configure CORS itself
   (`PutBucketCorsCommand` → `AccessDenied`, tested this session). Exact
   required configuration is in §2 above. Must be applied via the
   Cloudflare dashboard by someone with bucket-admin access before
   large-file direct uploads are trusted anywhere real.
3. **~~R2-as-archive would persist permanent public URLs~~ (§4) - RESOLVED
   this milestone.** `CloudflareR2Provider.upload()` never returns a URL
   (always `null`), and `StorageProviderFactory` now rejects
   `ARCHIVE_PROVIDER=CLOUDFLARE_R2` outright. Live-verified and unit-tested.

**Two of three original blockers are now resolved. One remains: CORS.**

## Recommended improvements (not blockers, worth scheduling)

- Set `Cache-Control` (and consider `Content-Disposition`) on upload (§3).
- Orphan-row reconciliation for interrupted direct uploads (§5, §6).
- Structured logging + basic metrics (upload/download counts, failure
  rate, latency) per provider (§11).
- A lightweight provider health check, rather than discovering an outage
  via a failed user-facing request (§11).
- A real storage/request/egress cost projection once usage data exists (§9).
- Cross-checking R2's own `ETag` against our sha256 `checksum` at upload
  time, as a second integrity signal (§3).

## Production checklist

- [x] ~~Disable R2's public development URL; confirm no object is
      reachable without a signed URL or authenticated request~~ - **done,
      re-verified live this session (200 → 401)**
- [ ] Apply the exact CORS configuration in §2 via the Cloudflare
      dashboard (bucket `masp` → Settings → CORS Policy) - **still open**,
      confirmed with a real preflight this session (403, no
      Access-Control-Allow-Origin)
- [ ] Test the large-file direct-PUT path from an actual browser once
      CORS is applied (not just the OPTIONS-preflight check performed
      here)
- [x] ~~Resolve the R2-as-archive permanent-URL issue, or explicitly
      document `ARCHIVE_PROVIDER=CLOUDFLARE_R2` as unsupported until
      fixed~~ - **done**: `StorageProviderFactory` rejects it outright
- [x] ~~Confirm R2 API token scope (object-level only, no bucket/account
      admin)~~ - **done, reinforced this session**: both
      `GetBucketCorsCommand` and `PutBucketCorsCommand` denied
- [ ] Add orphan-row cleanup for interrupted direct uploads
- [ ] Add basic structured logging/metrics before relying on this in
      production incident response (see §11's monitoring recommendations)
- [ ] Set `Cache-Control`/`Content-Disposition` per the recommendations in
      §3 (a code change, not attempted this milestone)
- [ ] Re-run the full live E2E verification (upload/download/signed
      URL/list/exists/delete/checksum), including a real-browser CORS
      test, against the actual production bucket before flipping
      `STORAGE_PROVIDER` in that environment

## Rollback checklist

Rollback is a configuration change only - no code, no data migration:

- [ ] Set `STORAGE_PROVIDER=SUPABASE` (or unset it - that's the default)
      in the affected environment
- [ ] Redeploy / restart so the new `AttachmentService()` default takes
      effect (provider selection happens at construction, not cached
      elsewhere)
- [ ] Any attachment rows already written with `storage_provider =
      'CLOUDFLARE_R2'` remain valid and readable - `AttachmentService`
      resolves each row's URL through whichever provider it actually
      used (`attachment.storageProvider`, not the current default), so a
      rollback does not orphan or break previously-uploaded R2 objects
- [ ] No new uploads will go to R2 after rollback; existing R2 objects
      are untouched and remain accessible until separately migrated or
      archived

---

## Verification

**Original review:**
- `npm run lint` → 0 errors (7 pre-existing warnings, unrelated)
- `npm run typecheck` → clean
- `npm test` → 269/269 passing (1 new test added for the object-key
  sanitization fix)
- `npm run build` → succeeds
- Live verification against the real dev R2 bucket (`masp`): CORS
  (denied - informative, see §2), object metadata, public-access check
  (confirmed public - the critical finding), traversal-style key upload
  attempt (inconclusive at the R2 layer, addressed at the application
  layer - see §7)

**Final Production Hardening milestone (this update):**
- `npm run lint` → 0 errors (7 pre-existing warnings, unrelated)
- `npm run typecheck` → clean
- `npm test` → 272/272 passing (3 new: `CloudflareR2Provider.upload()`
  never returns a URL, `StorageProviderFactory` rejects
  `ARCHIVE_PROVIDER=CLOUDFLARE_R2`, plus a strengthened integration
  assertion that no `url`/`public_url`/`drive_url` field is ever
  persisted for an R2-primary upload)
- `npm run build` → succeeds
- Live re-verification against the real dev R2 bucket: upload, database
  metadata (no URL persisted, `storage_path` confirmed to be a bare key
  never a URL), `CloudflareR2Provider.upload()` confirmed to return
  `url: null` directly against live R2, signed-URL generation, preview/
  download via that signed URL, delete (row + object) - **6 PASS**, plus
  one informational **WARNING** (the bucket's public dev URL is still
  reachable - a dashboard setting, not a code defect, tracked as the
  still-open blocker above)
- Full-repository search (`grep -rn "r2.dev\|R2_PUBLIC_URL\|publicUrl"`)
  confirms no remaining code path constructs a public R2 URL - the only
  matches left are this document, `STORAGE_PLATFORM.md`, and doc comments
  explaining the fix

**Production Infrastructure Hardening milestone (this update) - no code
changed, verification/infrastructure-review only:**
- Live re-verification, real R2 bucket + real DB: public-dev-URL request
  → **401** (was 200 - RESOLVED), CORS read attempt (`GetBucketCorsCommand`)
  → `AccessDenied`, CORS write attempt (`PutBucketCorsCommand`, part of
  this milestone's "configure CORS" task) → also `AccessDenied` (this
  app's token cannot do it - dashboard action required), object metadata
  (`Content-Type`/`Content-Length`/`ETag` all present and correct),
  security re-check (no permanent URL stored/returned, signed URL is the
  only download path, a hostile fake AWS error mapped cleanly through
  `toUserFacingAttachmentError()`), rollback both directions
  (`SUPABASE` ⇄ `CLOUDFLARE_R2` via env var only) - **8 PASS**, **3
  WARNING** (CORS read denied - informative; Cache-Control/
  Content-Disposition still unset, as expected since no code was
  touched), **1 FAIL** (CORS write denied - confirms the dashboard-only
  nature of the remaining blocker, not a regression)
- A real CORS preflight (`OPTIONS` with `Origin`/`Access-Control-Request-Method`/
  `Access-Control-Request-Headers`) against the live presigned-PUT URL →
  **403, no `Access-Control-Allow-Origin` header** - direct evidence a
  real browser upload would be blocked today
- Two orphaned placeholder rows (from `initDirectUpload()` calls made
  during the CORS-preflight tests, which never complete a real PUT) were
  found and deleted via direct SQL cleanup - no R2 objects existed for
  either key (the preflight never sends bytes), so this was a pure DB
  cleanup, not evidence of a new defect

---

## Final recommendation

**NO GO for production**, but the gap has narrowed to exactly one item.

Two of the three original code/infrastructure blockers are now closed:
public bucket access is disabled (infrastructure), and the R2-as-archive
permanent-URL risk is resolved (code, from the prior milestone). The
**one remaining blocker is CORS** - confirmed this session with a real
preflight request, not inferred - and it requires a Cloudflare dashboard
action this application's own credentials cannot perform. The exact JSON
configuration and dashboard location are documented in §2.

**Once CORS is applied:**
1. Re-run a real preflight (or, ideally, an actual browser upload) against
   the live bucket to confirm `Access-Control-Allow-Origin` is now
   returned.
2. Re-run the full Production Gate Review (all 10 items from the prior
   gate review) - items 1 and 2 (public URL, private bucket) should now
   both read PASS; item 3 (CORS) is the one to re-check.
3. Only then would this reach a GO state for enabling
   `STORAGE_PROVIDER=CLOUDFLARE_R2` in a real environment - and that
   remains a separate, explicit decision this document does not make on
   anyone's behalf.

No code was changed in this milestone. No production environment was
touched. Application code itself has not required a change since the
Final Production Hardening milestone - the remaining work is entirely
Cloudflare dashboard configuration.
