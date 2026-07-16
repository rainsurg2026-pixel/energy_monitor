# 10 — Machine Digital Passport & Machine Profile

## Two different things, previously conflated

The prior revision of this document described only "Machine Profile" —
a page. Reviewing it as a platform architect surfaces a real gap: a page
is a UI concern, but everything that page aggregates (Identity,
Configuration, Lifecycle, Inspection History, Owner History, Warranty,
PM, MQR, PIP, Timeline, Knowledge Score, Documents, Attachments) is a
genuine **business object** that should exist independent of any one
screen — the same data a future Dealer Portal, Customer Portal, mobile
app, or API integration (12) would need, none of which render the
"Machine Profile page" at all.

- **Machine Digital Passport** — the business object. The accumulated,
  queryable representation of everything the platform knows about one
  Machine, at any point in time.
- **Machine Profile** — the UI. The specific page a Dealer/Central
  engineer opens, and only one of potentially several ways the Passport
  gets presented (a QR-code-scannable public passport view, a Dealer
  Portal card, a mobile summary, and this page are all *renderings* of
  the same underlying Passport).

This is not a new data source and not a new table — the Passport is a
**named service-level concept** (`getMachineDigitalPassport(machineId)`,
sketched below), not a new place data lives. Every field it exposes
already has an owner named elsewhere in this blueprint (02, 03, 04, 05,
07); this document's job is to name the aggregate itself as a first-
class concept worth its own vocabulary, not to relocate any data.

## Machine Digital Passport — contents

```
Machine Digital Passport (machineId)
  ├── Identity            — serial, model, product category (Registry, 02)
  ├── Configuration        — product family/model/variant, as-built spec (02)
  ├── Lifecycle            — current stage + full stage history (03's Machine Lifecycle)
  ├── Inspection History    — every Inspection record, all types (04)
  ├── Owner History         — current + historical owner(s) (Ownership, 02)
  ├── Warranty              — current status (calcWarranty() today; a real Warranty module later, 05/14)
  ├── PM                    — maintenance history (existing MaintenanceService)
  ├── MQR                   — quality report history (existing MQR provider)
  ├── PIP                   — linked Product Improvement initiatives (05)
  ├── Timeline              — chronological event feed (03 — see "Passport vs. Timeline" below)
  ├── Knowledge Score        — this machine's own knowledge completeness/confidence indicator (07)
  ├── Documents             — generated business documents (PDF/Excel exports, 02)
  └── Attachments            — photos/videos via the Attachment Platform (ADR-010, frozen)
```

Every one of these is either already built (Identity, Configuration,
Documents, Attachments, PM, MQR) or already designed elsewhere in this
blueprint (Lifecycle 03, Inspection History 04, Owner History 02, PIP
05, Knowledge Score 07). Nothing above is a new domain — the Passport is
a *composition*, exactly like the Machine Profile page it backs (see
Composition, not a god-service, below).

## Machine Profile — the UI realization

