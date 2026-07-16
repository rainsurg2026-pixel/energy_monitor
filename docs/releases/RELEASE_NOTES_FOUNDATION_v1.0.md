# Release Notes — Foundation v1.0

Four PRs, merged in dependency order to `main` on 2026-07-12, completing
the MSEAL DMS Foundation. See `docs/releases/FOUNDATION_FREEZE_v1.0.md`
for what's now frozen and the process to reopen any of it.

## Architecture

- **Architecture Blueprint v1.1** (pre-existing, unchanged this release) —
  Machine as the platform's aggregate root, the bounded context list, the
  `PlatformEvent` envelope, Engineering Intelligence's AI Governance
  boundary, and the Integration Boundary rule remain the frozen
  Architecture Baseline.
- **ADR numbering normalized** — a real duplicate ADR number was found and
  fixed: `ADR-009` had been independently reused by both
  `Universal-Import-Framework` (2026-07-03) and `Machine-Domain`
  (2026-07-04, frozen, ~25 cross-references in the Blueprint). Resolved by
  renumbering the Import Framework ADR to `ADR-024`, leaving Machine
  Domain's frozen content untouched. `docs/adr/README.md` is now the
  canonical ADR Index — one ADR, one number, one topic, going forward.
- **Canonical Event Catalog consolidated** (ADR-025) — `18-CANONICAL-EVENT-CATALOG.md`
  (frozen, name + ownership) and `docs/standards/EVENT_CATALOG.md`
  (event_code + display metadata) reclassified as two layers of the same
  facts, with explicit cross-references in both directions.

## Governance

- **Platform Governance Framework v1.1** — `docs/governance/` established
  as the canonical home for Documentation Policy, Documentation Hierarchy,
  Domain/Data Ownership Matrices, Capability Map/Dependency Map, Module
  Maturity Matrix, Change Management, Security Boundary, API Governance,
  AI Governance, and Repository Policy/Structure Map.
- **Skill Governance** — `docs/governance/SKILL_GOVERNANCE.md` establishes
  how `.claude/skills/` content stays in sync with its `docs/` source of
  truth.

## Design

- **MSEAL Design Framework v1.0** (ADR-023) — Navigation Standard
  (Group/Item/Subgroup taxonomy, Coming Soon convention), Dashboard
  Standard (Platform Overview vs. domain dashboards, decision-center
  philosophy), and the Screen Contract template every new screen now
  documents against.
