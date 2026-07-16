# Data Ownership Matrix

## Relationship to existing documents

`docs/CORE_DOMAIN_MODEL.md`, `docs/ENTITY_MODEL.md`, and
`docs/ENTITY_RELATIONSHIP.md` (all Sprint 7, binding) already define six
core entities - Dealer, Branch, Customer, Tractor (Machine), Technician,
Employee - with field-level definitions and some source-of-truth
language (e.g. Tractor's `warranty_status` is explicitly "a denormalized
read, not a second place warranty decisions are made"). They document
**zero** content on Warranty, Quality Case, Knowledge Case, PIP, or
Recall as entities. `docs/FUTURE_MODULE_DEPENDENCY.md` documents which
modules reference the six core entities by FK, also with no entry for
these five.

**This matrix cites the existing three documents for Machine/Customer/
Dealer rather than re-deriving them, and is the first place Warranty, PM,
Quality Case, Knowledge Case, PIP, and Recall get an ownership entry at
all.** For the four that have no built module yet (Quality Case is
partially built as MQR; Knowledge Case, PIP, Recall have no table),
treat this as forward-looking governance guidance for whoever builds
them, per the same "documented ahead of implementation" pattern the
Architecture Blueprint itself uses (17's own capability rows for
not-yet-built capabilities) - **not** an approval to build them now.

## Matrix

### Machine

| Field | Value |
|---|---|
| Owner Domain | Machine (frozen aggregate root, 02) |
| Source of Truth | `vehicles` table (production name; "Tractor" in `CORE_DOMAIN_MODEL.md`/`ENTITY_MODEL.md`, reconciled by ADR-009's Machine rename - business terminology only, table name unchanged) |
| Consumers | Service (PM/NTR/Warranty), Quality (MQR), Engineering Intelligence (via Knowledge, never directly), Timeline, Reports/Analytics, Import Platform (writes via `TractorInSyncService` only) |
| Update Rules | `vehicles.product_family_id`/`sub_model` written **only** by `TractorInSyncService` (ADR-012, `MASTER_DATA.md` §2) - no business module derives or writes these two columns itself. All other fields follow `ENTITY_MODEL.md`'s per-field rules |
| Relationships | `dealer_id`, `customer_id` both direct FKs (not customer-mediated) per `ENTITY_RELATIONSHIP.md`; PM/MQR/Warranty/Parts Request/Campaign all reference Machine by FK, never copy its fields (`FUTURE_MODULE_DEPENDENCY.md`) |
| Lifecycle | Import → Registration → Service events (PM/Warranty/MQR) → (proposed) Machine Digital Passport aggregation → Ownership Transfer / Retirement (18's canonical event names, proposed - `MachineImported` .. `Retired`) |

### Customer

| Field | Value |
|---|---|
| Owner Domain | Customer bounded context (02) |
| Source of Truth | `customers` table (per `CORE_DOMAIN_MODEL.md`) |
| Consumers | Machine (`vehicles.customer_id`), Service (NTR delivery/acceptance), Quality (MQR complainant), Warranty (claimant) |
| Update Rules | Customer "is not a system user - it has no login, no Role" (`ENTITY_MODEL.md`, quoted) - never conflated with `users`/Employee. Created/updated only through the module that first captures it (typically NTR at delivery) |
| Relationships | Dealer → Customer → Tractor chain (`ENTITY_RELATIONSHIP.md`); a Tractor can exist with `dealer_id` set and `customer_id` still null (pre-delivery/stock) |
| Lifecycle | Created at first delivery/registration touch → referenced by every subsequent Machine-linked record → no documented deletion/retention rule today (gap, see below) |

### Dealer

| Field | Value |
|---|---|
| Owner Domain | Master Data Platform (frozen, `PLATFORM_ARCHITECTURE_STANDARDS.md`) |
| Source of Truth | `dealers` table, `id` = Dealer Code (`docs/standards/DOMAIN_LANGUAGE_STANDARD.md`) |
| Consumers | Every domain - Dealer/Branch is the tenant-isolation boundary for all of them (`DealerBranchScope`, frozen) |
| Update Rules | Admin-only CRUD (Administration domain) through `MasterDataService`'s public interface only - no module writes `dealers` directly (`PLATFORM_ARCHITECTURE_STANDARDS.md`'s Platform service boundaries) |
| Relationships | Dealer → Branch (1:many, `Branch.dealer_id`) → Technician (organizational only, no FK today - flagged open in `ENTITY_RELATIONSHIP.md`); Dealer → Customer → Tractor |
| Lifecycle | Onboarded via Master Data admin screen → active for the life of the dealership relationship → soft-deactivated (`active` flag), never hard-deleted |

### Warranty

| Field | Value |
|---|---|
| Owner Domain | Service bounded context (02 names Warranty as a Service sub-concern; 17 flags "no dedicated module/table yet" - confirmed still true) |
| Source of Truth | **None today** - `src/lib/warranty.ts`'s `calcWarranty()` is pure calculation logic (delivery date + found date + problem system → in/out of warranty), not a queryable record. `vehicles.warranty_status` (`ENTITY_MODEL.md`) is a denormalized read, explicitly not the decision-maker |
| Consumers | Quality (MQR's warranty determination at report time), Reports (warranty claim aggregates, not built) |
| Update Rules | **Gap** - no Warranty table exists, so no update rule can be stated beyond "whenever a Warranty module is built, it becomes the one source of truth Tractor's `warranty_status` denormalizes from, consistent with the pattern already used for `product_family_id`/`sub_model`" |
| Relationships | Machine (1:many claims), Service/PM (a repair may be a warranty repair), Quality (an MQR case may result in a warranty determination) |
| Lifecycle | (Forward-looking) Activated at delivery → claims filed against it → expires by date/hours per `calcWarranty()`'s existing rule → (18's proposed canonical event) `WarrantyActivated` |

### PM (Preventive Maintenance)

| Field | Value |
|---|---|
| Owner Domain | Service bounded context (Maintenance sub-concern, 02) |
| Source of Truth | `pm_records` table |
| Consumers | Machine (Timeline), Quality (a PM visit can surface a quality issue), Reports (PM Completion KPI, `docs/DASHBOARD_MODEL.md`), Engineering Intelligence (via Knowledge, if a PM outcome becomes a Knowledge Case) |
| Update Rules | Written only through PM's own repository/service (`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s dependency rules) - "many:1 `tractor_id`" per `ENTITY_RELATIONSHIP.md`, module-owned fields beyond that FK |
| Relationships | Tractor → PM Record (many:1); PM Interval / Maintenance Program (master data) determines due dates, consumed not owned by PM |
| Lifecycle | Scheduled (per Maintenance Program stage) → performed → recorded → (18's canonical event, proposed) part of the Machine Lifecycle stage progression |

### Quality Case

| Field | Value |
|---|---|
| Owner Domain | Quality bounded context (02, 17's "Quality Management") |
| Source of Truth | `records` table (production name for the MQR/Market Quality Report entity; "Quality Case" is the domain-model name introduced by the blueprint, not a table rename - same pattern as Machine/Tractor) |
| Consumers | Knowledge (a closed Quality Case is a candidate observation, Principle 3 of blueprint 01), Engineering Intelligence (reads Knowledge, never Quality Cases directly - 08's "no independent data of its own" rule), Reports, Timeline |
| Update Rules | Status transitions via `updateRecord()`'s existing dealer/branch-scoped, audited write path (`docs/lib/mqrStatusTransitions` convention) - never a direct table write from another domain |
| Relationships | Machine (many:1, `serial`/`vehicle` FK), Dealer/Branch/Technician (tenant scope + assignment), Knowledge Case (a Quality Case may become source evidence for one, one-directional) |
| Lifecycle | Draft → Open → UnderInvestigation → WaitingParts/WaitingCustomer → Repaired → Closed (existing `StatusValue` enum) → (on Closed) candidate for Knowledge extraction |

### Knowledge Case

| Field | Value |
|---|---|
| Owner Domain | Knowledge bounded context (02 names "Knowledge Case" explicitly in its Aggregate Roots table: "Symptom, cause, resolution, confidence, source-event references") |
| Source of Truth | **Not built** - 02/07 (Knowledge Domain and Graph) define the aggregate; no `knowledge_cases` table exists in production today |
| Consumers | Engineering Intelligence (the *only* legitimate reader for AI recommendations, per 08's "no independent data of its own" rule), Analytics (predictive quality, via Engineering Intelligence per 09's one stated exception) |
| Update Rules | (Forward-looking) Written only by Knowledge's own service; confidence updated only through the Human Feedback Loop (07) - Technician/Dealer/Customer feedback all feed it, but **only Engineer Validation can raise a Knowledge Case's confidence** (blueprint 01, Principle 5, quoted) |
| Relationships | `source_events` - resolvable back to real Machine/PlatformEvents, "never synthesized examples" (08's Evidence-First rule); many Quality Cases/PM records may corroborate one Knowledge Case (many:1 conceptually, exact cardinality not yet schema'd) |
| Lifecycle | Candidate observation (from a closed Quality Case/PM event) → case created → confidence adjusted by feedback loop → surfaced as an Engineering Intelligence recommendation → outcome recorded → confidence re-adjusted (closes the loop, blueprint 01's Engineering Knowledge Loop diagram) |

### PIP (Product Improvement Plan)

| Field | Value |
|---|---|
| Owner Domain | Engineering Intelligence (per the MSEAL Design Framework's pre-merge addendum, ADR-023 proposed: "PIP is produced from Quality Cases/Knowledge but is itself an Engineering deliverable") |
| Source of Truth | **Not built** - `features/pip/` doesn't exist yet (17 lists it only inside "Quality Management (MQR + PIP)" as a capability name, not a schema) |
| Consumers | Quality (references, does not own, per the same addendum), Service (Campaigns may track a PIP as a campaign-adjacent deliverable - a distinct reference, not a duplicate record, per ADR-023's addendum), Reports |
| Update Rules | (Forward-looking) **AI never creates a PIP automatically** - explicit, named in 08's AI Governance boundary ("AI never: ... creates a PIP automatically... AI only provides: ... PIP Recommendation"). A PIP is created by an engineer, informed by an AI recommendation, never by an automated write |
| Relationships | Knowledge Case (many:1 - a PIP is typically built from one or more corroborating Knowledge Cases); Recall (a PIP may escalate into a Recall, per the task's own stated chain: Quality Cases → Knowledge → Engineering Analysis → PIP → Recall) |
| Lifecycle | Recommended (Engineering Intelligence, evidence-based) → created (engineer decision) → tracked (Service/Reports) → resolved or escalated to Recall |

### Recall

| Field | Value |
|---|---|
| Owner Domain | Service bounded context (Campaigns sub-concern - the MSEAL Design Framework's navigation places Recall under Service > Campaigns, proposed) |
| Source of Truth | **Not built** - not mentioned in `02`/`17` at all (confirmed genuine gap; 17 doesn't name Recall even as a future capability) |
| Consumers | Machine (a Recall targets a population of machines, many:many like Campaign per `ENTITY_RELATIONSHIP.md`'s existing Campaign cardinality), Quality/Engineering Intelligence (a PIP may escalate into a Recall), Reports |
| Update Rules | (Forward-looking) No rule can be stated with confidence beyond: escalation from a PIP should be a deliberate, evidence-first, human decision, consistent with 08's "AI never approves engineering decisions" boundary applying equally to any future Recall-approval workflow |
| Relationships | PIP (a Recall's usual origin, per the task's stated chain), Machine (many:many target population) |
| Lifecycle | (Forward-looking) Escalated from PIP → population identified → notification/service action → closed. Entirely undesigned beyond this - flagged as a real, open gap, not a decision this matrix makes |

## Gap Analysis

- Customer has no documented deletion/retention rule anywhere in
  `CORE_DOMAIN_MODEL.md`/`ENTITY_MODEL.md` - worth a follow-up given PII
  implications (see `SECURITY_BOUNDARY.md`'s PII section). **v3.1 note
  (ADR-033, proposed, not yet approved or built)**: a Customer Ownership
  proposal exists (`docs/architecture/CUSTOMER_OWNERSHIP_PROPOSAL.md`)
  that would make the `customers` table real - it explicitly does not
  resolve this retention-rule gap and requires Legal/Compliance sign-off
  before any implementation, per that proposal's own Risks section.
- Warranty, Knowledge Case, PIP, and Recall have no schema today - every
  "Update Rule"/"Lifecycle" entry above is forward-looking guidance, not
  a description of built behavior. Do not cite this matrix as evidence
  those tables exist.
- Recall is not named anywhere in the frozen Architecture Blueprint
  (02/17) - this matrix's placement of it under Service is a
  documentation-layer proposal, not a Baseline decision; formalizing it
  would need its own ADR through 20's process when Recall is actually
  scoped.
