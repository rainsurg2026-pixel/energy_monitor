# Machine Digital Passport — Screen Contract

v1.2 (refined across two pre-merge PR #39 reviews - v1.1 added rows 5, 9,
13; v1.2 added rows 1, 14 and split row 9's data shape into Open/History;
every other row unchanged from v1.0). Companion to
`docs/architecture/MACHINE_PASSPORT_ARCHITECTURE.md` (the "how"); this
document is the "what's on screen," for anyone building a caller, a test,
or a future section without re-reading the page source.

## Routes

| Route | Purpose | Component |
|---|---|---|
| `/machines` | Search/landing page - required Model selector (distinct `vehicles.model` values) gates a single search field matching Serial Number/Engine Number/Product Code, reuses `VehicleSearchBox` (`basePath="/machines"`) | `src/app/(app)/machines/page.tsx` |
| `/machines/[machineId]` | The Passport itself. `machineId` is the machine's **Serial Number**, URL-encoded - same identifier `/vehicles/[serial]` uses, not the `vehicles.id` UUID | `src/app/(app)/machines/[machineId]/page.tsx` |

Both routes require an authenticated session (`getSession()`; `null` →
`return null`, matching every other `(app)` page's convention - the
`(app)` route group's own layout/middleware is the actual auth gate).

## Not-found behavior

When `MachineService.getMachine360(machineId, session)` returns `null`
(machine doesn't exist, or exists but is outside the caller's dealer
scope - **not distinguished**, to avoid leaking existence across dealers),
the page renders a header plus a yellow notice block with three lines
(`machinePassport.notFoundTitle`/`notFoundReason`/`notFoundNextStep`) and a
"Search again" link back to `/machines`. No section below renders (the
Next Recommended Action panel is also skipped in this state).

## Sections (in page order)

| # | Section | Component | Data source | Loading |
|---|---|---|---|---|
| 1 | Next Recommended Action | `MachineNextActionPanel` | none (placeholder) | Synchronous |
| 2 | Identity | `MachineIdentityPanel` | `MachineSummary` + raw `vehicles.sub_model` | Blocking (core fetch) |
| 3 | Lifecycle | `MachineLifecyclePanel` | `MachineSummary` + `MachineService.getMachineTimeline()` | Blocking (core fetch) |
| 4 | Ownership | `MachineOwnershipPanel` | `MachineSummary` | Blocking (core fetch) |
| 5 | Machine Health | `MachineHealthPanel` | `MachineSummary.healthScore`/`healthStatus` | Blocking (core fetch, zero new query) |
| 6 | Warranty | `MachineWarrantyPanel` via `MachineWarrantySection` | `MachineService.getMachineWarrantySummary()` | `<Suspense>` + `Skeleton` |
| 7 | Preventive Maintenance | `MachinePmPanel` via `MachinePmSection` | `MachineSummary` (passed in) + `fetchMaintenanceHistoryForSerial()` | `<Suspense>` + `Skeleton` |
| 8 | Quality | `MachineQualityPanel` via `MachineQualitySection` | `MachineService.getMachineQualitySummary()` | `<Suspense>` + `Skeleton` |
| 9 | Related Records (Open/History) | `MachineRelatedRecordsPanel` via `MachineRelatedRecordsSection` | `MachineService.getMachineRelatedRecords()` | `<Suspense>` + `Skeleton` |
| 10 | Documents | `MachineDocumentsPanel` via `MachineDocumentsSection` | `MachineService.getMachineAttachments()` + `AttachmentService.getUrl()` | `<Suspense>` + `Skeleton` |
| 11 | Activity Timeline | `MachineActivityPanel` via `MachineActivitySection` | `MachineService.getMachineAuditTimeline()` | `<Suspense>` + `Skeleton` |
| 12 | Knowledge Integration | `MachineKnowledgePanel` | none (placeholder) | Synchronous |
| 13 | Reserved AI panels | `MachineAiInsightsPanel` | none (placeholder) | Synchronous |
| 14 | Machine Completeness | `MachineCompletenessPanel` | none (placeholder) | Synchronous |
| 15 | Future IoT | `MachineIotPanel` | none (placeholder) | Synchronous |

Every panel is a `<Card variant="compact" as="section" id="...">` with a
stable `id` (`next-action`/`identity`/`lifecycle`/`ownership`/`health`/
`warranty`/`pm`/`quality`/`related-records`/`documents`/`activity`/
`knowledge`/`ai-insights`/`completeness`/`iot`) - a future in-page "Quick
Navigation" jump menu (matching the Activity Timeline's own
`navigationTarget` concept) can anchor to these without renaming anything.

## Section contracts

### 1. Next Recommended Action (v1.2)

