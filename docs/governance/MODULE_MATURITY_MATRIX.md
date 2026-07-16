# Module Maturity Matrix

## Relationship to existing documents

No prior document rates modules/domains on a single maturity scale -
`docs/architecture/blueprint/17-BUSINESS-CAPABILITY-MAP.md` has an
"Implementation" column per capability (prose, not a scale) and
`docs/ROADMAP.md` has phase status ("Not started"/etc.) for roadmap
items specifically. This document is new: one consistent scale, applied
to every domain named in `DOMAIN_OWNERSHIP_MATRIX.md`, cited from those
two sources rather than re-deriving status from scratch.

## Maturity Scale

| Level | Meaning |
|---|---|
| **Frozen** | Built, stable, governed by the Architecture Freeze or Foundation Freeze - modification requires the 4-condition bar (defect/security/performance/approved ADR) |
| **Production** | Built, in real use, not a Freeze item - normal review process for changes |
| **Partial** | Some real code/data exists, but the domain is not fully realized (e.g. a capability named but no dedicated table, or wired for only one module) |
| **Design-only** | Architecture/governance documentation exists, no schema or running code |
| **Not started** | Not named anywhere as buildable yet, or named only as a future capability with zero design detail |
| **Retired** | Was built and in real use, deliberately removed by an explicit decision (Product Owner or ADR) - no code path remains; distinct from "Not started," which never existed |

## Matrix

| Domain / Capability | Maturity | Evidence |
|---|---|---|
| Authentication | Frozen | `PLATFORM_ARCHITECTURE_STANDARDS.md` Foundation Freeze; ADR-014 v3.0 |
| Master Data | Frozen | `PLATFORM_ARCHITECTURE_STANDARDS.md` Foundation Freeze; ADR-011 (Address v2), ADR-012 |
| DealerBranchScope | Frozen | `PLATFORM_ARCHITECTURE_STANDARDS.md` Foundation Freeze |
| Attachment/Storage Platform | Frozen | `PLATFORM_ARCHITECTURE_STANDARDS.md` Foundation Freeze |
| Machine (aggregate root) | Frozen (identity/aggregate concept), Production (Registry/Vehicle 360 today) | 20's Architecture Freeze; `vehicles` table, ADR-009 |
| Service > Registration (NTR) | Production | Built, end-to-end (`features/ntr/`) |
| Service > Maintenance (PM) | Production | Built (`pm_records`) |
| Service > Warranty | Partial | `calcWarranty()` logic only, no table (`DATA_OWNERSHIP_MATRIX.md`) |
| Service > Parts | Not started | 17: "no dedicated module/table yet" |
| Service > Campaigns (Recall/Service Campaign) | Not started | No table, no nav route beyond Coming Soon (ADR-023) |
| Quality (MQR) | Production | Built (`records` table), oldest module in the platform |
| Quality > PIP (as a Quality-adjacent reference) | Not started | No table; capability named only |
| Knowledge | Partial | ADR-018 - `knowledge_cases`/`knowledge_evidence` tables live, `KnowledgeService`, `/quality/knowledge` list/create/detail screens, Machine Passport integration. Not built: AI consumption (Engineering Intelligence remains Not started, below), Knowledge Score, similarity matching |
| Inspection (Import Inspection) | Production | ADR-017, business-domain-corrected by ADR-028 (an internal MSEAL process, not "Dealer PDI") - `inspections` table, `InspectionService`, `/delivery/pdi` list/new/detail + dashboard screens, Machine Passport integration (dedicated section, dealer-visible summary). Not built: Import PDI UI (manufacturer-side), checklist template builder/admin UI, Technician Certification management beyond a free-text reference (removed from the create UI in ADR-029, column retained for historical data) |
| Delivery (Machine Delivery Platform) | Partial | ADR-027, amended by ADR-031 (Platform Stabilization) - `delivery_records`/`delivery_trainings` tables, `DeliveryService` (several methods now production-dead, see `V3_FOUNDATION_HARDENING_AUDIT.md` §11.5), Warranty Activation as a real point-in-time event. The General Delivery lifecycle-tracking UI and its 10 API routes were removed as unreachable dead code (ADR-031) - Vehicle 360's `MachineDeliverySection` and NTR-triggered `activateWarrantyFromNtr()` are the only remaining consumers. Not built: AI Delivery Review/Risk/Readiness/Recommendation (reserved), full Warranty claims/policy ledger |
| Vehicle 360 / Machine Passport | Production | ADR-009/ADR-026, consolidated by ADR-030 - `/machines/[machineId]` is the one Vehicle 360 destination (`/vehicles` redirects here); sections for Identity/Lifecycle/Ownership/Health/Import Inspection/NTR/Delivery/Warranty/PM/Quality/Related Records/Documents/Activity/Knowledge, each a thin `MachineService` facade over its owning module |
| Engineering Intelligence | Design-only | 08 fully specifies AI Governance/Confidence Policy (frozen concept); `EngineeringIntelligenceService`/`ModelGateway` not built |
| PIP (as an Engineering Intelligence deliverable) | Not started | No table; ownership assigned by ADR-023's addendum, nothing built |
| Recall | Not started | Not named in 02/17 at all; first named in this governance framework |
| Reports / Analytics | Partial | Quality Dashboard (`/quality/dashboard`) is real and built; cross-domain Reports nav (ADR-023, proposed) is Coming Soon everywhere else |
| Administration | Production | Users/Master Data screens/System Health all built. Import History retired alongside Historical NTR Import (ADR-038, 2026-07-16) |
| Import Platform | **Retired** (v1, NTR), Proposed (v2 extensions, framework only) | ADR-024 (Universal Import Framework)'s only real adopter, NTR's Historical Import, is permanently retired (ADR-038, 2026-07-16, Product Owner decision) - `/api/ntr/import/*`, the wizard, and the service layer are deleted. The framework itself (`src/shared/import/`) is not retired, now unconsumed except `TransformationLibrary.normalizeDate()`; ADR-022 (Import Platform v2, proposed PR #36) would extend it for a future module, not yet merged |
| Timeline | Production (both feeds) | Two distinct, intentionally separate implementations, both live: Machine Lifecycle (`vehicle_events` + per-module `VehicleEventSource`, coarse milestones on Vehicle 360) and Activity Timeline (`shared/activity-timeline/`, field-level, now used by MQR/PM/NTR/Inspection/Delivery/Knowledge's own record-detail pages plus Machine Passport's aggregated feed) - see `V3_FOUNDATION_HARDENING_AUDIT.md` §5 |
| Notifications | Not started | `NotificationBell` is a static placeholder with zero backing service (`DOMAIN_OWNERSHIP_MATRIX.md`) |
| MSEAL Design Framework (governance-adjacent, not a domain) | Proposed | ADR-023, open PR #37, pre-merge refinement already applied on that branch |
| Platform Governance Framework (this framework) | Proposed | This PR (#38), not yet merged |

## Gap Analysis

- "Partial" is doing real work for Warranty, Reports/Analytics, and
  Machine (as aggregate root vs. today's simpler facade) - each has a
  materially different meaning for "partial" (a calculation with no
  storage; one real dashboard among several planned; a frozen *concept*
  well ahead of a frozen *implementation*). Don't read "Partial" as one
  uniform 50% - check the Evidence column for what's actually true.
- This matrix will go stale the moment any "Not started"/"Design-only"
  row gets built - it describes a snapshot, not a live status; re-verify
  against `docs/ROADMAP.md` and the actual codebase before relying on it
  for a decision more than a few weeks old.
