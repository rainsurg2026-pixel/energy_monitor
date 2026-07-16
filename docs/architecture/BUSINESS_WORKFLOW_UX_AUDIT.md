# Business Workflow & UX Audit (v3.1, ADR-035)

**Status: Audit only. No code, schema, migration, API, or UI change.**
Every finding below is grounded in the current source
(`src/app/(app)/navConfig.ts`, the actual route tree, `lib/warranty.ts`,
`tractorInSyncService.ts`, `ntrPostCreateOrchestration.ts`,
`delivery/types.ts`) verified directly, not recalled from memory or
inferred from documentation alone. This document evaluates the
platform by the real lifecycle of a tractor, not by module boundary -
module/domain ownership itself was already audited in ADR-032
(`V3_FOUNDATION_HARDENING_AUDIT.md`); this document does not repeat
that pass, it builds on it.

## 1. Current Workflow Map

What the platform actually implements today, stage by stage, against
the tractor's real lifecycle:

```
Import Tractor
  └─ TractorInSyncService (background sync, Google Sheet → vehicles)
     No UI. No nav entry. Runs as a scheduled/manual sync job.
     ↓
Import Inspection (MSEAL)
  └─ /delivery/pdi, /delivery/pdi/new, /delivery/pdi/[id],
     /delivery/pdi/dashboard  — REAL, nav-reachable ("Quality Inspection" group)
     ↓
MSEAL Stock (DeliveryRecord.stage = 'StockYard')
  └─ Schema exists (delivery_records). NO UI. Dead since ADR-031.
     ↓
Ship to Dealer
  └─ NOT MODELED ANYWHERE. No stage, no field, no event.
     ↓
Dealer Stock (DeliveryRecord.stage = 'DealerPreparation')
  └─ Schema exists. NO UI. Dead since ADR-031.
     ↓
New Tractor Delivery (NTR)
  └─ /ntr, /ntr/new, /ntr/[id], /ntr/[id]/edit  — REAL, nav-reachable
     (nested under "Machines" group, not its own group)
     ↓
Warranty Activation (Warranty Start = Delivery Date)
  └─ AUTOMATIC — ntrPostCreateOrchestration.ts writes
     vehicles.delivery_date from the NTR record at creation time.
     No manual step, no dedicated screen. Correctly automated already.
     Nav shows "Warranty" as Coming Soon regardless (see Finding BR-3).
     ↓
Machine Passport (Vehicle 360)
  └─ /machines, /machines/[machineId]  — REAL, nav-reachable, correctly
     positioned as the one Vehicle 360 destination (ADR-030)
     ↓
Preventive Maintenance
  └─ /pm-records, /pm-records/new, /pm-records/[id], /pm-records/[id]/edit
     — REAL, nav-reachable ("Service" group)
     ↓
Machine Problem → MQR
  └─ /records ("Quality Cases"), /report (create), /records/[jobId]
     — REAL, nav-reachable ("Quality" group). /report has no direct
     nav entry, reached via a button on /records — same pattern as
     /pm-records/new and /ntr/new, not an anomaly.
     ↓
Troubleshooting (auto-created from completed MQR)
  └─ DOES NOT EXIST. No table, no service, no auto-creation logic.
     Nav shows it as a Coming Soon placeholder only.
     ↓
Knowledge Base / Product Improvement
  └─ /quality/knowledge — REAL, nav-reachable, but fed manually from a
     closed Quality Case (KnowledgeService.createCandidate()), never
     from a Troubleshooting record (which doesn't exist) - the
     business flow's own intermediate step is skipped entirely.
     PIP remains Coming Soon (and appears twice - see Finding D-1).
```

**Headline finding**: half of the expected lifecycle (Import Tractor
through New Tractor Delivery) has three consecutive stages - MSEAL
Stock, Ship to Dealer, Dealer Stock - with either dead schema or no
model at all. This is not a new regression; MSEAL Stock/Dealer Stock's
schema (`delivery_records`) was built in ADR-027 and its UI removed in
ADR-031 as confirmed dead code (already named in ADR-032's Technical
Debt Register). This audit's contribution is reframing that known fact
against the business lifecycle explicitly, and adding the two findings
ADR-032 did not surface: **Ship to Dealer has no model at all** (not
even dead schema), and the **Warranty Start = Delivery Date invariant
has a real overwrite risk** (Finding BR-1, below) that no prior audit
checked.

## 2. Recommended Workflow Map

