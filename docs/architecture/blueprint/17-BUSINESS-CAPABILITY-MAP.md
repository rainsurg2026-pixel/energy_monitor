# 17 — Business Capability Map

## Why a Capability layer, above the Domain Model

02's Domain Model/Bounded Contexts answers an *engineering* question:
which code owns which data. This document answers a *business* question:
what can the business actually do, independent of which module happens
to implement it today. The two are related but not identical — a single
business Capability can be served by a module that doesn't exist yet
("Warranty" the capability is real; a `Warranty` bounded context is not,
per 05/14), and a stakeholder discussing "Quality Management" shouldn't
need to know it currently means two bounded contexts (MQR + PIP, 05).

## Capability → Business Module → Implementation

```
Capability            (business language — what the business needs)
   ↓
Business Module        (02's bounded context — who owns the data/logic)
   ↓
Implementation          (today's actual code — src/features/*, tables, services)
```

Each layer answers a different question and changes at a different
rate: a Capability rarely changes (the business has always needed
"Quality Management"); the Business Module that serves it changes only
when a domain boundary is deliberately redrawn (governed by 20's
Breaking Change Process); the Implementation changes constantly (normal
day-to-day development) without necessarily moving the Capability or
Business Module at all. Reading a requirement top-down (Capability first)
prevents the common failure mode of naming a new table before naming
what business need it serves; reading bottom-up (Implementation first)
is how 02's own "Today vs. target" tables were built — this document is
that same exercise inverted to start from the business, not the code.

## Capability Map

| Capability | Business Module (02) | Implementation today |
|---|---|---|
| **Machine Management** | Machine | `features/machine/` facade over `features/vehicle/` (ADR-009) |
| **Inspection Management** | Inspection | *(new)* `features/inspection/`, `inspections` table (04) |
| **Registration** | Registration (NTR) | `features/ntr/` |
| **Maintenance** | Maintenance (PM) | `features/maintenance/` |
| **Warranty** | Service (Warranty sub-domain, 05) | `calcWarranty()` only — no dedicated module/table yet (05, 14) |
| **Quality Management** | Quality (MQR + PIP, 05) | `features/mqr/` + `app/(app)/records` (shipped); PIP is *(new)* `features/pip/` (05) |
| **Parts Management** | Service (Parts sub-domain, 05) | `parts` table exists, "not yet wired into the UI" (root `CLAUDE.md` §5) |
| **Knowledge Management** | Knowledge | *(new)* `features/knowledge/`, `knowledge_cases` table (07) |
| **Engineering Intelligence** | Engineering Intelligence | *(new)* `features/engineering-intelligence/` (08) |
| **Analytics** | Analytics | *(new)* `features/analytics/` (09) |
| **Identity & Access** | *(frozen infrastructure layer, not a bounded context — see `PLATFORM_ARCHITECTURE_STANDARDS.md`)* | Authentication Platform v3.0 (`lib/authServices/*`, `middleware.ts`) + RBAC (`lib/scope.ts`) |
| **Document Management** | Machine's Documents sub-entity (02) + Attachment Platform (frozen) | `exportPdf.tsx`/`ntrPdf.tsx`/`maintenancePdf.tsx` (generation) + `AttachmentService` (storage, ADR-010) |
| **Notification** | *(not yet its own Business Module — embedded per-module)* | `lib/email.ts` (Resend) — every module calls it directly today, no shared Notification service |
| **Integration** | *(new — see 19's Integration Layer)* | Not built — no external system integration exists today |

## Reading this table

- **Capabilities with a real Business Module and shipped Implementation**
  (Machine Management, Registration, Maintenance, Quality Management's
  MQR half) are the platform's proven foundation — every later Capability
  either extends or depends on these.
- **Capabilities with a named Business Module but no Implementation yet**
  (Inspection Management, Knowledge Management, Engineering Intelligence,
  Analytics, Quality Management's PIP half) are exactly this blueprint's
  Roadmap (13) — the Capability and its owning module are already
  decided; only the code doesn't exist yet.
- **Capabilities with neither a dedicated Business Module nor a real
  Implementation** (Warranty, Parts Management, Notification,
  Integration) are honest gaps, not oversights — each is already flagged
  in 05/14/19 as a real, deferred design decision, not guessed at here.

This table is the same "Today vs. target" discipline 02 already applies
to the Domain Model, applied one layer up, in business vocabulary a
non-engineering stakeholder can read without translating "features/mqr/"
into "the quality reporting thing."

## What this does not change

No Business Module boundary from 02 is redrawn by this document — it is
a relabeling/business-facing index over 02's existing bounded contexts,
not a second, competing domain model. If this table and 02 ever disagree
about which module owns a capability, 02 is authoritative (it is the
engineering-facing source of truth); this document should be corrected to
match it, per 20's Breaking Change Process if the disagreement reveals a
real boundary question, or as a simple documentation fix if it's just
drift.