One `EmptyState` tile (`MachineNextActionPanel`), positioned first on the
page (right after the header) - documented as the future AI entry point
("what should I do about this machine right now"). No backend, no model,
no recommendation logic of any kind exists. Distinct from Reserved AI
panels (§13) - see `MACHINE_PASSPORT_ARCHITECTURE.md`'s v1.2 refinement
section for the placement rationale.

### 2. Identity

Fields: Serial Number, Engine Number, Model, Variant, Product Family,
Manufacturing Year, Manufacturing Country. Manufacturing Country is always
rendered as "not tracked yet" (`machinePassport.notTrackedYet`) - no
column exists anywhere. Variant reads `vehicles.sub_model` (the closest
always-populated analog); Manufacturing Year always renders "not tracked
yet" too - **not** because no column exists (it does, on `NtrRecord`, see
below) but because that column is sparse and registration-date-dependent,
not a reliable Identity source yet. See `MACHINE_DATA_OWNERSHIP.md`'s
"Documentation correction" section for the full Current/Future Source of
Truth account (v1.2 drift-resolution - no data model change).

### 3. Lifecycle

Nine stage badges (Imported/Registered/Delivered/Warranty/PM/Quality/PIP/
Recall/Retired) plus the reused milestone timeline. See
`MACHINE_LIFECYCLE.md` for exactly how each stage's reached/not-reached
state is derived. PIP and Recall always render as Coming Soon (gray pill,
"(Coming Soon)" suffix) - no data source exists for either yet.

**v1.1 Timeline filtering**: the milestone timeline is wrapped in
`MachineTimelineFilterBar` - five filter buttons (All/NTR/PM/MQR/Other,
`machinePassport.timelineFilter*`) that show/hide rows client-side via a
`data-category` DOM attribute (`TimelineItem`'s new optional
`dataCategory` prop). The rows themselves are unchanged - same
`MachineTimelineRow`, same data, same "no events" empty copy. Not a
placeholder - a real, working filter over already-fetched data.

### 4. Ownership

Current Owner, Owner Phone, Dealer, Branch (all from `MachineSummary`,
derived read-time from the latest MQR/PM/NTR record on file - there is no
`customer_id` FK anywhere). Region and Owner History always render "not
available" - no column/table exists for either (see
`MACHINE_DATA_OWNERSHIP.md`).

### 5. Machine Health (v1.1)

One `HealthCard` tile, label "Machine Health", fed by
`MachineSummary.healthScore`/`healthStatus` - the exact same signal
Vehicle 360's own Health section already computes and displays, reused
here rather than recomputed. `healthStatus`'s vocabulary
(excellent/good/attention/critical) is mapped onto `HealthCard`'s fixed
vocabulary (healthy/degraded/down/unknown): excellent/good → healthy,
attention → degraded, critical → down. A footer note
(`machinePassport.healthFutureNote`) states plainly that this one
computed signal is today's whole Machine Health, and that trend history,
sensor-driven inputs, and predictive scoring are a **future capability**
this section is reserved to grow into - see
`docs/architecture/MACHINE_PASSPORT_ARCHITECTURE.md`'s v1.1 refinement
table.

### 6. Warranty

Overall Status/Age/Remaining/Coverage Limit (from `calcWarranty()`,
`'powertrain'` coverage, computed off `MachineSummary.retailDate`) plus a
Warranty Claims list (every MQR record on file that has a non-null
`warranty_status`, i.e. every record the reporting technician actually
recorded a warranty determination for - MQR records without one are
excluded, not guessed at).

### 7. Preventive Maintenance

Completed count (`pmRecords.length`), Upcoming (`MachineSummary.
nextMaintenanceLabel`), Overdue (`MachineSummary.maintenanceDueColor ===
'red'`), Compliance (`MachineSummary.compliancePercent` etc.) plus a PM
History list (every `MaintenanceRecord` for this serial).

### 8. Quality

Open/Closed/Critical KPI cards (via the shared `OPEN_STATUSES` constant -
the same "what counts as open" rule Platform Overview's own quality KPI
uses) plus a case list (every MQR record for this serial, most-severe-first
is **not** applied - list order matches the underlying query's order).

### 9. Related Records (v1.1, split into Open/History in v1.2)

Every MQR/PM/NTR record already known to belong to this machine, each row
a link to that record's own detail page (`/records/[jobId]`,
`/pm-records/[id]`, `/ntr/[id]`), tagged with its module (reusing the
existing `common.mqr`/`common.pm`/`nav.ntrRecords` labels - no new
module-name strings). Backed by `MachineService.getMachineRelatedRecords()`,
which reuses the exact three scoped reads Warranty/PM/Quality/Activity
already call (no new query, no new table).

