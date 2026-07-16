# MASP Platform Foundation v1.1.0

**Release date:** 2026-07-08
**Version:** v1.1.0
**Branch:** `feature/pm-record-workflow-redesign` → `main`
**Status:** Verified and accepted.
**Supersedes:** `docs/releases/archive/MASP_PLATFORM_FOUNDATION_V1.0.md` (v1.0.0 — not modified, kept as the historical record of that milestone).

This is the official baseline record for the MASP (Mahindra After Sales
Platform) Foundation with the Dealer/Branch Scope Platform Standard now
applied across every business module. `PROJECT_STATE.md` remains the
complete chronological build log; this document is the release snapshot
for v1.1.0 specifically.

## Summary

v1.0.0 shipped the Attachment/Storage/Historical Import foundation and
all four business modules with dealer-level authorization only, and
`DealerUser` visibility limited to records that user personally created.
v1.1.0 replaces that with a single shared authorization standard,
**DealerBranchScope** (`src/lib/dealerBranchScope.ts` +
`src/components/shared/scope/`), applied identically across NTR, PM,
QIR/MQR, Machine360, Reports, Export, Historical Import, and every
shared search dialog:

- **SuperAdmin** / **CentralAdmin** — every dealer, every branch.
- **DealerAdmin** — every branch inside their own dealer.
- **DealerUser** — every record inside their own assigned branch (a
  service branch is a team, not an individual; this replaces the old
  `seesOwnRecordsOnly` "records I created" rule).

Real gaps found and fixed during the rollout (not just refactoring):
NTR/PM's Machine360 "fetch-for-serial" utilities were filtering on the
legacy free-text `session.branch` instead of the real `branchId`
(silently broken); `GET /api/pm-records` was completely unscoped,
returning every dealer's PM records to any authenticated user; MQR's
`createRecord()` validated a submitted `branch_id` only against the
dealer, not the DealerUser's own branch; NTR Historical Import validated
`dealer_id` but never `branch_id`; several admin master-data routes
(branches/technicians/users CRUD, `platform/events`) duplicated the
dealer-scope ternary inline instead of using the shared resolver.

## Architecture overview

Unchanged from v1.0.0 (one Next.js 14 app, Supabase source of truth,
`AttachmentService` as the sole storage door — see the archived v1.0.0
doc for that diagram). This release adds one more shared layer every
module goes through:

```
NTR / PM / QIR(MQR) / Machine360 / Historical Import / Search Dialogs
              |
              v
   resolveDealerScope() / resolveBranchScope() / assertBranchAccess() /
   canAccessDealerBranch()          (src/lib/dealerBranchScope.ts)
              |
              v
        applyScope()  (src/lib/db.ts, query-level enforcement)
```

Client-side counterpart: `useDealerBranchScope()` hook +
`<DealerBranchSelector>` component (`src/components/shared/scope/`),
replacing five independent hand-rolled dealer/branch filter
implementations across Dashboard, NTR, PM, Records, and the three
create-flow search dialogs (`ntr-search.tsx`, `maintenance-search.tsx`,
`report-form.tsx`).

## Core Modules

Unchanged from v1.0.0 (NTR, PM, QIR/MQR, Machine360) — every module now
additionally enforces branch-level authorization via DealerBranchScope,
end-to-end: UI filter/selector, repository, API (GET/POST/PUT/DELETE),
dashboard widgets, export, PDF generation, and Historical Import.

## Core Platforms

### DealerBranchScope — **Foundation (feature-frozen), new in this release**

`src/lib/dealerBranchScope.ts` + `src/components/shared/scope/` — the
one shared implementation every module's dealer/branch authorization
goes through. Feature-frozen as of this release: further work is bug
fixes and security hardening only, not new capability, until an explicit
future decision reopens it.

### Attachment Platform — **Foundation (feature-frozen)**, unchanged

No code changes this release. Freeze reaffirmed — see
`docs/engineering/ATTACHMENT_FRAMEWORK.md`.

### Storage Platform — **Foundation (feature-frozen)**, unchanged

No code changes this release. Freeze reaffirmed — see
`docs/architecture/STORAGE_PLATFORM.md`.

### Historical Import Framework — **Foundation (feature-frozen)**