The Machine Profile is the future single page a Dealer/Central engineer
opens to *read* the Machine Digital Passport — the concrete UI
realization of "Machine is the primary entity" (01, Principle 1). It is
an **aggregation page**, not a new source of truth: every section reads
from the Passport (which itself reads from each domain's own service),
exactly the way today's `Vehicle360Page`/`Machine360Page`
(`src/app/(app)/vehicles/[serial]/page.tsx`, per ADR-009) already
aggregates Summary + Timeline + Attachments from three separate provider
sources without owning any of that data itself.

## Passport vs. Timeline — explicit distinction

These two are easy to conflate because they draw from the same events —
they answer different questions and have different responsibilities:

| | Machine Digital Passport | Machine Timeline |
|---|---|---|
| Nature | **Static + accumulated state** — a snapshot of what's true about this machine *right now* (current owner, current warranty status, current Knowledge Score) | **Chronological** — an ordered log of everything that *happened*, oldest/newest first |
| Question it answers | "What do we know about this machine?" | "What happened to this machine, and when?" |
| Responsibility | Aggregation of current-state facts across every domain (02's Repository Boundaries: parallel per-domain fetches merged in application code) | Rendering of Events (06) in order, via the existing generic `<ActivityTimeline>` component (03) |
| Backing data | Reads the *latest* row/derived value from each domain | Reads the full `PlatformEvent` stream (06) |
| Changes when | Any underlying fact changes (a new Inspection completes, ownership transfers) | Never rewrites history — every past entry is permanent, only new entries are appended |
| Relationship | The Passport's **Timeline section embeds the Machine Timeline** — it is one of the Passport's contents, not a competing concept | Is a *component* of the Passport, not the whole of it |

Put simply: **the Timeline is one of the twelve things the Passport
contains.** A Passport without a Timeline would be missing history; a
Timeline without the rest of the Passport (Identity, Warranty, Knowledge
Score, etc.) would be missing everything the machine *currently is*.
Neither replaces the other — 03 remains the canonical source for how the
Timeline itself works; this document is the canonical source for how the
Passport aggregates the Timeline alongside everything else.

## Aggregates (Machine Profile page sections, backed by the Passport)

```
Machine Profile
  ├── Machine            — Registry/Configuration (02) via MachineService
  ├── Customer           — current + historical owner (Ownership, 02)
  ├── Dealer              — current servicing dealer (DealerBranchScope — frozen platform layer, unchanged)
  ├── Inspection          — via InspectionService (04)
  ├── Warranty            — via calcWarranty() today; a real Warranty module later (05, 14)
  ├── PM                  — via MaintenanceService (existing)
  ├── MQR                 — via MQR's existing provider (existing)
  ├── PIP                 — via PipService (05)
  ├── Timeline            — Machine Timeline (03), fed by the Event Model (06)
  ├── Knowledge           — relevant KnowledgeCases for this machine's model/family (07)
  ├── Knowledge Score     — this machine's own score, not a KnowledgeCase's confidence (07)
  └── AI Insight          — EngineeringIntelligenceService recommendations for this machine's open issues (08)
```

## Relationship to today's Machine 360

This is the **direct successor** to the already-shipped Machine 360 page
(ADR-009) — not a competing design. Machine 360 today aggregates
Summary + Timeline + Attachments via `MachineService`; the Machine
Profile is that same page's scope extended to include Inspection,
Knowledge, Knowledge Score, and AI Insight once those domains exist. No
rewrite of `MachineService`'s existing methods is implied — new sections
are new methods added to the same facade
(`getInspectionsForMachine()`, `getKnowledgeForMachine()`,
`getKnowledgeScoreForMachine()`, `getAiInsightsForMachine()`), following
the exact pattern `getMachineAttachments()` already established (parallel
per-domain fetches merged in application code, never a cross-context SQL
join — 02's Repository Boundaries rule). `getMachineDigitalPassport()`
is simply the name for calling all of the above together.

## Composition, not a god-service

`MachineService` remains a **thin aggregator**. It never contains
Inspection/Knowledge/AI business logic itself — it calls
`InspectionService`, `KnowledgeService`, `EngineeringIntelligenceService`,
each already responsible for its own domain (02, 04, 07, 08), and
assembles the Passport-shaped result (which the Machine Profile page then
renders). This is the same discipline `getMachineAttachments()` already
demonstrates today (calling MQR/PM/NTR's own scoped utilities, never
querying their tables directly) — the Machine Digital Passport is that
pattern applied to more domains, not a new pattern.

## UI reuse, not a new component tree

- **Timeline section** reuses `<ActivityTimeline>` unchanged (03) —
  this is exactly the "future Vehicle 360 compatibility" that component
  was built for.
- **Attachments section** reuses `AttachmentGallery`/`AttachmentService`
  unchanged (Foundation Frozen, `PLATFORM_ARCHITECTURE_STANDARDS.md`).
- **AI Insight section** reuses the Evidence-First presentation pattern
  from 08 — confidence band, evidence, supporting cases, never a bare
  score.

## Explicitly not decided here

- Exact page layout/section ordering — a UI design decision for
  whichever phase (13) actually builds this, not an architecture
  question.
- Whether the route stays `/vehicles/[serial]` (matching ADR-009's
  explicit decision not to change the URL for a terminology-only
  change) or becomes `/machines/[serial]` — if this phase's scope ever
  grows beyond "more data on the same page" into a genuinely new
  information architecture, that's a real product decision to make at
  that time, not implied by this blueprint.
- Whether the Machine Digital Passport ever gets a public, QR-code-
  scannable rendering (converging with `docs/ROADMAP.md`'s "v3.0 Digital
  Tractor Passport" item, 13) — a real product decision or a future
  phase, not designed here; this document only names the business
  object so that future rendering has something stable to read from.
