# Business Architecture Consolidation (v3.1, ADR-037)

**Status: audit only. No code, schema, migration, API, or UI change.**
This is the third and final pass over the same ground ADR-035 (`PR
#57`) and ADR-036 (`PR #58`) covered. It does not re-derive their
findings - it resolves the one open conflict both named (via ADR-037's
formal amendment) and adds the deliverables neither produced: a
Permission Audit, an expanded Screen Flow Matrix (dead ends/duplicate
flow), an Implementation Sequence, a Risk Assessment, and an extended
Automation Roadmap. Where content already exists, this document points
to it rather than restating it - see the cross-reference table below.

## Cross-reference to prior deliverables (not repeated here)

| Deliverable | Where it already lives |
|---|---|
| Business Workflow Audit | `docs/architecture/BUSINESS_WORKFLOW_UX_AUDIT.md` §1 (ADR-035), refined by `BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md` §1 (ADR-036) |
| Sidebar / Navigation Recommendation | `BUSINESS_WORKFLOW_UX_AUDIT.md` §3 |
| Source-of-Truth Matrix | `BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md` §3, now also `docs/business/FIELD_OWNERSHIP_MATRIX.md` (this pass, field-level detail) |
| Machine Lifecycle (state machine) | `docs/business/MACHINE_LIFECYCLE.md` (new, this pass) |
| Write Precedence Matrix | `docs/business/WRITE_PRECEDENCE_MATRIX.md` (new, this pass, domain-level) and `BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md` §5 (field-level instance) |
| Architecture Amendment | `docs/adr/ADR-037-Tractor-IN-Field-Scope-Amendment.md` (new, this pass) |

## Permission Audit

Every lifecycle stage, against the platform's actual current `Role`
set (`SuperAdmin`/`CentralAdmin`/`DealerAdmin`/`DealerUser` -
`Technician`/`Viewer`/Customer login do not exist in code today,
confirmed against `src/lib/types.ts` in ADR-034's own prior work, not
re-derived):

