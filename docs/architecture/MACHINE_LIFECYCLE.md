# Machine Lifecycle

v1.0. Defines the nine lifecycle stages the Machine Digital Passport's
Lifecycle section (`MachineLifecyclePanel`) shows, and exactly what signal
each one is derived from - written so a future reader never has to
reverse-engineer the badge logic from the component source.

**Not the same document as `docs/business/MACHINE_LIFECYCLE.md`**
(same filename, different directory, different purpose, added later,
ADR-037) - that document is a business-level state machine (Factory →
Imported → ... → Retired) with transition triggers/roles/validation
rules, independent of any one screen; this document is what one
specific UI panel renders. Cross-referenced both ways so the name
collision doesn't read as an accidental duplicate.

## The nine stages

| Stage | Reached when | Signal |
|---|---|---|
| Imported | Always | The machine has a `MachineSummary` at all (it's in the `vehicles` table, synced from the Tractor-IN sheet) |
| Registered | `retailDate` is set | `MachineSummary.retailDate != null` |
| Delivered | `retailDate` is set | `MachineSummary.retailDate != null` (**same signal as Registered** - see below) |
| Warranty | `retailDate` is set | `MachineSummary.retailDate != null` (warranty coverage starts at delivery) |
| PM | At least one PM visit on file | `MachineSummary.lastMaintenanceDate != null` |
| Quality | At least one open MQR job | `MachineSummary.openMqrCount > 0` |
| PIP | Never (no data source) | Always renders "Coming Soon" |
| Recall | Never (no data source) | Always renders "Coming Soon" |
| Retired | Lifecycle status is Scrapped/Inactive | `MachineSummary.lifecycleStatus === 'Scrapped' \| 'Inactive'` |

## Why Registered and Delivered share one signal

There is exactly one NTR-driven lifecycle transition in the whole schema
today: `NtrSummaryProvider` sets `lifecycleStatus = 'Delivered'` (and,
transitively, `retailDate`) when an NTR record exists for the machine.
There is no second, independent "Registered" event anywhere - no vehicle
registration table, no separate registration-date column, no
government/RTA registration integration. Showing Registered and Delivered
as two independently-reached stages would imply a distinction the data
doesn't actually make. This is called out here, explicitly, rather than
silently treating them as the same thing in the UI with no explanation -
a future Vehicle Registration module (already named in
`docs/architecture/ACTIVITY_TIMELINE.md`'s list of planned adopters) is
the natural place to give Registered its own real signal.

## Why PM and Quality use summary-level signals, not full record counts

`MachineSummary.lastMaintenanceDate`/`openMqrCount` are already computed
by the existing Vehicle 360 aggregation (`getVehicleSummary()`) - using
them keeps the Lifecycle section on the page's fast, blocking "core" fetch
(see `MACHINE_PASSPORT_ARCHITECTURE.md`'s lazy-loading section) instead of
depending on the PM History/Quality Case queries, which are deliberately
deferred behind their own `<Suspense>` boundaries elsewhere on the page.
This is a coarser signal than "how many PM visits/quality cases exist" -
sufficient for a reached/not-reached badge, not sufficient for a count
(the PM and Quality sections below show the real counts).

## Why PIP and Recall are permanently Coming Soon in v1.0

Both are Engineering Intelligence deliverables (`navConfig.ts`'s
`engineering-intelligence` group, itself Coming Soon end-to-end) with no
underlying table, service, or event type anywhere in this codebase. There
is no PIP/Recall data to derive a stage from - not a query that returns
zero rows, but a query that doesn't exist. Marking these reached would be
fabrication; the Coming Soon treatment matches the same tone the nav
itself already uses for these two capabilities.

## Milestone timeline vs. lifecycle stages

The stage badges above are a *summary*; the milestone timeline rendered
directly below them (reused verbatim from `MachineService.
getMachineTimeline()`) is the actual event-by-event record a stage's
"reached" state is drawn from. A reader who wants to know exactly *when*
Delivered was reached, not just whether it was, scrolls to the timeline
beneath the badges.

## Future work (explicitly out of scope for v1.0)

- A real Registered signal, once a Vehicle Registration module exists.
- Retired as an explicit lifecycle action (today it only reflects
  `lifecycleStatus`, which no UI currently sets to Scrapped/Inactive - the
  values exist in the type system per ADR-009/`vehicle/types.ts` but have
  no writer yet).
- PIP/Recall stages, once Engineering Intelligence ships a real data
  source for either.