```
Import Tractor (automatic sync, unchanged)
     ↓
Import Inspection (MSEAL)                              [KEEP]
     ↓
MSEAL Stock → Ship to Dealer → Dealer Stock
     Decision needed, not a default: either (a) revive the
     DeliveryRecord UI for these three stages, scoped down to what a
     real dealer/warehouse workflow needs today, or (b) formally
     retire delivery_records'/delivery_trainings' stock-yard/training/
     acceptance columns as unneeded speculative scope and update
     ADR-027/031 to say so explicitly. Either is fine; leaving it
     silently dead is not - see Roadmap item R-1.
     ↓
New Tractor Delivery (NTR)                              [KEEP]
     ↓
Warranty Activation - already automatic.                [AUTOMATE - done]
     Fix: stop the Tractor-IN sync from being able to overwrite an
     already-NTR-activated delivery_date (Finding BR-1) - a
     correctness fix, not a workflow change.
     ↓
Machine Passport (Vehicle 360)                          [KEEP]
     Elevate as a lifecycle-spanning lookup, not a lifecycle stage -
     see Recommended Sidebar Hierarchy, below.
     ↓
Preventive Maintenance                                  [KEEP]
     ↓
Machine Problem → MQR (Quality Case)                    [KEEP]
     ↓
Troubleshooting                                         [Decision needed]
     Either build the real auto-creation-from-completed-MQR workflow
     the business flow describes, or stop presenting it as "Coming
     Soon" (which implies it is scheduled/committed) and reclassify it
     as a genuinely undecided future capability - see Roadmap R-2.
     ↓
Knowledge Base / Product Improvement                   [KEEP + connect]
     Once Troubleshooting exists, Knowledge's candidate-creation should
     accept a Troubleshooting record as a source, not only a closed
     Quality Case directly - additive, not a redesign of Knowledge's
     existing model (Knowledge already accepts Evidence from any
     source per ADR-018 - see docs/architecture/KNOWLEDGE_PLATFORM.md).
```

## 3. Recommended Sidebar Hierarchy

Reorganized around the lifecycle, not the current module-by-module
grouping. `Vehicle Lookup` (Machine Passport) is deliberately pulled
out to the top - it is not one stage, it is the always-available
window into every stage for one machine, and burying it inside a
"Machines" group alongside NTR (a workflow step) is the single biggest
information-architecture mismatch found in the current nav.

```
🏠 Dashboard                          (unchanged - Platform Overview)

🚜 Vehicle Lookup                     (was: "Machines" group's Vehicle 360 item)
   └─ Vehicle 360 / Machine Passport  (/machines)

📦 Import & Inspection                (was: "Quality Inspection" group,
                                        renamed to match ADR-028's actual
                                        business term - see Finding T-1)
   ├─ Import Inspection Dashboard     (/delivery/pdi/dashboard)
   └─ Import Inspection               (/delivery/pdi)

🚚 Delivery Lifecycle                 (new group - names the currently-dead
                                        stages honestly instead of hiding them)
   ├─ MSEAL Stock                     [Coming Soon - decision pending, R-1]
   ├─ Ship to Dealer                  [Coming Soon - decision pending, R-1]
   ├─ Dealer Stock                    [Coming Soon - decision pending, R-1]
   └─ New Tractor Delivery (NTR)      (/ntr - moved out of "Machines")

🔧 Service
   ├─ Preventive Maintenance          (/pm-records)
   └─ Warranty                        (was Coming Soon - reclassify: warranty
                                        status/claims already exist inside
                                        Machine Passport; either link there
                                        directly or keep Coming Soon only for
                                        a *future dedicated* claims/policy
                                        module - not both meanings under one
                                        undifferentiated label, Finding BR-3)
   └─ (subgroup) Campaigns
       ├─ Service Campaign            [Coming Soon]
       └─ PIP                         [Coming Soon - ONE entry, not two, Finding D-1]

⚠️ Quality
   ├─ Quality Dashboard               (/quality/dashboard)
   ├─ Quality Cases (MQR)             (/records - label clarified, Finding T-2)
   ├─ Troubleshooting                 [Coming Soon - reclassified honestly, R-2]
   └─ Quality Analytics               [Coming Soon]

🧠 Knowledge & Engineering Intelligence  (merged - see Finding D-2)
   ├─ Knowledge Base                  (/quality/knowledge)
   ├─ AI Analysis                     [Coming Soon]
   └─ Prediction                      [Coming Soon]
   (PIP removed from here - lives once, under Service > Campaigns, above)

📊 Reports                            (unchanged - cross-cutting, not a
                                        lifecycle stage; stays last)

⚙️ Administration                     (unchanged)
```