- **Platform Overview** — `/dashboard` is now a small set of real,
  role-aware KPIs (Registered Machines, Open Quality Cases, Pending
  Imports, System Health, Today's Activities) plus Quick Actions, split
  out from MQR's own analytics (moved unchanged to `/quality/dashboard`).
- New shared components: `HealthCard`, `KpiCard` (extended), `ChartCard`,
  `NotificationCard`, `ProgressCard`, `QuickActionCard`, `EmptyState`,
  `ErrorState`, `Skeleton`, `GlobalSearchButton` — several ship ahead of a
  second real consumer, the same "build the reusable primitive first"
  precedent already established for the Import Framework (ADR-009/024).

## Authentication Platform

Unchanged this release — v3.0 (session management, password reset,
invitations, account lockout, CSRF, `auth_audit_log`) remains frozen per
ADR-014, carried forward from the prior release.

## Import Platform Foundation

- **Import Platform v2** (ADR-022) — four new, module-agnostic shared
  services added to the existing Universal Import Framework (ADR-024):
  Thailand Address Resolver, Master Data Resolver, Transformation
  Library, and Duplicate Detector (`InFileDuplicateTracker`). NTR Legacy
  Import migrated onto all four as the first adopting example; its own
  42-test suite passes unmodified.
- **Import Completion Notification** — `sendImportCompletionEmail()`,
  wired into the commit route; the one genuinely new user-facing
  capability this pass added (per-row Timeline/Audit already existed).
- **Security fix**: a stored-HTML-injection vulnerability in the import
  completion email (the uploader's own client-supplied filename was
  interpolated into the email HTML unescaped) was found during this PR's
  independent security review, fixed with a shared `escapeHtml()` utility
  applied everywhere the same file builds HTML (including one other
  pre-existing unescaped field, `sendInvitationEmail`'s `fullName`), and
  covered by 8 new regression tests. Confirmed resolved before merge.
- **New**: Admin Import History page (`/admin/import-history`), separate
  from the Legacy Import wizard's own latest-3 summary.

## Machine Domain v1.0

- **Machine Digital Passport** (ADR-026) — `/machines` and
  `/machines/[machineId]`, aggregating Identity, Ownership, Lifecycle
  Timeline, Warranty, PM History, Quality Cases, Documents, Activity, and
  Related Records for one machine in one place, reusing existing widgets
  (Card, HealthCard, KpiCard, EmptyState, Timeline/TimelineItem) with no
  new database tables and no authorization changes.
- **Documented placeholders, not fabricated data**: Machine Health,
  Knowledge Score, Machine Completeness, Next Recommended Action, and the
  Reserved AI panels (Diagnostic Assistant, Predictive Failure Alert,
  Root Cause Suggestion) all render as named, explained "Coming Soon"
  states — each documents what's missing and where it's planned
  (`docs/architecture/MACHINE_PASSPORT_ARCHITECTURE.md`'s Gap Analysis),
  never a silent zero or invented number.
- **Documentation drift corrected**: NTR's `variant`/`manufacturing_year`
  fields were previously (incorrectly) documented as not existing
  anywhere in the data model. `docs/architecture/MACHINE_DATA_OWNERSHIP.md`
  now documents the Current Source of Truth (sparse, NTR-entered) versus
  the Future Source of Truth (Tractor IN sync, once populated) — no data
  model or UI behavior changed, documentation only.

## Security Improvements

- Stored-HTML-injection fix in `src/lib/email.ts` (see Import Platform
  Foundation above) — the release's one confirmed, fixed vulnerability.
  Independent `/security-review` re-run after the fix found zero
  surviving findings.
- Independent multi-agent code review (8 finder angles + verify) run
  against all four PRs before merge, since every PR was solely
  agent-authored with no separate human review. Findings that were
  CONFIRMED/PLAUSIBLE and cheap/safe to fix were fixed pre-merge (see
  each PR's own commit history); the rest are carried forward below.

## Known Technical Debt (carried forward, not fixed this release)

Scope-limited per this release's own instruction — this is not a general
audit of every review finding from every PR, only what's genuinely worth
tracking:

- ~~**`docs/release/` vs. `docs/releases/` duplication**~~ **Resolved**
  (Documentation Cleanup for Production Pilot, 2026-07-15) — the stray
  singular `docs/release/` directory (`STORAGE_PLATFORM_RELEASE.md`
  alone) was moved into the canonical plural `docs/releases/`, and its
  four inbound references updated. `docs/release/` no longer exists.
- **Sparse Manufacturing Year / Variant data ownership** — see Machine
  Domain v1.0 above; the *documentation* is now correct, but the
  underlying data itself remains sparse until Tractor IN sync populates
  it (tracked as a Next Milestone, blocked on external sheet-owner
  action, same as the pre-existing Product Family/Sub Model gap).
- **Remaining planned capabilities** — every placeholder panel named
  above (Machine Health scoring, Knowledge Score, Next Recommended
  Action, Reserved AI panels) is real, scoped future work, not filler;
  see `docs/ROADMAP.md`'s "Recommended next implementation order" for
  sequencing.
- **Machine Timeline audit cap** — `listAuditLogForRecords()`'s 300-row
  cap is now correctly global-across-modules (fixed pre-merge during
  PR #39's review — see its commit history), but the cap itself, and the
  same defensive cap on `fetchMaintenanceHistoryForSerial`/
  `fetchNtrRecordsForSerial`'s hardcoded `pageSize: 200`, remain a latent
  truncation risk for a machine with an unusually long service history.
  Low likelihood given typical PM/NTR volume per machine; not fixed this
  release to avoid touching a shared utility used elsewhere.
- **Machine Passport panel duplication** — four of the Passport's new
  list panels (Warranty, PM History, Quality Cases, Related Records)
  hand-roll their own row markup instead of the shared `Timeline`/
  `TimelineItem` components, even though a fifth panel (Lifecycle) in the
  same PR demonstrates they fit. Confirmed during review as a small,
  mechanical follow-up (a few hours of prop remapping, no redesign), not
  done here to avoid non-essential refactoring during the freeze.
- **`listAuditLogForRecords()` has no defense-in-depth scoping** — it
  trusts that the record refs handed to it by its three callers are
  already dealer/branch-scoped (verified correct today), since
  `record_audit_log` itself has no dealer/branch column to scope by. Not
  currently exploitable (traced end-to-end during review), but a future
  regression in any one of the three upstream fetches would have nothing
  to catch it. Matches an existing, already-accepted pattern
  (`listTodaysAuditLog()` has the same shape) rather than a new gap
  introduced by this release.
- **Repeated per-serial data fetches on the Machine Passport page** — the
  Warranty/Quality/Related Records/Activity sections each independently
  re-fetch the same MQR/PM/NTR records for a given serial (up to 4-5x per
  page load), and Documents aggregation issues one attachment lookup per
  record (N+1). Efficiency, not correctness; not fixed this release.

## Deferred Items

Explicitly named, not silently dropped — each is real, scoped future
work:

- Knowledge Engine v1.0 (recommended next epic — see below).
- Engineering Intelligence, PIP, Predictive Quality, Dealer Portal,
  Customer Portal, IoT — the chain of epics after Knowledge Engine
  (`docs/ROADMAP.md`'s "Recommended next implementation order").
- Universal Search (`docs/architecture/blueprint`'s Search section) —
  `GlobalSearchButton` ships as a disabled placeholder this release.
- Multiple new shared components (`NotificationCard`, `ProgressCard`,
  `ErrorState`) ship with zero current consumers, built ahead of the
  first real one — matches the existing "build ahead of a second
  consumer" precedent, not a defect.

## Recommendation

**FOUNDATION COMPLETE.** All four PRs merged, independently reviewed,
gate-verified (typecheck/lint/tests/build/architecture check), and
production-deployment-verified. Recommend proceeding to **Knowledge
Engine v1.0** as the next epic, per `docs/ROADMAP.md`'s recommended
implementation order — not started as part of this release, per this
freeze's own scope.

## Post-Freeze Addendum (2026-07-13) — UI Terminology & Navigation Cleanup + Business Terminology Governance

PR #41, merged `2026-07-13T00:14:23Z` (squash commit `8011a4d`). A
terminology/wording/navigation-only change, reviewed and explicitly
approved by the user as a deliberate, scoped reopening of the frozen
Design Framework's Navigation Standard (`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`
§2a) — not a violation of this document's freeze. No architecture
changes, no redesign, no new features, no renamed code/routes/APIs/DB
objects/types.

- **Terminology**: "Quality Cases"/"กรณีปัญหา" standardized to
  "รายงานปัญหาคุณภาพ" everywhere in the UI. "Troubleshooting (การแก้ไขปัญหา)"
  established as the one fixed term for that capability across every
  surface (see `docs/standards/TERMINOLOGY_STANDARD.md`).
- **Navigation**: Recall removed (no module/data backed it). Domain
  ownership resolved — Quality owns execution (Cases, Knowledge,
  Troubleshooting); Engineering Intelligence owns analysis only (AI
  Engineering, PIP, Predictive Quality) — each concept has exactly one
  nav entry platform-wide.
- **Machine Passport**: reserved (Coming Soon) Troubleshooting section
  added, existing layout/components only, no implementation.
- **Governance**: `docs/standards/TERMINOLOGY_STANDARD.md` extended into
  formal Business Terminology Governance — MQR, NTR, PM, PIP, AI
  Engineering, Predictive Quality, and Troubleshooting (การแก้ไขปัญหา)
  are now frozen platform vocabulary; changing any of them requires
  Architecture Review + Design Review + Documentation Review.
- **Verification**: typecheck clean, lint 0 errors (12 pre-existing
  warnings), 679/679 tests passed, build succeeded, CI `verify` checks
  green on all commits, production deployment re-confirmed healthy
  post-merge (`https://masp-mseal.vercel.app`, 307→`/login` on every
  protected route checked — Dashboard, Quality Dashboard, Machines,
  Records — 200 on `/login` itself).

## Post-Freeze Addendum (2026-07-13) — Navigation Visibility Refinement (Capability Status Model)

PR #43, merged `2026-07-13T04:46:41Z` (squash commit `3d85bfb`). A
navigation-authorization-only change, reviewed and explicitly approved
by the user as a deliberate, scoped reopening of the frozen Design
Framework's Navigation Standard (new §2c) — not a violation of this
document's freeze. No architecture changes, no redesign, no
business-domain changes; the existing RBAC/Navigation Standard/Design
Framework were reused as-is.

- **Capability Status model**: every nav leaf now carries a
  `CapabilityStatus` (`ACTIVE`/`COMING_SOON`/`PREVIEW`/`BETA`/
  `DEVELOPMENT`, `src/app/(app)/navConfig.ts`). SuperAdmin sees every
  status (the full platform roadmap); every other role sees only
  `ACTIVE` capabilities — an unfinished capability is hidden completely,
  never rendered as a disabled placeholder, for any non-SuperAdmin role.
  A group or subgroup left with zero visible items is omitted entirely.
- **Generic, not hardcoded**: one status-driven filter
  (`isCapabilityVisible`/`filterGroupsByCapability`) applies uniformly to
  every leaf in every group — no module name appears in the filtering
  logic, so a future capability (Dealer Portal, IoT, Predictive
  Maintenance, Notifications, ...) gets the same SuperAdmin-only
  treatment automatically.
- **Principles established**: Navigation Principle ("navigation
  represents platform capabilities... never the roadmap") and Capability
  Principle ("every capability has an Owner, Status, Permission, and
  Lifecycle; visibility is derived from capability state, never from
  hardcoded module names") — both now stated explicitly in
  `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` §2c and the
  `mseal-platform-design` skill's `NAVIGATION_GUIDELINES.md`.
- **Not an authorization boundary**: `docs/standards/SECURITY_STANDARD.md`
  now states explicitly that capability visibility is a UX rule, not
  authorization — server-side RBAC (`lib/scope.ts` predicates, enforced
  in every API route) remains the only security boundary; every affected
  nav leaf already had `href: null` before this change (no real route
  was newly protected or exposed by it).
- **Verification**: typecheck clean, lint 0 errors (12 pre-existing
  warnings), 689/689 tests passed (18 navConfig tests
  added/rewritten for per-role capability visibility), build succeeded,
  architecture check 5/5 PASS, CI `verify` checks green on all commits,
  production deployment re-confirmed healthy post-merge
  (`https://masp-mseal.vercel.app`, 200 on `/login`, 307→`/login` on
  every protected route checked — Dashboard, Quality Dashboard,
  Machines, Records — response fresh/uncached per `Age: 0`).

## Post-Freeze Addendum (2026-07-13) — Platform Constitution v1.0 / Platform Architecture Standards

PR #44, merged `2026-07-13T06:54:12Z` (squash commit `757ea9f`). A
governance-documentation-only change, reviewed and explicitly approved
by the user as a deliberate, scoped reopening of `docs/governance/
DOCUMENTATION_HIERARCHY.md` — not a violation of this document's freeze.
No architecture changes, no redesign, no business-domain changes; no
implementation modified.

- **New governing document**: `docs/architecture/PLATFORM_CONSTITUTION.md`
  — the platform's highest-level engineering and product principle,
  above ADRs, the Design Framework, and individual capabilities. States
  permanent Platform Vision/Mission/Values and Engineering/Business/
  Domain/Capability/Navigation/Knowledge/AI/Data/Governance Principles,
  a Platform Evolution Principle ("Capabilities evolve. The Foundation
  remains stable."), and a Constitutional Amendments process
  (Architecture Review + Governance Review + Explicit human approval,
  plus a documented Rationale/Impact Assessment/Affected Principles/
  Migration Strategy for every amendment).
- **Naming conflict found and resolved before writing anything**: this
  exact filename already held a different, implementation-level document
  (layer definitions, dependency rules, platform-service boundaries),
  cited by 50+ other files and ranked below the Blueprint/ADRs in the
  documentation hierarchy — the opposite of where a true Constitution
  belongs. Surfaced to the user explicitly (not silently resolved);
  renamed to `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`
  (content unchanged), every one of its 103 cross-references updated
  repo-wide, and the new Constitution written fresh at the freed path,
  above it in precedence.
- **New hierarchy**: `docs/governance/DOCUMENTATION_HIERARCHY.md`
  rewritten — Platform Constitution → Architecture Blueprint →
  Architecture Standards → ADR → Design Framework → Implementation —
  with Platform Governance Framework and Standards repositioned as
  cross-cutting (process/convention) rather than numbered content
  layers.
- **Verification**: typecheck clean, targeted lint clean, architecture
  check 5/5 PASS, every file path cited in the Constitution verified to
  exist (one intentional, explicitly-flagged exception pending PR #42's
  merge), CI `verify` checks green on all commits, production deployment
  re-confirmed healthy post-merge (`https://masp-mseal.vercel.app`, 200
  on `/login`, 307→`/login` on every protected route checked — Dashboard,
  Quality Dashboard, Machines, Records — response fresh/uncached per
  `Age: 0`).
- **Formalized alongside this addendum**: `docs/releases/
  FOUNDATION_FREEZE_v1.1.md` extends the Foundation Freeze with five new
  frozen layers (Platform Constitution, Platform Architecture Standards,
  Navigation Visibility Policy, Capability Status Model, Business
  Terminology Governance) — see that document for the full frozen-layer
  table.
