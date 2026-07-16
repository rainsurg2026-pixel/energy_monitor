# Business Workflow Consolidation Audit (v3.1, ADR-036)

**Status: audit only. No code, schema, migration, API, or UI change.**
This is a second, sharper pass over the same ground ADR-035
(`BUSINESS_WORKFLOW_UX_AUDIT.md`) covered, now against the precise
Factory/Tractor-IN/NTR field-scope rules this milestone states
explicitly. It does not repeat ADR-035's nav/sidebar findings where
unchanged - it cross-references them - and adds what only a
field-level source-of-truth check could surface: **the platform's
current code actively contradicts the stated Tractor IN field-scope
rule, on two of five fields, by deliberate design (ADR-029)**, not
accident. Full field-by-field verdicts: `docs/architecture/
BUSINESS_INVARIANTS.md` (new companion document this pass creates).

## 1. Business Workflow Audit

Stage by stage, against this milestone's own 15-stage lifecycle
(Factory → Tractor IN → Import Inspection → MSEAL Stock → Ship to
Dealer → Dealer Stock → NTR → Warranty Activation → Machine Passport →
PM → Machine Problem → MQR → Repair → MQR Closed → [later] Troubleshooting
→ Technical Review → Knowledge Base → Product Improvement):

| Stage | Implemented? | Evidence |
|---|---|---|
| Factory | N/A (external) | Not this platform's concern |
| Tractor IN (Factory Master) | **Implemented, but over-scoped** | `tractorInSyncService.ts` writes 6 fields, 2 beyond the stated 5-field whitelist - see `BUSINESS_INVARIANTS.md` |
| Import Inspection (MSEAL PDI) | Implemented | `/delivery/pdi/*`, `inspections` table (ADR-017/028) |
| MSEAL Stock | **Dead** | `delivery_records.stage='StockYard'` exists, no UI since ADR-031 |
| Ship to Dealer | **Not modeled** | No stage, field, or event anywhere |
| Dealer Stock | **Dead** | `delivery_records.stage='DealerPreparation'` exists, no UI since ADR-031 |
| New Tractor Delivery (NTR) | Implemented | `/ntr/*`, `ntr_records` |
| Warranty Activation | Implemented (automatic) | `ntrPostCreateOrchestration.ts` - correct trigger, but not immutable (see BUSINESS_INVARIANTS.md) |
| Machine Passport (Vehicle 360) | Implemented | `/machines/*` |
| Preventive Maintenance | Implemented, **dealer field transitively wrong** | `/pm-records/*` - dealer sourced from `vehicles.dealer_id`, which is Tractor-IN-sourced, not NTR-sourced |
| Machine Problem → MQR | Implemented, **no NTR auto-fill** | `/records`, `/report` - dealer is session/manual only, no NTR lookup |
| Repair | **Already implemented** | `StatusValue` includes `'Repaired'` - no gap, no new work needed |
| MQR Closed | **Already implemented** | `StatusValue` includes `'Closed'` - no gap |
| Troubleshooting (auto-draft) | Not built (correctly out of phase) | No table, no service - matches "Do NOT implement" instruction |
| Technical Review | Not built (correctly out of phase) | No table, no service |
| Knowledge Base | Implemented, fed manually | `/quality/knowledge`, fed directly from a closed Quality Case today, not from a Troubleshooting draft (which doesn't exist yet) |
| Product Improvement | Not built (correctly out of phase) | Coming Soon placeholder only |

**This audit's one material correction to ADR-035**: that audit did not
distinguish Repair/MQR Closed as already-solved (it treated the whole
"Machine Problem → MQR → Troubleshooting → Knowledge" chain as one
block). This pass confirms Repair and MQR Closed require **zero** new
work - they are the `'Repaired'`/`'Closed'` values `StatusValue`
already has.

## 2. Sidebar Recommendation

Confirms ADR-035's recommended lifecycle-ordered hierarchy
(`BUSINESS_WORKFLOW_UX_AUDIT.md` §3) - not repeated in full here. One
addition specific to this pass's sharper field-scope findings: the
"Delivery Lifecycle" group ADR-035 proposed (MSEAL Stock/Ship to
Dealer/Dealer Stock, all Coming Soon pending a revive-or-retire
decision) should carry an explicit UI note once/if revived, that Dealer
and Delivery Date shown there must read from NTR, never from Tractor
IN - so the same field-scope violation isn't quietly rebuilt into a
new screen.

## 3. Source-of-Truth Matrix

| Field | Stated Source of Truth | Actual Source Today | Verdict |
|---|---|---|---|
| `vehicles.serial` | Tractor IN | Tractor IN (`tractorInSyncService.ts`) | Holds |
| `vehicles.engine_number` | Tractor IN | Tractor IN | Holds |
| `vehicles.model` | Tractor IN | Tractor IN | Holds |
| `vehicles.product_code` | Tractor IN | Tractor IN | Holds |
| `vehicles.wh_arrival_date` | Tractor IN | Tractor IN | Holds |
| `vehicles.dealer_id` | Latest Approved NTR | **Tractor IN only** (NTR never writes it) | **VIOLATED** |
| `vehicles.delivery_date` | Latest Approved NTR | NTR writes it, but Tractor IN can overwrite it afterward | **VIOLATED (immutability)** |
| Customer (name/phone) | Latest Approved NTR | `ntr_records` (correct); PM/MQR each keep their own independent per-visit snapshot (correct, per Service/Quality History rule) | Holds |
| Warranty status | Computed from `vehicles.delivery_date` | `calcWarranty()` | Holds (mechanically), at risk (input not immutable) |
| PM's Dealer | Latest Approved NTR (per PM's own stated rule) | `vehicles.dealer_id` (transitively Tractor-IN-sourced) | **VIOLATED (transitively)** |
| MQR's Dealer | Latest Approved NTR if it exists, else manual | Session/manual only, no NTR lookup | Not implemented (gap, not violation) |

