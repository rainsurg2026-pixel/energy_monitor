# Release Notes — v2.4.0-foundation

Tag: `v2.4.0-foundation`

This release consolidates the Post-v2.3.1 work: master data governance,
production sync hardening, authorization/permission fixes, the Activity
Timeline platform standard, Quality Report editing, and the operations
documentation set that supports all of it going forward. See
`docs/ROADMAP.md`'s "Completed Milestones" / "Next Milestones" sections
for how this fits into ongoing planning.

## Completed

- **Master Data** — Province/District/Subdistrict formalized as System
  Master Data: every business module reads them through
  `MasterDataService` only, and no `INSERT`/`UPDATE`/`DELETE` RLS policy
  exists on any of the six underlying tables.
  `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`.
- **Tractor IN Sync** — production sync from the Tractor IN Google Sheet
  into `vehicles`, with a health endpoint and per-run logging; v2.3.1 Sync
  Hardening executed against production and verified end-to-end (0
  duplicate serials, vehicle count reconciled, product family mappings
  valid). `docs/adr/ADR-012-Tractor-IN-Master-Data.md`,
  `docs/releases/RELEASE_CHECKLIST_V2.3.1_SYNC_HARDENING.md`.
- **AuthorizationScope** — fixed the SuperAdmin dealer-scope bug in
  `getVehicleBySerial()` (v2.3.2). `docs/adr/ADR-013-Authorization-Scope.md`.
- **Permission Matrix** — documented role/scope enforcement across every
  module. `docs/architecture/PERMISSION_MATRIX.md`.
- **Activity Timeline** — a reusable, generic Activity Timeline component
  (the Vehicle 360 foundation), shipped first for Quality Reports:
  icon/action/user/date/summary feed, expand/collapse Diff Viewer,
  Photo History, filters, keyword search, pagination, Quick Navigation.
  Reads the existing shared audit log — no new storage, no duplicated
  history. `docs/architecture/ACTIVITY_TIMELINE.md`.
- **Quality Report Edit** — "Edit Report" on the Quality Report Detail
  page, reusing the existing create form in edit mode (prefilled,
  dealer/branch read-only, keep-or-replace photos); removed the redundant
  "New Quality Report" sidebar entry ("+ Report a new problem" on the
  Quality Reports list is unaffected).
- **Operations Handbook** — `docs/OPERATIONS.md`, the production
  operations reference for the system as it stands today.
- **Production Rollout Documentation** — the v2.3.1 Sync Hardening
  release checklist filled in with real production execution results
  (sync response, before/after health checks, post-sync verification).
  `docs/releases/RELEASE_CHECKLIST_V2.3.1_SYNC_HARDENING.md`.

## Known Issues

- Production alias `mqr-mahindra.vercel.app` returns
  `DEPLOYMENT_NOT_FOUND` — a Vercel domain-assignment issue, not an
  application bug. Needs a look at the Vercel dashboard.
  **Amendment (2026-07-16, added after this release, not rewriting the
  above):** this was never actually a domain-assignment problem —
  `mqr-mahindra.vercel.app` was simply never the real production alias.
  The real one is `https://masp-mseal.vercel.app`, live-verified working.
  See `docs/ROADMAP.md`'s Known Issues for the corrected entry.
- Collaboration Layer (Comments, Internal/Customer Notes, @mentions,
  Pinned Events) deferred — tracked in issue #30, pending its own schema/
  RBAC/API review.
- Activity Timeline's Photo History isn't paired 1:1 by category — the
  audit log doesn't record which category a *removed* photo belonged to,
  so a multi-photo edit shows two thumbnail groups (removed/added) rather
  than exact before/after pairs.
- No true virtualization in the Activity Timeline — "Load more" (50 at a
  time) only, until real data volume justifies the added dependency.
- PM's model-derivation fallback remains in place until the Tractor IN
  sheet's Product Family/Sub Model columns are added and
  `vehicles.product_family_id` is 100% populated (tracked as a Next
  Milestone, blocked on external sheet-owner action).
