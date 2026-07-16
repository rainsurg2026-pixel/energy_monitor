# 14 — Risks & Technical Debt

## Risks

| Risk | Description | Mitigation |
|---|---|---|
| **Knowledge becomes MQR-shaped by accident** | The single biggest risk to this blueprint's actual value. If the first implementation of `KnowledgeCase` is built by extending MQR's own tables/types "just this once," it silently becomes module-owned knowledge, defeating 01's Principle 3/9. | `KnowledgeCase`'s schema (07) deliberately has no foreign key to any one module's table — only to `source_events` (generic `PlatformEvent` references). Enforce this in code review, not just in this document. |
| **Empty Knowledge Base at launch** | Knowledge/AI features are only as good as the cases behind them; Phase 3–4 built too early looks broken, not innovative. | Recommended Implementation Order (13) deliberately sequences Inspection (a real, immediately useful feature on its own) before Knowledge, so there's real event volume before Knowledge/AI need to prove themselves. |
| **AI governance erodes under delivery pressure** | "Just this once, let AI auto-close a duplicate MQR" is exactly how a Decision Support System quietly becomes a decision maker. | 08's AI Governance is written as an architectural boundary (no privileged write path for Engineering Intelligence), not a policy note — the enforcement is structural (same RBAC/API routes every human action already goes through), not procedural. The AI Confidence Policy (08) reinforces this: even a >95% "Strong Recommendation" only changes wording, never authorization. |
| **Non-engineer feedback silently treated as validated** | The Human Feedback Loop (07) now accepts Technician/Dealer/Customer feedback, not just Engineer feedback. If an implementation ever lets non-Engineer feedback move `confidence` directly (skipping `validated`), Knowledge quietly becomes crowd-sourced instead of engineering-validated. | 07's `KnowledgeCase.feedback` schema makes `validated` a field only an Engineer Validation event can set to `true` — enforce this in code review as carefully as the "no FK to one module's table" rule already is. |
| **Knowledge Score misread as a machine health/quality score** | The name invites the same misreading "Confidence" once risked in 08 — a low Knowledge Score could be mistaken for "this is a bad machine" rather than its actual meaning, "we don't know much about this machine yet." | 07 states the distinction explicitly; any UI surfacing Knowledge Score (10's Machine Digital Passport) must label it as a knowledge-completeness indicator, never alongside language implying machine quality. |
| **Canonical Event Catalog (18) drifts from what code actually emits** | A named, governed event list only has value if implementation keeps emitting exactly those names with exactly one owning module — the same risk 06's own additive-only guarantee already names, now sharper because 18 asserts single ownership specifically. | 20's Breaking Change Process requires an ADR to add/reassign an event's owning module — enforce that no PR silently adds a second producer for an existing event name. |
| **Integration Layer (19) has no real consumer yet to validate it against** | The rule ("no external system reads internal tables directly") is easy to state and easy to quietly violate the first time a real integration is under deadline pressure ("just this once, give the BI tool a read replica connection"). | Same structural-not-procedural enforcement pattern as 08's AI Governance — the rule is written as an architecture boundary reviewable at Architecture Review (20) time, not a guideline a stressed integration project can reason its way around. |
| **`AuditModule`/event-union sprawl** | Every new domain adding its own event types could eventually make the union unwieldy. | Not a blocker at the scale this platform operates at (a handful of dealer accounts, per Authentication Platform v3.0's own documented traffic assumption) — revisit only if it becomes a real problem, per 01 Principle 9. |
| **Machine identity ambiguity (`serial` vs `machine_id` vs future multi-serial scenarios, e.g. an engine swap)** | Not addressed by this blueprint — a real-world Machine's identity can outlive a component swap (engine/serial change), and none of the domain model in 02 designs for that case. | Flagged here as unresolved, not guessed at. Needs a business-confirmed answer (does an engine swap create a new Machine record, or does Ownership/Configuration history absorb it?) before Inspection/Knowledge tables key too rigidly on today's 1:1 `vehicles.serial` assumption. |
| **Warranty/Parts have no real module yet** | Several diagrams (Machine Lifecycle 03, Machine Profile 10) reference "Warranty Activated"/Parts data that doesn't exist as first-class data today. | Explicitly called out in 05/10 wherever referenced — this blueprint does not pretend these modules exist, and does not design their schemas speculatively (matches `PLATFORM_ARCHITECTURE_STANDARDS.md`'s Architecture Evolution Rule). |
| **Analytics duplicating the existing dashboard's logic** | Building a new `AnalyticsService` without clarifying its boundary against `dashboardStats()` risks two parallel, drifting KPI implementations. | 09 draws the boundary explicitly (operational vs. knowledge-derived questions) — enforce it at implementation time, don't let "just query `records` directly, it's faster" creep into `AnalyticsService`. |
| **Vector-similarity requirement forces new infrastructure later** | If Similar Case Retrieval (08) needs real embedding-based similarity search at scale, Postgres alone may not be enough. | Flagged in 07 as a future decision point, not resolved now — `pgvector` (a Postgres extension, not new infrastructure) is the first thing to evaluate before a dedicated vector store, consistent with "no new dependency casually." |

## Technical Debt (carried into this blueprint, not created by it)

1. **No real Warranty/Parts module** — `calcWarranty()` computes status
   on read; `parts` table exists but is "not yet wired into the UI" per
   root `CLAUDE.md`. Blocks a true "Warranty Activated" event (03) and
   Required Parts Recommendation (08) from being backed by real data.
2. **Product Family/Sub Model sync incomplete** — `docs/ROADMAP.md`
   already tracks this (PM's model-derivation fallback remains until
   Tractor IN's sync reaches 100%). This blueprint's Knowledge Cases (07)
   key on `product_family_id`, so this existing gap directly blocks
   Phase 3's data quality, not just PM's.
3. **No admin UI to view cross-user session lists** (Authentication
   Platform v3.0's own documented remaining debt) — unrelated to Machine
   architecture, listed here only because it's the most recent
   precedent for how this repo tracks "shipped but incomplete" honestly
   rather than silently.
4. **`MachineRepository`/`MachineService` are a thin facade over
   `features/vehicle/`, not a rewrite** (ADR-009, by design) — this
   blueprint continues that facade approach rather than resolving it
   into a full rename, which remains a valid *future* option per
   ADR-009's own "Alternatives Considered" section, not a current
   requirement.
5. **No generic Activity/Event read API exists yet** — the Activity
   Timeline platform's own architecture doc already names this as a
   deferred item, inherited unchanged by this blueprint's Event Model
   (06)/API Evolution Strategy (11 Rule 4).
6. **ORC has no persistence model today** — treated in this blueprint as
   fields on a PIP record (05), not a dedicated table; if a future
   business requirement needs ORC investigations to exist independently
   of any single PIP (e.g. an investigation that concludes "no PIP
   needed"), that's a real design gap this blueprint doesn't currently
   cover — flagged, not solved.
7. **Quality-problem "origin" is free text today** (`stockNote`,
   `problem_code`), not a structured enum spanning Dealer PDI/Complaint/
   Care Camp/Stock Yard/Internal Audit/Telematics/Inspection (05) —
   needed for Analytics (09) to actually break down quality trends by
   origin, not designed in this PR.
8. **Machine identity/component-swap ambiguity** — see the risk above;
   listed again here because it is both a risk *and* a concrete design
   gap someone needs to close before Inspection/Knowledge tables are
   built, not just something to watch.
9. **Knowledge Score has no defined computation yet** (07/08) — this
   blueprint defines the concept and its inputs deliberately, per this
   PR's "concept only, not an implementation" scope, but the actual
   scoring formula/weighting across lifecycle completeness, inspection
   history, repair history, PM history, quality history, and validated
   feedback is unresolved by design — a real design task for whichever
   phase (13) first needs it, not guessed at here.
10. **Machine Digital Passport is a named aggregation, not yet a real
    service method** — `getMachineDigitalPassport()` (10) is a naming
    convention over calls that already exist as separate `MachineService`
    methods; it does not yet exist as a single callable API. No debt is
    created by naming it, but implementing it should not become "one
    more god-method" — 10's "Composition, not a god-service" section is
    the guardrail to enforce at that time.
11. **Knowledge Maturity has no defined promotion criteria yet** (07) —
    how many corroborating validated cases move a case from Draft to
    Validated to Trusted to Best Practice is unresolved by design, same
    class of gap as Knowledge Score's undefined computation (item 9).
12. **Several Business Capabilities (17) have no owning Business Module
    or Implementation at all** — Warranty, Parts Management, Notification,
    and Integration are named as real business capabilities in 17 with no
    corresponding module/table/service today. Not new debt (Warranty/
    Parts are already tracked, items 1/2), but 17 makes the gap visible
    at the business-capability level for the first time, including two
    genuinely new gaps: Notification has no shared service (every module
    calls `lib/email.ts` directly) and Integration has no implementation
    of any kind yet (19 is design-only).

## What this blueprint deliberately leaves unresolved (by design, not oversight)

Per this PR's explicit scope: LLM vendor selection, prompt design, Data
Warehouse implementation, any actual code/migration/API change, and any
rename of existing business modules. These are not gaps in the
architecture — they are the next PR's job, once this one is reviewed.