## 4. Business Rule Matrix

| Rule | Holds? | Notes |
|---|---|---|
| Vehicle Identity = Serial Number | Holds | |
| Vehicle Master = `public.vehicles` | Holds | Confirmed in ADR-032, re-confirmed here |
| Warranty Identity = Vehicle | Holds | No customer reference in `calcWarranty()` |
| Warranty Start = Delivery Date | Holds mechanically | Same field the immutability rule below is at risk on |
| Delivery Date immutable after Warranty activation | **VIOLATED** | No guard against a later Tractor IN sync overwrite |
| Document Submission Date never affects Warranty | Holds | No submission timestamp reaches `calcWarranty()` |
| Factory Data never overwrites Operational Data | **VIOLATED** (`dealer_id`) | Same root cause as the Source-of-Truth violations above |
| Operational Data may extend Factory Data | Holds where checked | NTR extends `delivery_date`/`product_family_id` correctly |
| Service History never overwrites Operational Data | Holds | No PM write path touches `ntr_records`/`vehicles` |
| Quality History never overwrites Operational Data | Holds | No MQR write path touches `ntr_records`/`vehicles` |

## 5. Write Precedence Matrix

Who is allowed to write which field, and in what order, per the stated
rules vs. what the code actually enforces today:

| Field | Stated Precedence | Enforced Today? |
|---|---|---|
| `model`/`engine_number`/`product_code`/`wh_arrival_date` | Tractor IN only, always wins | Yes - only one writer exists |
| `dealer_id` | NTR should be the only writer | **No** - Tractor IN is the only writer; NTR never writes it at all |
| `delivery_date` | NTR writes once (Warranty Activation); Tractor IN must never write it again afterward | **No** - Tractor IN can rewrite it on every sync, unconditionally, with no "already activated" check |
| `customer_name`/`customer_phone` | NTR writes at delivery; PM/MQR keep independent snapshots, never write back | Yes |
| Warranty status | Computed, read-only, no direct writer | Yes |

**The single fix that resolves the most violations at once**: add one
guard to `tractorInSyncService.ts`'s update path - once a vehicle has a
real NTR-set `delivery_date`, the sync must stop overwriting
`delivery_date` and must stop writing `dealer_id` at all (reverting
that one field to NTR-only, per ADR-029's `dealer_id` scope needing to
be reopened). This single, scoped change closes the Source-of-Truth
Matrix's two VIOLATED rows and the Business Rule Matrix's two VIOLATED
rows together - they share one root cause.

## 6. Screen Flow Matrix

| Screen | Reads From | Writes To | KEEP/MOVE/MERGE/REMOVE/AUTOMATE |
|---|---|---|---|
| `/delivery/pdi/*` | `inspections`, `vehicles` | `inspections` | KEEP |
| `/ntr/new` | `vehicles` (search) | `ntr_records`, `vehicles.delivery_date`/`product_family_id` (via orchestration) | KEEP |
| `/machines/[machineId]` | Every domain's summary provider | none (read-only) | KEEP, MOVE (own top-level nav entry, per ADR-035) |
| `/pm-records/new` | `vehicles.dealer_id`/`branch_id` (transitively wrong source, §3) | `pm_records` | KEEP the screen; **fix the underlying field source**, not the screen |
| `/records`, `/report` | Session dealer, free-typed customer | `records` | KEEP; **AUTOMATE** the NTR auto-fill (Roadmap item, not this PR) |
| MSEAL Stock/Ship to Dealer/Dealer Stock screens | n/a - don't exist | n/a | Decision pending (ADR-035 R-1) - not revived here |
| Troubleshooting/Technical Review screens | n/a - don't exist | n/a | Correctly not built this phase |

## 7. Automation Roadmap

Ordered by dependency, not by ease:

