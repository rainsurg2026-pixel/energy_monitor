# Activity Timeline — Platform Standard

The reusable event-history component every module renders its activity
timeline through. Shipped first for MQR's Quality Report Detail page
(replacing its old "Audit Trail" section); designed once so PM, NTR,
Warranty, ORC, Parts, Campaign, Delivery, Vehicle Registration, and Owner
Transfer can plug in later without a redesign — the explicit goal behind
this work, since it's also the foundation Vehicle 360 will aggregate
across modules from.

## Architecture summary

```
record_audit_log (existing, module-agnostic: module ∈ {mqr, pm, ntr})
        ↓  listAuditLog(module, recordId)  [unchanged, existing]
AuditLogEntry[]
        ↓  mapAuditLogToActivityEvents(entries, context)  [new - the only new "data layer"]
ActivityEvent[]  (generic, future-proofed)
        ↓
<ActivityTimeline events={...} entityLabel="Report" onNavigate={...} />
```

No new storage. No duplicated history. `mapAuditLogToActivityEvents()` is
a pure function — it reads `AuditLogEntry[]` (the existing, already
module-agnostic `record_audit_log` shape) and reshapes it into the
generic `ActivityEvent[]` the timeline component actually renders. A
future module (PM, Warranty, ...) needs only to write its own thin adapter
call — same function, different `context` — to get the exact same UI.

`<ActivityTimeline>` itself (`src/components/shared/activity-timeline/`)
has no idea what MQR, PM, or a "Quality Report" is. It only knows the
generic `ActivityEvent` shape and an `entityLabel` string ("Report" today)
for its Created/Edited/Deleted action-label templates.

## Event model

```ts
interface ActivityEvent {
  eventId: string;
  eventType: ActivityEventType;      // see below
  entityType: AuditModule;           // reuses the existing 'mqr' | 'pm' | 'ntr' union - no new naming scheme
  entityId: string;
  entityRef: string;                 // human-readable ref (job_id/pm_number) - display only
  vehicleSerial: string | null;
  user: { username: string; fullName?: string | null };
  timestamp: string;                 // ISO
  summary: string;                   // "4 fields changed" / "Open → Investigating"
  changes: ActivityFieldChange[] | null;
  photoChanges: ActivityPhotoChange[] | null;
  metadata: Record<string, unknown>; // forward-compatible bag - e.g. a future cached AI summary
  pinned: boolean;                   // always false today - see "Not implemented" below
  relatedObjects?: ActivityRelatedObjects;   // Vehicle/Customer/Dealer/Technician/Report/PM/ORC/Warranty refs
  navigationTarget?: 'status' | 'photos' | 'warranty' | 'rca' | null;
}
```

`ActivityEventType` includes every type the *audit log* already produces
(`Created`, `FieldChanged`, `StatusChanged`, `SeverityChanged`,
`RcaUpdated`, `AttachmentAdded`, `AttachmentRemoved`, `AssignmentChanged`,
`Locked`, `Unlocked`, `Deleted`, `SystemEvent`) **plus** three reserved
types the timeline already knows how to render but this PR never
produces: `CommentAdded`, `NoteAdded`, `Pinned` — see "Collaboration
Layer" below.

Full type definitions: `src/components/shared/activity-timeline/types.ts`.

## Grouping ("Report Edited: 4 fields changed")

One `updateRecord()`/`createRecord()` call writes every one of its audit
rows with the identical `new Date().toISOString()` value (computed once
per request, before any DB write). `mapAuditLogToActivityEvents()` groups
by that exact timestamp string — a reliable, zero-schema-change way to
reassemble "everything one save actually changed" into a single
`ActivityEvent`, matching the design's collapsed/expanded examples
exactly. A save that both edits fields **and** replaces a photo produces
one event carrying both `changes` and `photoChanges`.

## API design

No new API route. The existing `GET /api/records/[jobId]` page already
calls `listAuditLog('mqr', record.id)` server-side (unchanged); the new
adapter runs in the same Server Component, and the resulting
`ActivityEvent[]` is passed as a prop into the client `<ActivityTimeline>`.
Filtering and search are client-side (the per-record event count is small
and already fully loaded — no pagination round-trip needed).

If a future module's activity volume ever outgrows "fetch everything, filter
client-side" (Vehicle 360 aggregating hundreds of events across many
modules is the likely first case), the generic shape this document
describes is exactly what a future paginated
`GET /api/activity?entityType=...&entityId=...` route would return — no
redesign, just a new source feeding the same `ActivityEvent[]` prop.

## UI (Phase 1, MQR)

- Icon + action + user + date/time + summary, newest first (`listAuditLog`
  already orders `performed_at desc`; pinned events — always empty today —
  sort to the top ahead of that).