Rationale for the two structural moves:

- **Vehicle Lookup separated from Delivery Lifecycle.** NTR is a
  workflow step with a start and an end (a specific delivery gets
  registered once); Machine Passport is a persistent lookup tool used
  at every single stage of a machine's life, before, during, and long
  after delivery. Grouping them together under "Machines" because both
  happen to concern a vehicle was the original nav's organizing
  principle (by entity); this audit's brief asks for organization by
  lifecycle, which puts them in different places.
- **Knowledge and Engineering Intelligence merged.** Today's split
  (Knowledge under Quality for "discoverability," Engineering
  Intelligence as its own group holding AI Analysis/PIP/Prediction) is
  independently correct at the *domain-ownership* level (Knowledge
  owns itself, per ADR-018 - not disputed here) but confusing at the
  *lifecycle* level: a technician following the tractor's story from
  "Machine Problem" to "Knowledge Base / Product Improvement" has to
  jump between two unrelated-looking nav groups to see the whole
  outcome. Merging their *navigation presentation* (not their data
  ownership - Knowledge's tables/service stay exactly where ADR-018 put
  them) closes that gap without touching architecture.

## 4. Screen-to-Workflow Matrix

| Route | Lifecycle Stage | Current Nav Location | Recommendation |
|---|---|---|---|
| (sync job, no route) | Import Tractor | none (no UI) | KEEP (correctly headless) |
| `/delivery/pdi/dashboard`, `/delivery/pdi`, `/delivery/pdi/new`, `/delivery/pdi/[id]` | Import Inspection (MSEAL) | Quality Inspection group | MOVE (rename group to "Import & Inspection", Finding T-1) |
| *(no route - dead schema)* | MSEAL Stock | none | AUTOMATE-or-REMOVE decision (R-1) |
| *(not modeled)* | Ship to Dealer | none | Decision needed - build or explicitly drop (R-1) |
| *(no route - dead schema)* | Dealer Stock | none | AUTOMATE-or-REMOVE decision (R-1) |
| `/ntr`, `/ntr/new`, `/ntr/[id]`, `/ntr/[id]/edit` | New Tractor Delivery | Machines group | MOVE (to Delivery Lifecycle group) |
| *(automatic, no route)* | Warranty Activation | n/a | KEEP (already automated) + fix BR-1 |
| `/machines`, `/machines/[machineId]` | Machine Passport (all stages) | Machines group | KEEP, MOVE (to its own top-level "Vehicle Lookup" entry) |
| `/pm-records`, `/pm-records/new`, `/pm-records/[id]`, `/pm-records/[id]/edit` | Preventive Maintenance | Service group | KEEP |
| `/records`, `/report`, `/records/[jobId]`, `/records/[jobId]/edit` | Machine Problem → MQR | Quality group ("Quality Cases") | KEEP, clarify label (T-2) |
| *(does not exist)* | Troubleshooting | Quality group (Coming Soon) | Decision needed - build or reclassify (R-2) |
| `/quality/knowledge` | Knowledge Base | Quality group | KEEP, MOVE (merge presentation with Engineering Intelligence) |
| *(Coming Soon, appears twice)* | Product Improvement (PIP) | Service > Campaigns AND Engineering Intelligence | MERGE to one entry (D-1) |
| `/dashboard` | Cross-cutting overview | Dashboard group | KEEP |
| `/quality/dashboard` | Quality overview | Quality group | KEEP |
| `/admin/*` (8 screens) | Master Data / Administration | Administration group | KEEP (out of lifecycle scope, unchanged) |
| `/profile/security` | Account | (header, not sidebar) | KEEP |

## 5. Feature Lifecycle Matrix