Unchanged generic framework; NTR's concrete implementation gained
`branch_id`-belongs-to-`dealer_id` row validation as part of this
release (a real gap closed, not new capability) — see
`docs/import/NTR_HISTORICAL_IMPORT.md`. Freeze reaffirmed.

## Verification

All re-run fresh at release time, on the exact release commit:

| Check | Result |
|---|---|
| Build | PASS — `next build` succeeds |
| Lint | PASS — 0 errors, pre-existing `<img>`/alt-text warnings only, unrelated to this release |
| Typecheck | PASS — `tsc --noEmit` clean |
| Tests | **PASS — 453/453** (48 test files; up from 413/413 at v1.0.0) |
| Architecture Check | **PASS — 5/5** rules + CI integration check |
| Preview UAT | PASS — fresh Preview deployment at this exact commit; live-verified with real create/edit/delete/upload calls (not just page loads) across SuperAdmin/DealerAdmin/two DealerUsers in different branches of the same dealer: Auth, Dashboard, NTR (create/edit/delete, cross-branch 404), PM (create/edit/delete, cross-branch 404, the unscoped-list bug confirmed fixed), QIR/MQR (create/delete/PDF export, cross-branch 403/404), Machine360 (dealer-scoped vehicle, branch-scoped detail), Historical Import (cross-dealer `branch_id` rejected, same-dealer accepted), Attachment Upload, Export (role-gated correctly). All disposable QA fixtures cleaned up after. |

## Breaking Changes

**`DealerUser` record visibility changed** from "records I personally
created" to "every record in my branch." This is an intentional behavior
change (a service branch is a team, not an individual — a technician
must be able to continue a colleague's record), not a bug. Any external
reporting/tooling that assumed `DealerUser` = "my own records only" will
now see more rows per user. Requires `SessionUser.branchId` (a real
`branches.id`) to be set for a `DealerUser` account — an account with
`branchId: null` sees zero records (fail-closed, not fail-open).

## Known Limitations

- **`vehicle_events` has no `dealer_id`/`branch_id` column.** A
  `DealerUser` may see a generic Machine360 timeline entry (date/title
  only, no PII) for an event whose full record lives in a sibling
  branch; clicking through to that record's detail page is
  independently blocked by that module's own branch check. Full
  per-event branch filtering would require joining back to each source
  module's table by `reference_id` — out of scope for this release.
- **Vehicles remain dealer-scoped, not branch-restricted**, by deliberate
  design — `vehicles.branch_id` is often null (synced from the external
  Tractor-IN sheet), and further restriction would break legitimate
  cross-branch vehicle lookup. Sensitive per-record data (NTR/PM/MQR
  history) surfaced through Machine360 remains correctly branch-scoped
  via each module's own provider.
- Everything listed under v1.0.0's Known External Items (Cloudflare R2
  CORS configuration, the Supabase RLS `SECURITY DEFINER` workaround)
  is unchanged by this release — see the archived v1.0.0 doc.

## Rollback Plan

No destructive migrations were applied this release — `users.branch_id`
is additive and nullable. To roll back:

1. `git revert` (or reset, if not yet widely pulled) the merge commit
   for this release on `main`, back to the last commit before
   `feat(platform): introduce DealerBranchScope foundation and migrate
   Dashboard`.
2. No database cleanup required — the added `branch_id` columns/values
   are inert if the application code reverts to not reading them.
3. Existing `v1.0.0` tag/release remain untouched and valid as the
   rollback target's documented baseline.

## Superseded documents

- `docs/releases/MASP_PLATFORM_FOUNDATION_V1.0.md` — the v1.0.0 release
  baseline; superseded by this document. Moved to
  `docs/releases/archive/`, **not modified** — kept as the accurate
  historical record of that milestone (its own tag and any GitHub
  Release remain as published).

Not superseded (distinct, still-valid scope):
`docs/releases/RELEASE_CHECKLIST_V1.md`,
`docs/releases/RELEASE_CHECKLIST_STORAGE_PLATFORM_V2.1.md`,
`RELEASE_NOTES_v2.1.md`, `CHANGELOG_STORAGE_PLATFORM.md` — all remain
valid, already-final records of earlier, narrower-scope work.