1. **Tractor IN scope guard** (Write Precedence Matrix's single fix,
   above) - closes the Source-of-Truth and Business Rule violations.
   Must land before any of the items below, since MQR/PM auto-fill
   would otherwise propagate the same wrong dealer downstream.
2. **MQR NTR auto-fill**: if a vehicle has a Latest Active (or, once
   clarified, Approved) NTR, auto-fill Dealer/Delivery Date/Customer on
   MQR creation; otherwise allow manual Dealer selection with
   Customer/Delivery Date optional - matches the stated MQR rule
   exactly, not built yet.
3. **Machine classification field** (Customer Machine/Dealer Stock/
   MSEAL Stock/Demo Machine) - a genuine new field MQR's own stated
   rule depends on ("Support Customer Machine/Dealer Stock/MSEAL
   Stock/Demo Machine"); does not exist today.
4. *(Future phase, explicitly out of scope this pass)*: Troubleshooting
   auto-draft generation from a completed MQR, Technical Review,
   Parts Used, Knowledge Base automation, Product Improvement
   automation - named here only so they are not lost, not scoped or
   designed.
5. *(Future phase, named for completeness)*: the stated future rule -
   "if MQR is closed with Repair Type = Replacement, Parts Used must be
   completed before Troubleshooting can be finalized" - depends on
   three things that don't exist yet (Repair Type field, Parts Used
   capability, Troubleshooting itself); recorded as a roadmap
   dependency chain, not designed here.

## 8. Remaining Business Gaps

- **"Approved NTR" has no backing status model** - `ntr_records.
  record_status` is `'Active' | 'Deleted'` only, no approval workflow.
  Needs a business decision on what "Approved" means before item 2 of
  the roadmap can be built correctly (see `BUSINESS_INVARIANTS.md`).
- **No machine-type/status classification** (Customer Machine/Dealer
  Stock/MSEAL Stock/Demo Machine) exists in the schema - MQR's stated
  "Support" rule cannot be fully honored until this exists.
- **MSEAL Stock/Ship to Dealer/Dealer Stock** remain unresolved from
  ADR-035 - revive or formally retire, still not decided.
- **Repair Type field and Parts Used** do not exist - both are
  prerequisites for the stated future MQR-closure business rule, and
  both are explicitly out of scope this phase.

## 9. Prioritized Implementation Plan

| Priority | Item | Type | Depends On |
|---|---|---|---|
| P0 | Tractor IN scope guard (stop writing `dealer_id`/re-writing `delivery_date` after NTR activation) | Fix | Business owner confirms Tractor IN sheet's date-column meaning (ADR-035 R-0) |
| P1 | Reopen ADR-029's `dealer_id` sync-scope decision formally | Architecture decision | P0 |
| P2 | Decide MSEAL Stock/Ship to Dealer/Dealer Stock fate | Business decision | ADR-035 R-1 (unchanged) |
| P3 | Clarify "Approved NTR" - does an approval workflow need building, or does "Active" already mean this | Business decision | none |
| P4 | MQR NTR auto-fill (Dealer/Delivery Date/Customer) | New capability | P0, P3 |
| P5 | Machine classification field (Customer/Dealer Stock/MSEAL Stock/Demo) | New capability | none |
| P6 | Constitutional Amendment - elevate this document's confirmed-holding invariants (Vehicle Identity, Warranty Identity, Warranty Start) into `PLATFORM_CONSTITUTION.md`'s Data Principles, through its own required amendment process | Governance | Explicit human approval, per the Constitution's own rules |
| P7+ | Troubleshooting, Technical Review, Parts Used, Knowledge/PIP automation | Future phase | P3, P4 |

None of P0-P7 is implemented by this document. Each requires its own
future PR and explicit approval.

## Documentation updated this pass

- `docs/architecture/BUSINESS_INVARIANTS.md` (new) - the precise,
  field-level rule statements and current-state verdicts.
- `docs/adr/ADR-036-Business-Workflow-Consolidation.md` (new) - decision
  record.
- `docs/adr/README.md` - ADR-036 row added.
- `docs/architecture/PROJECT_STATE.md` - current milestone updated.

`docs/ROADMAP.md` and `PLATFORM_CONSTITUTION.md` were reviewed and
deliberately **not** modified this pass: `docs/ROADMAP.md` is a
previously-flagged stale Sprint-era document out of scope for this
audit to rewrite (this document's own §7/§9 are the current, accurate
roadmap for this specific initiative); `PLATFORM_CONSTITUTION.md`
requires its own Architecture Review + Governance Review + Explicit
human approval before any amendment - recommended as Roadmap item P6,
not performed unilaterally here.

## Verification

Every finding in this document is either restated with a citation back
to `BUSINESS_INVARIANTS.md` (this pass's own field-level verification)
or to `docs/architecture/BUSINESS_WORKFLOW_UX_AUDIT.md` (ADR-035's
prior, still-valid nav/sidebar findings). No finding here was asserted
without a corresponding source-code check performed in this session.