**v1.2 Open/History split**: each record carries a `bucket: 'open' |
'history'` field and renders under two separate `<h3>`-headed lists.
MQR's bucket reuses the shared `OPEN_STATUSES` constant (same rule §8's
KPI cards use). PM and NTR records always bucket as `'history'` - a
`pm_records` row only exists once a visit has actually been performed
(there is no "scheduled, not yet done" PM record in this schema), and
every NTR write path sets `status: 'Completed'` at creation - neither
module has a genuine open workflow state to bucket against. See
`docs/architecture/MACHINE_DATA_OWNERSHIP.md`.

### 10. Documents

Every attachment across this machine's own MQR/PM/NTR records (via
`AttachmentService`, ADR-010 - never a storage provider directly), split
client-side into "Photos" (`image/*` MIME types) and "Registration /
Invoices / Warranty / Attachments" (everything else) - `AttachmentService`
does not tag attachments by document category yet, so this is a MIME-type
heuristic, not a real category field (see `MACHINE_DATA_OWNERSHIP.md`).

### 11. Activity Timeline

The platform-standard `<ActivityTimeline>` (filters, search, Load More,
the disabled "Future AI Support" button - all reused as-is, no
Machine-specific fork of the component), fed by
`getMachineAuditTimeline()`. Renders the same "no events"/"no matching
events" empty copy every other `<ActivityTimeline>` consumer does.

### 12. Knowledge Integration

Six `EmptyState` tiles in `comingSoon` tone: Knowledge Cases, Known
Problems, Troubleshooting, AI Recommendation, Prediction, and (v1.1)
Knowledge Score - a reserved single-metric tile for how well-documented/
understood a machine's known issues are; no scoring logic exists anywhere
yet. No AI is implemented - this is an explicit instruction, not an
oversight.

### 13. Reserved AI panels (v1.1)

Three `EmptyState` tiles in `comingSoon` tone: AI Diagnostic Assistant,
Predictive Failure Alert, Automated Root Cause Suggestion
(`MachineAiInsightsPanel`). Deliberately a separate section from Knowledge
Integration (§12) - Knowledge Integration is human/process knowledge
(cases, known problems, troubleshooting write-ups); this section is
reserved for the "Machine Intelligence" phase of `docs/ROADMAP.md`'s Next
Development Phase priority order (Workflow Engine → Service Management →
Customer Experience → **Machine Intelligence** → Predictive Maintenance).
No model, no inference endpoint, no scoring logic exists anywhere yet -
this is a future capability, not an oversight. Also distinct from Next
Recommended Action (§1) - that panel is the single prominent entry point;
this section is the broader capability set behind it.

### 14. Machine Completeness (v1.2)

Seven `StatusPill` badges (same reserved-gray tone as Lifecycle's PIP/
Recall badges), one per Passport data dimension - Identity, Ownership,
Warranty, Preventive Maintenance, Quality, Documents, Knowledge - plus one
`EmptyState` explaining the section. Documented explicitly as a **future**
Data Quality indicator: no weighting/scoring algorithm exists across these
seven dimensions today, so none of them is scored - the badges name the
dimensions without fabricating a completeness percentage for any of them.

### 15. Future IoT

Four `EmptyState` tiles in `comingSoon` tone: Running Hours, Fuel, GPS,
Engine Health. "Reserved" - no telemetry integration exists anywhere in
this codebase.

## i18n

Every label routes through `t()` (server-side `lib/i18n/server`) or, for
`MachineTimelineFilterBar` (the one client-interactive addition, v1.1),
`useTranslation()` (client-side `lib/i18n/LocaleProvider`, the same hook
`<ActivityTimeline>`/`VehicleSearchBox` already use) - reusing existing
keys where one already fit (`common.serial`, `common.model`,
`common.owner`, `common.compliance`, `common.mqr`, `common.pm`,
`nav.ntrRecords`, `pdf.customerPhone`, `unit.hours`, `nav.comingSoon`, ...)
and adding to the `machinePassport.*` namespace (both `en.json`/`th.json`)
for everything Passport-specific. No hardcoded UI string was added outside
of the pre-existing `'N/A'` convention already used throughout Vehicle
360/PM/MQR detail pages.

## Cross-link from Vehicle 360

`/vehicles/[serial]` gained one addition: a "View Machine Digital
Passport →" link (`machine360.viewPassportLink`) at the bottom of the
page, pointing at `/machines/${serial}`. Nothing else on that page changed
except the `TimelineRow` extraction into the shared `MachineTimelineRow`
component (see `MACHINE_PASSPORT_ARCHITECTURE.md`).