- Expand/collapse per event (only rendered when there's something to show).
- Diff Viewer (`DiffViewer.tsx`): old → new per changed field, wrapping
  long text (`break-words`), red/green highlight.
- Photo History (`PhotoDiff.tsx`): removed/added thumbnail groups.
  **Known limitation**: not paired 1:1 by category — the audit log
  doesn't record which specific photo category a *removed* photo
  belonged to (`AttachmentRemoved` rows have no `fieldName`), so an edit
  replacing more than one photo shows two groups ("Removed" / "Added"),
  not "this exact old photo became this exact new one." Not a bug in this
  PR — a pre-existing gap in what the audit log captures; closing it
  would mean changing what `updateRecord()` writes, out of scope here.
- Filters: All / Edits / Status / Photos / Comments / Assignments /
  Pinned — client-side (`activityLabels.ts`'s `matchesFilter`).
- Search: client-side keyword match across summary/user/changed field
  values (`matchesSearch`).
- Quick Navigation: clicking an event's `→` scrolls to its related
  section. The component only emits a generic `navigationTarget` key via
  `onNavigate` — it never touches the DOM directly or knows a page's
  actual element ids. The page-specific mapping lives in
  `records/[jobId]/activity-timeline-section.tsx`.
- Pagination: "Load more" after 50 events (plain array slice) - see
  "Performance" below.
- "✨ Summarize Timeline" (Future AI Support): rendered as a disabled,
  clearly-labeled placeholder. Architecture-compatible (`metadata` is
  exactly where a cached AI summary would live), not implemented.

## Performance

No virtualization dependency added (`.claude/rules/02-coding-standards.md`'s
"no new dependency casually"). A single record's timeline realistically
has well under 50 events; "Load more" (plain `.slice(0, visibleCount)`)
covers today's real scale. If/when Vehicle 360 aggregates enough events
across modules that this stops being true, the swap is contained: replace
`ActivityTimeline`'s `.slice()` + "Load more" button with a virtualized
list over the same already-filtered `ActivityEvent[]` — no prop or event
model change needed.

## Not implemented this PR (Collaboration Layer follow-up)

Comments, Internal Notes, Customer-Visible Notes (reserved), @mentions,
and Pinned Events all need genuinely new persistent storage —
`record_audit_log` is immutable by design (no UPDATE/DELETE RLS policy)
and has no concept of free-text comment bodies or a pin flag. Confirmed
with the user before implementation: this PR ships the timeline
foundation only; a dedicated "v2.4.x — Collaboration Layer" PR (its own
schema/RBAC/API review) will add:

- A new table (e.g. `activity_notes`: `entity_type`, `entity_id`,
  `note_type` ['comment'|'internal_note'|'customer_note'-reserved],
  `body`, `mentioned_usernames` jsonb, `pinned`, `pinned_by`, `pinned_at`,
  `created_by`/`created_at`).
- The `CommentAdded`/`NoteAdded`/`Pinned` event types this timeline
  already renders correctly (icon, filter, action label) — that PR only
  needs to *produce* events of these types, matching the shape in
  `types.ts`, to have them show up here with zero UI changes.
- Real pinning (today `pinned` is always `false` — the flag and its
  top-of-list sort already exist in `ActivityTimeline.tsx`, just nothing
  ever sets it to `true`).

Tracked as GitHub issue (see the PR description for the link).

## Modified/created files

- `src/components/shared/activity-timeline/` (new) — `types.ts`,
  `mapAuditLogToActivityEvents.ts`, `activityLabels.ts`,
  `ActivityTimeline.tsx`, `ActivityEventRow.tsx`, `DiffViewer.tsx`,
  `PhotoDiff.tsx`, `__tests__/*.test.ts`.
- `src/app/(app)/records/[jobId]/page.tsx` — replaced the old Audit Trail
  `Timeline`/`TimelineItem` section with `<RecordActivityTimelineSection>`;
  added `id="status-section"`/`id="rca-section"`/`id="photos-section"`/
  `id="warranty-section"` anchors for Quick Navigation.
- `src/app/(app)/records/[jobId]/activity-timeline-section.tsx` (new) —
  the page-specific client wrapper mapping `navigationTarget` → real DOM ids.
- `src/components/shared/layout/Card.tsx` — added an optional `id` prop
  (additive, no existing caller affected) so a `<Card>` can be a Quick
  Navigation anchor.
- `src/locales/en.json`, `src/locales/th.json` — new `activityTimeline.*`
  namespace; removed the now-orphaned `nav.newReport`-adjacent
  `common.auditTrail`, `recordDetail.noAuditHistory`, and the entire
  `auditEvent.*` namespace (confirmed zero remaining references anywhere
  in the codebase after the old Timeline/TimelineItem usage was removed).

## Remaining technical debt

1. Photo History isn't paired 1:1 by category (see "UI" above) — the
   audit log doesn't capture enough detail to do this precisely without
   changing what `updateRecord()` writes.
2. Comments/Notes/@mentions/Pinning — deferred to the Collaboration Layer
   follow-up (tracked issue).
3. No true virtualization — deferred until real production data shows
   pagination isn't enough (see "Performance").
4. Only MQR wired up so far — PM/NTR/others each need their own thin
   `mapAuditLogToActivityEvents()` call site + `entityLabel` +
   `closingStatusValues` (if applicable) + section-anchor wiring on their
   own detail pages. The shared component itself needs no changes to
   support them.