| Feature | Business Purpose | Entry Point | Exit Point | Dependencies | Current Sidebar | Correct Sidebar | Business Owner | Lifecycle Stage (build) |
|---|---|---|---|---|---|---|---|---|
| Tractor IN Sync | Populate `vehicles` from the authoritative import sheet | Scheduled/manual sync trigger | Writes `vehicles` master fields | Google Sheet, `vehicles` table | None | None (correct) | Import Platform | Production |
| Import Inspection (PDI) | MSEAL's own inbound quality check before stock/delivery | `/delivery/pdi/new` | `Inspection` record completed, linked from `DeliveryRecord` (today: standalone) | `inspections` table (ADR-017) | Quality Inspection group | Import & Inspection group | Quality/Import domain | Production |
| Delivery Lifecycle (Stock/Ship/Prep/Training/Acceptance) | Track a unit from MSEAL stock through dealer handover | *(none - dead)* | *(none - dead)* | `delivery_records`, `delivery_trainings` (ADR-027) | None | Delivery Lifecycle group (once revived) | Service/Delivery domain | **Dead** (schema only, since ADR-031) |
| NTR (New Tractor Delivery) | Register the actual customer delivery, capture customer + set warranty start | `/ntr/new` | `NtrRecord` created, `vehicles.delivery_date` set, warranty activated | `ntr_records`, `vehicles`, Customer resolution (v3.1, unimplemented) | Machines group | Delivery Lifecycle group | Service/NTR domain | Production |
| Warranty (computed) | Show current warranty status/age/claims for a machine | Machine Passport page load | n/a (read-only) | `calcWarranty()`, `vehicles.delivery_date`, MQR `warranty_status` | Service group (Coming Soon, misleadingly) | Linked from Machine Passport; Service group entry reclassified | Service/Warranty (no dedicated table) | Production (as a computed section) |
| Machine Passport / Vehicle 360 | One place to see everything about one machine, any stage | `/machines` search | n/a (terminal lookup) | `MachineService`, every domain's summary provider | Machines group | Vehicle Lookup (top-level) | Machine domain | Production |
| Preventive Maintenance | Scheduled/completed maintenance record-keeping | `/pm-records/new` | `MaintenanceRecord` created | `pm_records`, `pm_intervals`, `pm_programs` | Service group | Service group (unchanged) | Service/PM domain | Production |
| MQR (Quality Case) | Record and resolve a field quality complaint | `/report` | Case closed (`StatusValue` enum) | `records` table, Attachment Platform | Quality group ("Quality Cases") | Quality group (label clarified) | Quality domain | Production |
| Troubleshooting | Structured technical investigation for a hard quality problem | *(none)* | *(none)* | Not built - no table | Quality group (Coming Soon) | Quality group (Coming Soon, honestly labeled) | Quality domain (proposed) | **Not built** |
| Knowledge Base | Durable, evidence-backed cause/fix record, reusable across machines | Manual promotion from a closed Quality Case | Published Knowledge Case | `knowledge_cases`, `knowledge_evidence` (ADR-018) | Quality group | Knowledge & Engineering Intelligence group | Knowledge domain (independent) | Production |
| PIP (Product Improvement Plan) | Engineering deliverable produced from Knowledge/Quality patterns | *(none)* | *(none)* | Not built | Service > Campaigns AND Engineering Intelligence (duplicate) | Service > Campaigns (one entry only) | Engineering Intelligence | **Not built** |
| Customer Ownership | Real Customer identity, ownership history | *(none - schema only)* | *(none)* | `customers`, `customer_ownership_history` (ADR-033, Phase 1 only) | None | None yet (Phase 3+) | Customer domain (new) | Schema only, unused |

## 6. Business Rule Inconsistencies

### BR-1 — Warranty Start = Delivery Date is not protected against a later overwrite (HIGH)

`ntrPostCreateOrchestration.ts:42` correctly sets `vehicles.delivery_date`
from the NTR record at the moment of registration - this is the
platform's real "Warranty Activation" event, and it is correct. But
`tractorInSyncService.ts:204-208,230-251` documents itself as
"the sole vehicle master... every master field it carries is written
on both insert and update" and its update path (line 250-251:
`if (value) updatePayload[key] = value;`) overwrites
`vehicles.delivery_date` on **every subsequent sync run** whenever the
Tractor IN sheet's own delivery-date column is non-blank - with no
check for "this vehicle's delivery_date was already set by a real NTR
registration, do not touch it." If the Tractor IN sheet's date column
represents an import/logistics date rather than the true retail date
(a real possibility this audit cannot resolve without the business
owner confirming what that sheet column actually means), a routine
periodic sync occurring *after* an NTR registration would silently
shift a machine's warranty start date - the single business invariant
this milestone explicitly asked to verify. **Recommend**: confirm with
the Tractor IN sheet's business owner what that date column represents,
and if it can ever conflict with NTR's real retail date, add a guard
(e.g., never let the sync overwrite `delivery_date` once an NTR record
exists for that serial) - a scoped, low-risk fix, not a redesign.

### BR-2 — "Vehicle is the warranty identity" — confirmed, holds

