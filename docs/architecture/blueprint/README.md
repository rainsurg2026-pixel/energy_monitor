# MSEAL DMS — Architecture Blueprint

**Version: v1.1 (refinement pass — see Revision History below).**

**Status: Design only. Nothing in this directory has been implemented.**
No code was written, no table was migrated, no API was changed, and no
existing module was renamed to produce this blueprint — see each
document's own "Out of scope" note for the specific things it
deliberately does not do.

This is the long-term architecture for MSEAL DMS as an **Engineering
Intelligence Platform** — not a rewrite plan. Every document here is
explicit about what already exists in this codebase today versus what is
proposed, because a large part of this vision is already underway
(ADR-009's Machine facade, the Activity Timeline platform, the shared
Attachment/DealerBranchScope/Master Data platforms) and the blueprint's
job is to name where that's heading and complete it deliberately, not to
discard it and start over.

## How this relates to existing binding documents

- `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` — the Foundation Freeze
  list (Storage/Authentication/DealerBranchScope/Attachment/Address/
  MasterData/Lookup/Configuration/Reference Data Platforms) is the
  **frozen infrastructure layer** this blueprint's every future module
  builds on top of, never reimplements. Nothing here proposes touching
  it.
- `docs/adr/ADR-009-Machine-Domain.md` / `docs/engineering/MACHINE_DOMAIN.md`
  — **Machine is already the platform business entity**, decided and
  partially built (`src/features/machine/` facade, Machine 360/Registry/
  Timeline/Health UI). This blueprint extends that decision to full
  aggregate-root status (Section 02) rather than introducing it fresh.
- `docs/standards/DOMAIN_LANGUAGE_STANDARD.md` — the binding business
  terminology table; this blueprint does not contradict it, and any new
  term it introduces (Inspection, Knowledge, PIP) should be added there
  when implementation actually begins, not before.
- `docs/ROADMAP.md` — the near-term, already-committed roadmap (Sync
  Improvements, Google Sheet Master Data, Vehicle 360, Workflow,
  Reporting, Engineering Quality, Technical Debt, v3.0 Digital Tractor
  Passport). This blueprint's Phase 1–8 (Section 13) is the **long-term
  successor** to that roadmap's "Vehicle 360"/later phases, not a
  competing plan — reconciliation is called out explicitly in Section 13.

## Reading order

| # | Document | Deliverables covered |
|---|---|---|
| 01 | [North Star & Principles](01-NORTH-STAR-AND-PRINCIPLES.md) | Mission, Vision, Golden Rule, Architecture Principles, Engineering Principles, Success Metrics |
| 02 | [Domain Model & Context Map](02-DOMAIN-MODEL-AND-CONTEXT-MAP.md) | Domain Model, Context Map (DDD), Bounded Contexts, Aggregate Roots, Repository Boundaries |
| 03 | [Machine Lifecycle & Timeline](03-MACHINE-LIFECYCLE-AND-TIMELINE.md) | Machine Lifecycle Diagram, Timeline-as-SSOT design |
| 04 | [Inspection Domain](04-INSPECTION-DOMAIN.md) | Inspection as its own bounded context |
| 05 | [Service & Quality Domains](05-SERVICE-AND-QUALITY-DOMAINS.md) | Registration/Maintenance/Warranty/Parts, Quality (MQR/PIP/ORC) |
| 06 | [Event Model & Flow](06-EVENT-MODEL-AND-FLOW.md) | Event Model, Event Flow Diagram |
| 07 | [Knowledge Domain & Graph](07-KNOWLEDGE-DOMAIN-AND-GRAPH.md) | Knowledge Model, Knowledge Graph, Knowledge Lifecycle, Knowledge Flow Diagram |
| 08 | [Engineering Intelligence / AI Architecture](08-ENGINEERING-INTELLIGENCE-ARCHITECTURE.md) | AI Service Architecture, AI Governance, Evidence-First AI, AI Confidence Policy, AI Decision Support Flow |
| 09 | [Analytics Architecture](09-ANALYTICS-ARCHITECTURE.md) | Analytics Architecture |
| 10 | [Machine Digital Passport & Machine Profile](10-MACHINE-PROFILE.md) | Machine Digital Passport (business object), Machine Profile (UI), Passport vs. Timeline |
| 11 | [Database & API Evolution Strategy](11-DATABASE-AND-API-EVOLUTION-STRATEGY.md) | Database Evolution Strategy, API Evolution Strategy |
| 12 | [Future Integrations Readiness](12-FUTURE-INTEGRATIONS-READINESS.md) | IoT/Telematics/Portals/ERP/BI readiness, without redesign |
| 13 | [Roadmap & Migration Strategy](13-ROADMAP-AND-MIGRATION-STRATEGY.md) | Migration Roadmap, Recommended Implementation Order, Phase 1–8 roadmap |
| 14 | [Risks & Technical Debt](14-RISKS-AND-TECHNICAL-DEBT.md) | Risks, Technical Debt |
| 15 | [Future Vision](15-FUTURE-VISION.md) | Long-term evolution beyond the Roadmap, Digital Twin (explicitly out of current scope) |
| 16 | [ADR Recommendations](16-ADR-RECOMMENDATIONS.md) | Recommended future ADRs (ADR-015 through ADR-021) — recommendation only, none created |
| 17 | [Business Capability Map](17-BUSINESS-CAPABILITY-MAP.md) | Capability → Business Module → Implementation, business-facing capability list |
| 18 | [Canonical Event Catalog](18-CANONICAL-EVENT-CATALOG.md) | Governed, named Machine Lifecycle events and their single owning module |
| 19 | [Integration Boundary](19-INTEGRATION-BOUNDARY.md) | The Integration Layer — no external system reads internal tables directly |
| 20 | [Architecture Governance](20-ARCHITECTURE-GOVERNANCE.md) | Architecture Baseline, Architecture Freeze, ADR Process, Breaking Change Process, Architecture Review, Architecture Approval |

