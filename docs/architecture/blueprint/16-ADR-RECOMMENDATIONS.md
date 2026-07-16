# 16 — ADR Recommendations

**Recommendation only. None of the ADRs below are created by this PR.**
This blueprint is design-only per its own scope (README) — an ADR is a
binding decision record, and none of the domains below have been
confirmed as an approved decision by the business yet. Each row names
the future ADR this blueprint's corresponding section would justify,
once implementation of that domain is actually approved to begin —
matching how ADR-009 (Machine Domain) and ADR-014 (Authentication
Platform v3.0) were each written at the point their respective work was
approved, not before.

| ADR | Would formalize | Blueprint section it's based on |
|---|---|---|
| **ADR-015 Machine Domain** (v2) | Promoting Machine from ADR-009's facade-over-`vehicles` decision to a full DDD aggregate root — Registry/Timeline/Inspection/Ownership/Documents/Configuration/Attachments as named sub-entities | 02 |
| **ADR-016 Event Model** | The `PlatformEvent` envelope as the platform-wide additive superset of `record_audit_log`/`auth_audit_log`, and the Event Flow Diagram's producer/consumer boundary | 06 |
| **ADR-017 Inspection Domain** | Inspection as its own bounded context (not embedded in NTR/PM/Warranty), the `inspections` table, and the Inspection Type enum | 04 |
| **ADR-018 Knowledge Model** | `knowledge_cases`, the family/model-scoped (never machine-specific) case key, the Knowledge Lifecycle, and the Human Feedback Loop's Engineer Validation rule | 07 |
| **ADR-019 Engineering Intelligence** | The AI Governance boundary (no privileged write path), Evidence-First AI, the AI Confidence Policy's four bands, and the "Engineering" naming rationale that scopes this domain away from general BI | 08 |
| **ADR-020 Analytics Domain** | The operational-vs-knowledge-derived question boundary, and that `AnalyticsService` reads Knowledge/Events, never raw operational tables, without replacing today's `dashboardStats()` | 09 |
| **ADR-021 Machine Digital Passport** | The Passport as a named business-object aggregation distinct from the Machine Profile UI, its content list, and its explicit relationship to Machine Timeline | 10 |

## Why recommend these now, rather than write them now

Per this PR's own scope (README, out of scope note on every document):
this blueprint is architecture design, not an implementation approval.
Writing these seven ADRs today would assert seven decisions are already
made when only the *blueprint* has been reviewed — the same distinction
02 already draws between "Today" and "Target" in every one of its
tables. The recommended sequence is: this blueprint is reviewed and
accepted first (README), then each ADR above is written **at the point
its corresponding phase (13) is actually approved to start**, not
speculatively in a batch now. Writing ADR-015 today, for instance, before
Inspection (Phase 4 dependency, 13) is even scheduled, would freeze a
decision the business hasn't asked for yet — exactly what
`PLATFORM_ARCHITECTURE_STANDARDS.md`'s Architecture Evolution Rule warns against.

## Suggested order, if and when they are written

Matches 13's Recommended Implementation Order, not the numbering above:
**ADR-016 (Event Model) → ADR-017 (Inspection) → ADR-018 (Knowledge) →
ADR-015 (Machine Domain v2, since aggregate-root status matters most once
Inspection/Ownership actually populate it) → ADR-021 (Machine Digital
Passport, once it has real content to aggregate) → ADR-019 (Engineering
Intelligence) → ADR-020 (Analytics)** — the same dependency logic 13
already applies to build order, applied here to decision-record order.