`calcWarranty()` takes only `deliveryDate`/`foundDate`/`problemSystem`
- no customer reference anywhere in its signature or call sites
(`machine/service.ts:89`, `api/records/route.ts`, `ntrPdf.tsx`,
`ntrExcel.ts`, `report-form.tsx`). Warranty is unambiguously
Machine-keyed. **No inconsistency found** - stated here because the
milestone asked this invariant to be explicitly verified, not assumed.

### BR-3 — "Warranty" nav placeholder misrepresents an already-real capability (MEDIUM)

The Service group's `comingSoon(undefined, t('nav.warranty'))` entry
implies no warranty capability exists. In reality: activation is
already automatic (BR-2/the Recommended Workflow Map above), and
Machine Passport's Warranty section already shows live
status/age/remaining/coverage and a real Claims list sourced from MQR
records. The *only* thing genuinely missing is a dedicated
claims/policy management module (a claim number, an approval workflow,
reimbursement tracking - already named as a gap in
`MACHINE_DATA_OWNERSHIP.md`). Presenting the whole concept as "Coming
Soon" undersells what already works and could lead a business user to
believe warranty isn't tracked at all. **Recommend**: either point this
nav entry at Machine Passport's Warranty section, or split the label so
"Warranty Status" (real, today) and "Warranty Claims Management"
(genuinely Coming Soon) are not conflated under one badge.

### BR-4 — "Timeline is the single machine history" — partially holds, worth a UX note

Architecturally this is two deliberately separate mechanisms (Machine
Lifecycle milestones via `vehicle_events`, and the field-level Activity
Timeline via `record_audit_log`) - already confirmed non-duplicative at
the architecture level in ADR-032. From a *business user's* perspective,
though, Machine Passport renders both on the same page, both visually
called some form of "timeline" (§3 Lifecycle's milestone timeline, §11
Activity Timeline). A user with no reason to know the architectural
distinction may reasonably wonder why there are two different-looking
histories for one machine. **Not a data-integrity issue** - a labeling/
placement clarity issue worth a small copy fix (e.g., "Milestones" vs
"Activity Log"), out of scope for this docs-only audit to implement.

### BR-5 — "Vehicle Master remains the single source of truth" — confirmed, holds

Every domain (NTR/PM/MQR/Delivery/Inspection) reads `vehicles` by FK or
`serial`, none forks its own copy of model/engine/dealer data - already
established in ADR-032's audit and re-confirmed here against the same
files. **No inconsistency found.**

## 7. UX Issues

- **D-1 — PIP has two nav entries** (`Service > Campaigns > PIP` and
  `Engineering Intelligence > PIP`), both Coming Soon, despite
  `navConfig.ts`'s own comment claiming "It has exactly one nav entry" -
  that comment is only true relative to Quality, not relative to
  Service. Both entries point nowhere (`href: null`) today, so there is
  no functional bug, but it is a real duplicate-navigation defect that
  will confuse whoever eventually wires PIP to a real route (which one
  is authoritative?). **MERGE to one entry** (Recommended Sidebar,
  above - keep it under Service > Campaigns, since PIP escalates
  Quality/Knowledge findings into a service action).
- **D-2** - Knowledge and Engineering Intelligence's navigational
  separation, despite being one continuous business story
  (Problem → Knowledge → Improvement), covered in full under §3.