| Lifecycle Stage | MSEAL (`SuperAdmin`/`CentralAdmin`) | Dealer (`DealerAdmin`/`DealerUser`) | Admin (`SuperAdmin` only) | Future Customer |
|---|---|---|---|---|
| Tractor IN sync | System-triggered, no per-role UI | No access | Can trigger manually (`/api/admin/tractor-in/sync`, inline `SuperAdmin`-only check - not `canManageLegacyImport`, which was NTR Legacy Import's own predicate, retired with that feature, ADR-038, 2026-07-16) | N/A |
| Import Inspection | Full access (`canAccessImportInspection` = `seesAllDealers`) | **No access at all** - confirmed by design (`scope.ts`'s own comment: "Dealer users may never view, create, edit, or approve an Import Inspection record") | Same as MSEAL | N/A |
| MSEAL Stock / Ship to Dealer / Dealer Stock | Would be MSEAL/Dealer split once built | Would be Dealer-scoped once built | n/a | N/A |
| NTR (New Tractor Delivery) | Full access (all roles create/view NTR - no role restricts NTR creation) | Full access, dealer/branch-scoped | Full access | N/A - Customer has no login (frozen rule, ADR-033/034) |
| Warranty (computed) | Read | Read | Read | N/A - not customer-facing yet |
| Machine Passport | Read, any dealer | Read, own dealer/branch scope | Read, any dealer | N/A |
| PM | Full access | Full access, own scope | Full access | N/A |
| MQR | Full access; `canDelete` = `SuperAdmin`/`DealerAdmin` only (not `CentralAdmin` - existing, unaudited-for-correctness behavior, restated as found) | Full access, own scope; cannot delete unless `DealerAdmin` | Full access | N/A |
| Knowledge Base | Full access; `canReviewKnowledge` = `seesAllDealers` only for the review/approval step | Can view/contribute evidence, cannot review/approve (matches Knowledge's own Human Feedback Loop design, ADR-018 - not a new finding) | Full access | N/A |
| Troubleshooting / Technical Review / Product Improvement | Not built - no permission model exists yet | Not built | Not built | N/A |

**One inconsistency surfaced, not previously named**: `canDelete`
excludes `CentralAdmin` (`role === 'SuperAdmin' || role === 'DealerAdmin'`
only) while every other cross-dealer capability
(`canAccessImportInspection`, `canReviewKnowledge`, `canManageEmailHealth`)
uses `seesAllDealers` (`SuperAdmin`/`CentralAdmin`). This may be
intentional (deletion is a narrower power than cross-dealer visibility)
or an oversight - flagged as an open question for the permission model's
owner, not assumed either way, and out of this audit's authority to
change.

## Screen Flow Matrix (expanded)

Extends `BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md` §6 with the two
columns this milestone additionally asked for - Dead Ends and Duplicate
Flow:

| Screen | Next Step | Dead Ends | Duplicate Flow |
|---|---|---|---|
| `/delivery/pdi/new` | Completed inspection links to a Delivery Record (in principle - `DeliveryService` exists) or stands alone (in practice, since Delivery UI is dead) | **Yes** - an inspection has no reachable next screen once completed, since the Delivery lifecycle UI it would hand off to doesn't exist | None |
| `/ntr/new` | Vehicle now shows Delivered/Warranty Active on Machine Passport | None - clean handoff, confirmed automatic | None |
| `/machines/[machineId]` | User navigates to any domain section from here | None - terminal lookup by design | None |
| `/pm-records/new` | Machine Passport's PM section reflects the new record | None | None |
| `/report` (MQR create) | `/records/[jobId]` detail; eventually `Repaired`/`Closed` | None while MQR is open; **once `Closed`, no defined next step** - Troubleshooting doesn't exist, so a closed MQR case is a dead end today, matching the business lifecycle's own "(Future)" framing for what comes next | None |
| `/quality/knowledge/new` | Published Knowledge Case | None | None |
| MSEAL Stock/Ship to Dealer/Dealer Stock (would-be screens) | n/a | **Total dead end - the screens don't exist**, restated from ADR-035, not re-discovered | None - dead, not duplicated |

**No newly-discovered duplicate flow this pass** beyond ADR-035's
already-named PIP duplicate nav entry (D-1) - restated there, not
repeated here.

## Automation Roadmap (extended)

Builds on `BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md` §7 with the
specific chain this milestone names, none implemented:

```
NTR created
    ↓ (already automatic today)
Warranty Activated

MQR Closed
    ↓ (not built - future phase)
Troubleshooting Draft (auto-generated)
    ↓ (not built - future phase)
Technical Review (human gate)
    ↓ (not built - future phase)
Knowledge Draft
    ↓ (not built - future phase, human approval gate)
Product Improvement Candidate
```

Each arrow after "Warranty Activated" is unbuilt, by explicit
instruction ("This is roadmap only. Do not implement."). Named here
only so the dependency order is recorded accurately: Troubleshooting
Draft cannot be built before MQR Closed reliably signals completion
(already true today - `StatusValue`'s `Closed` state exists); Technical
Review cannot be designed before Troubleshooting Draft exists; Knowledge
Draft's automation depends on Technical Review's approval gate;
Product Improvement Candidate depends on Knowledge Draft's own approval
gate. A linear dependency chain, not four independent features.

The stated future business rule - "if MQR is closed with Repair Type =
Replacement, Parts Used must be completed before Troubleshooting can be
finalized" - sits inside this chain between MQR Closed and
Troubleshooting Draft, and itself depends on two fields that don't
exist yet (Repair Type, Parts Used) - see `docs/business/
FIELD_OWNERSHIP_MATRIX.md`'s gap table.

## Implementation Sequence

Strict dependency order - each item blocks the ones below it:

1. **Human approval of ADR-037's amendment** (this PR's own
   recommendation - APPROVE/REVISE, see below).
2. **Implement the Tractor IN scope guard** (ADR-037's decision,
   `BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md`'s P0) - the one code
   change every other Operational-Data-integrity item depends on.
3. **Business clarification of "Approved NTR"** (P3) - needed before
   MQR auto-fill can be built against the right definition of "latest
   NTR."
4. **MQR NTR auto-fill** (P4) - depends on 2 and 3.
5. **Machine classification field** (P5) - independent, can run in
   parallel with 3/4.
6. **Decide MSEAL Stock/Ship to Dealer/Dealer Stock's fate** (ADR-035's
   R-1, still open) - independent of the above, its own business
   decision.
7. **Constitutional Amendment** (P6) - elevating the confirmed-holding
   invariants into `PLATFORM_CONSTITUTION.md` - can happen any time
   after item 1, since it only records what's already confirmed true,
   not something still being decided.
8. **Future phase** (Troubleshooting/Technical Review/Knowledge
   automation/Product Improvement/Parts Used) - depends on 3 and 4 at
   minimum, explicitly not scoped or designed in this document.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Warranty Start silently shifts if the Tractor IN scope guard (item 2) is delayed | **High** - real financial/legal exposure (a machine could show in or out of warranty incorrectly) | Prioritize item 2 above all other roadmap work once ADR-037 is approved |
| "Approved NTR" ambiguity causes the wrong record to be treated as authoritative once auto-fill (item 4) is built | Medium | Resolve item 3 explicitly before building item 4 - do not assume "Active" silently means "Approved" |
| MSEAL Stock/Dealer Stock remaining dead indefinitely erodes trust in the platform's own lifecycle claims | Medium | Force an explicit decision (item 6) rather than let it default to "still pending" indefinitely |
| A future Troubleshooting/Parts-Used build reuses the same unguarded overwrite pattern found in Tractor IN sync | Low today (nothing built yet) but **will become High** if item 8 is designed without referencing this document's Write Precedence rule | Every future PR touching cross-domain writes must cite `docs/business/WRITE_PRECEDENCE_MATRIX.md` before merging |
| Constitutional Amendment (item 7) delayed indefinitely, leaving confirmed invariants undocumented at the highest governance level | Low | Not urgent - these invariants are already documented and enforced in spirit via `BUSINESS_INVARIANTS.md`; the Constitution amendment is a formalization, not a functional gap |

## Recommendation per architecture decision

| Decision | Recommendation |
|---|---|
| ADR-037 (Tractor IN Field Scope Amendment - narrow scope, `dealer_id` only pre-NTR) | **APPROVE** |
| Reviving MSEAL Stock/Ship to Dealer/Dealer Stock UI (ADR-035 R-1) | **REVISE** - not enough information in this audit alone to recommend build-vs-retire; needs the business owner's input on whether these stages have real operational value today |
| MQR NTR auto-fill (P4) | **APPROVE in principle**, implementation gated on P3's clarification |
| Machine classification field (P5) | **APPROVE** - low-risk, additive, no conflicting rule found |
| Constitutional Amendment elevating confirmed invariants (P6) | **APPROVE**, non-urgent - schedule whenever the Constitution is next reopened for any reason, no need to force a standalone amendment cycle just for this |
| Troubleshooting/Technical Review/Knowledge automation/Parts Used (future phase) | **REVISE** - not enough is decided yet (Repair Type, Parts Used, and the automation trigger rules all remain undesigned) to recommend APPROVE on anything beyond the dependency order stated above |

## Verification

Every new claim in this document (Permission Audit, Screen Flow Dead
Ends/Duplicate Flow, Automation Roadmap chain, Implementation Sequence,
Risk Assessment) is grounded in `src/lib/scope.ts` (every exported
predicate read in full this pass), `src/features/maintenance/utils/
maintenanceLock.ts`, and the three companion documents this same pass
produced (`MACHINE_LIFECYCLE.md`, `FIELD_OWNERSHIP_MATRIX.md`,
`WRITE_PRECEDENCE_MATRIX.md`) plus ADR-035/036's prior findings, cited
not repeated.