## Revision History

**v1.1 (this revision)** — an architectural refinement pass over the
approved v1.0 concept, documentation only:

1. Renamed the "Intelligence" domain to **Engineering Intelligence**
   throughout (02, 06, 07, 08, 09, 10, 11, 13, 14) — makes explicit that
   this domain supports engineering decisions, not general business
   intelligence. Doc 08 renamed from `08-INTELLIGENCE-AI-ARCHITECTURE.md`
   to `08-ENGINEERING-INTELLIGENCE-ARCHITECTURE.md`.
2. Introduced the **Machine Digital Passport** (10) as the business
   object — Machine Profile is now documented as its UI realization only.
3. Introduced the **Knowledge Score** concept (07) — a per-machine
   knowledge-completeness/confidence indicator, concept only, no
   implementation.
4. Expanded the feedback loop (07) from Engineer-only to **Technician,
   Dealer, Customer feedback + Engineer Validation** — only Engineer
   Validation can move a Knowledge Case's stored confidence.
5. Added the **AI Confidence Policy** (08) — four named confidence bands,
   explicitly presentation-only, never authorization.
6. Added the **Platform Philosophy** statement and the **Engineering
   Knowledge Loop** diagram (01).
7. Added an explicit **Passport vs. Timeline** distinction (10, with a
   cross-reference in 03).
8. Added **15 — Future Vision**, naming Digital Twin as a coherent but
   explicitly out-of-roadmap long-term direction.
9. Added **16 — ADR Recommendations** (ADR-015 through ADR-021) —
   recommended, not created.

**v1.1, final pre-merge additions (same PR, same version)** — a second
architect-review pass, before merge:

10. Added **17 — Business Capability Map** — a business-facing
    Capability → Business Module → Implementation layering above 02's
    Domain Model.
11. Added **18 — Canonical Event Catalog** — the 13 named Machine
    Lifecycle events (`MachineImported` … `Retired`), each with exactly
    one owning module; supersedes 06's representative catalog for these
    events specifically.
12. Added **19 — Integration Boundary** — the Integration Layer sitting
    between the Event Model and every external system (ERP, Power BI,
    Dealer Portal, Customer Portal, Technician Mobile, Future APIs); the
    hard rule that no external system reads internal tables directly.
13. Added **Knowledge Maturity** (07) — Draft → Validated → Trusted →
    Best Practice → Retired, explicitly distinct from Knowledge
    Confidence.
14. Added **20 — Architecture Governance** — Architecture Baseline,
    Architecture Freeze, ADR Process, Breaking Change Process,
    Architecture Review, Architecture Approval.
15. Added the **Value Creation Flow** diagram (01) — the Engineering
    Knowledge Loop reframed in business-outcome terms, tied explicitly to
    the existing Success Metrics table.

No code, database, or API changed in this revision — same as v1.0.

## Architecture Status

**Architecture Blueprint v1.1 — APPROVED. Architecture Baseline —
FROZEN** as of this blueprint's merge (20's Architecture Baseline/
Architecture Freeze). The five frozen items are listed in 20 — Machine as
aggregate root, the bounded context list, the `PlatformEvent`
envelope/Canonical Event Catalog ownership, Engineering Intelligence's AI
Governance boundary, and the Integration Boundary rule. **Any future
change to one of these requires an ADR, an Architecture Review, and
Architecture Approval per 20 — not a routine PR.** Everything else in
this blueprint (field-level detail, capability-to-module mappings,
specific table shapes) remains a normal, freely-refined design detail
during implementation.

## Golden Rule

> The goal is not to build software that stores service records. The goal
> is to build a platform that continuously improves engineering decisions
> through reusable knowledge.