- **U-1 — Three names for one domain**: `docs/adr/ADR-028-Import-Inspection-Domain-Correction.md`
  calls the domain "Import Inspection"; `navConfig.ts`'s own group is
  labeled and commented as "Quality Inspection"; the underlying route
  path is still `/delivery/pdi` (a naming leftover from before ADR-028's
  correction). `docs/standards/DOMAIN_LANGUAGE_STANDARD.md` freezes
  neither term for this concept - a real, unresolved terminology gap,
  not a copy-editing nitpick, since it is the audit's own T-1 finding.
  **Recommend**: whoever owns `DOMAIN_LANGUAGE_STANDARD.md` picks one
  term and freezes it; this audit recommends "Import Inspection"
  (ADR-028's own corrected business term) since it is the more recent,
  deliberate decision.
- **U-2** - "Quality Cases" as the nav label for MQR is domain-correct
  (per the Blueprint's own "Quality Case" terminology) but gives a
  first-time user no clue this is where "MQR" lives, a term still used
  everywhere else in the platform (PDFs, exports, `nav.mqr`,
  `common.mqr`). **Recommend**: append "(MQR)" to the nav label, the
  same parenthetical pattern `docs/adr/README.md` itself already uses
  for e.g. "Customer Data Governance (v3.1, Phase 1.5)".
- **U-3** - Machine Passport's Ownership section still reads "Current
  Owner"/"Owner Phone" derived read-time from whichever of NTR/PM/MQR
  is most recent, exactly as `MACHINE_DATA_OWNERSHIP.md` already
  documents - this is expected, pre-existing, and gated behind ADR-033/
  ADR-034's own Legal/Compliance preconditions before it can change.
  Not a new finding, restated here only because it directly touches the
  Machine Passport screen this audit reviewed.

## 8. Architecture Impact

**None required by this audit.** Every recommendation above is either:
(a) a navigation/labeling change (`navConfig.ts`, locale strings) - no
domain, table, or service touched; (b) a business decision (revive vs.
formally retire the dead Delivery stages; build vs. reclassify
Troubleshooting) that has to be made by a human business owner before
any architecture work is scoped; or (c) the one real code fix named
(BR-1), which is a guard added to an existing sync function, not a
redesign. No existing domain ownership, table, or API changes as a
result of this document. If R-1 (revive Delivery Lifecycle UI) is
approved, that would be new feature work requiring its own ADR and PR -
explicitly out of scope here ("No new feature development").

## 9. Prioritized Implementation Roadmap

1. **R-0 (highest priority, smallest fix)**: Resolve BR-1 - confirm the
   Tractor IN sheet's delivery-date column meaning with its business
   owner, and if it can conflict with NTR's real date, add the guard.
   This is the one item on this list with genuine business risk
   (warranty dates) if left unresolved.
2. **R-1**: Decide the fate of MSEAL Stock/Ship to Dealer/Dealer Stock -
   revive a minimal Delivery Lifecycle UI, or formally retire that
   scope from ADR-027/031 and stop implying (via the schema's continued
   existence) that it's still planned.
3. **R-2**: Decide Troubleshooting's fate - build the real
   auto-creation-from-completed-MQR flow the business lifecycle
   describes, or reclassify its nav placeholder so "Coming Soon" isn't
   read as an active commitment.
4. **R-3 (low-effort, high-clarity)**: Nav-only fixes - merge the
   duplicate PIP entry (D-1), rename "Quality Inspection" to "Import
   Inspection" (U-1), clarify the "Quality Cases (MQR)" label (U-2),
   reclassify the Warranty placeholder (BR-3). None require schema or
   API changes; all are `navConfig.ts`/locale edits.
5. **R-4**: Move NTR out of "Machines" into a lifecycle-ordered
   "Delivery Lifecycle" group, and elevate Machine Passport to a
   top-level "Vehicle Lookup" entry (§3's structural recommendation) -
   a larger nav restructuring than R-3, still zero architecture impact,
   but touches every role's muscle memory, so it should land as its own
   reviewed change, not bundled silently into R-3's small fixes.
6. **R-5 (longer-term, contingent on business approval)**: Once
   Troubleshooting exists (R-2), wire Knowledge's candidate-creation to
   accept it as a source alongside closed Quality Cases - closes the
   business flow's "Knowledge auto-fed from Troubleshooting" gap for
   real, rather than the current direct-from-MQR shortcut.

None of R-0 through R-5 is implemented by this document. Each is a
separate future PR requiring its own explicit approval, per this
repository's own established practice.

## Verification

Grounded directly in: `src/app/(app)/navConfig.ts` (full file, current
source, not recalled), the complete route tree under
`src/app/(app)/` (verified via directory listing), `src/lib/warranty.ts`
(`calcWarranty()` signature and every call site), `src/features/vehicle/
services/tractorInSyncService.ts` (the update-path overwrite logic
behind Finding BR-1), `src/features/ntr/services/
ntrPostCreateOrchestration.ts` (the real Warranty Activation write),
`src/features/delivery/types.ts` (`DeliveryStage` enum, confirming the
exact 9-stage model), the current `src/app/(app)/delivery/` route
listing (confirming only PDI routes survive ADR-031's removal), and
`docs/standards/DOMAIN_LANGUAGE_STANDARD.md` (confirming neither
"Import Inspection" nor "Quality Inspection" is frozen there). Prior
findings this document restates rather than re-derives: ADR-032's
domain-ownership/dead-code audit, ADR-033/034's Customer Ownership
schema-and-governance status, `MACHINE_DATA_OWNERSHIP.md`'s existing
Owner-identity gap.
