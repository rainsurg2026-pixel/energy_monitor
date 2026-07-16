# Machine Data Ownership

v1.2 (drift correction - see "Documentation correction" below; v1.0/v1.1
field ownership otherwise unchanged). Every field the Machine Digital
Passport shows, where it actually comes from, and - honestly, not
optimistically - which fields it *can't* show yet because no owning
table/column exists. Written so a future contributor never has to grep the
schema to find out whether a gap is a bug or a known, documented limit.

> **v3.1 note (ADR-033, proposed, not yet approved or built):** this
> file's own "Ownership has no identity table"/"Owner History" gaps,
> below, have a proposed fix - see `docs/architecture/
> CUSTOMER_OWNERSHIP_PROPOSAL.md`. Nothing below is resolved yet; this
> pointer exists so a future reader checks the proposal's status before
> assuming the gap is still fully open or already closed.

## Principle: the Passport owns nothing

`MachineService` and every Passport panel are a read-only aggregation
layer, same as Vehicle 360 before it. No new table was created for this
build. Every field below is either read from an existing table/column, or
computed from existing fields (`calcWarranty()`, `OPEN_STATUSES`
membership) - or it is a documented gap.

## Field ownership

| Passport field | Owning source | Notes |
|---|---|---|
| Serial Number | `vehicles.serial` | Natural key, synced from Tractor-IN sheet |
| Engine Number | `vehicles.engine_number` | |
| Model | `vehicles.model` | |
| Product Family | `product_families` (via `vehicles.product_family_id`) | |
| Variant | Displayed from `vehicles.sub_model`; `NtrRecord.variant` also exists but is not yet the Identity source (see "Documentation correction" below) | Two real sources, not one - `vehicles.sub_model` is the closest always-populated analog; `NtrRecord.variant` is a genuine "Variant" column but sparse |
| Manufacturing Year | Exists on `NtrRecord.manufacturing_year` but not yet wired to Identity (see "Documentation correction" below) | Sparse (Legacy Import only) - displayed as "not tracked yet" until promoted to a reliable source |
| Manufacturing Country | — | **Gap** - no column anywhere (the one field in this row group with no real source at all) |
| Current Owner / Owner Phone | Latest MQR/PM/NTR record's `customer_name`/`customer_phone` | Derived read-time, not a stored FK - see "Ownership has no identity" below |
| Owner History | — | **Gap** - no ownership-history table |
| Dealer / Branch | `vehicles.dealer_id`/`branch_id` (resolved to names via `dealers`/`branches`) | |
| Region | — | **Gap** - no `region` column on `dealers`/`branches`/`vehicles` |
| Warranty Status/Age/Limit | Computed by `calcWarranty()` off `vehicles.delivery_date` (`'powertrain'` coverage) | No dedicated warranty table - see below |
| Warranty Claims | `records` (MQR) rows with a non-null `warranty_status` | Per-complaint snapshot, not a claims ledger |
| PM Completed/History | `pm_records` for this serial | |
| PM Upcoming/Overdue/Compliance | Computed by `MaintenanceDueService`/Vehicle 360 aggregation | Existing logic, not re-derived |
| Quality Open/Closed/Critical/Cases | `records` (MQR) for this serial, `OPEN_STATUSES`/`severity` | |
| Documents/Photos | `AttachmentService` (ADR-010) across this machine's MQR/PM/NTR records | Split into Photos/Other by MIME type, not a real document-category field (see Gaps) |
| Activity Timeline | `record_audit_log` across this machine's MQR/PM/NTR records | New bulk read (`listAuditLogForRecords`), same table/shape as every other `<ActivityTimeline>` consumer |
| Milestone timeline | `vehicle_events` (existing, unchanged) | |

## Documentation correction: Variant / Manufacturing Year

The v1.0/v1.1 versions of this document claimed "no column exists
anywhere" for both Variant and Manufacturing Year. That claim was wrong,
found during the PR #39 pre-merge review: `NtrRecord`
(`features/ntr/types/index.ts`) has carried `variant: string | null` and
`manufacturing_year: number | null` since NTR was built. This section
resolves that drift - the data model itself is **not** changed by this
correction, only the documentation.

**Current Source of Truth**: `NtrRecord.variant`/`NtrRecord.manufacturing_year`,
populated only by Legacy Import (`ntrImportService.ts`). The current
manual NTR registration form (NTR Form Update, 2026-07) does **not**
collect either field - see that migration's own comment in
`features/ntr/types/index.ts`. Practically: a machine registered before
the 2026-07 form change may have real values here; a machine registered
after does not. Because coverage is partial and depends entirely on
*when* a machine was registered (not on anything about the machine
itself), these two fields are **not** promoted to the Identity section
today - Identity still reads Variant from `vehicles.sub_model` (always
populated, but not a true "Variant" concept) and renders Manufacturing
Year as "not tracked yet," exactly as before this correction. Displaying a
sparse, registration-date-dependent field as if it were reliable machine
data would be a worse failure mode than showing "not tracked yet"
consistently.

**Future Source of Truth (undecided, flagged for a future architecture
pass - not resolved by this correction)**: two candidate directions exist
and neither is chosen here:

1. **Re-add both fields to the manual NTR registration form** and treat
   `NtrRecord` as the authoritative per-registration source - consistent
   with NTR already being the point where a machine's delivery/retail
   date and customer are captured.
2. **Promote both fields to `vehicles`** (Tractor-IN sheet master data),
   treating them as machine-level attributes captured once at import
   time rather than per-registration-event data - consistent with how
   Serial/Engine Number/Model already live there.

Which of these (or a third option) is correct depends on a business
question this document can't answer alone: is Variant/Manufacturing Year
a property of the *physical machine* (favors option 2) or of the
*registration transaction* (favors option 1, and would need a defined
rule for what happens if a machine is re-registered with different
values). Recommended next step: raise this with whoever owns the NTR Form
Update decision before writing a migration either way.

## Ownership has no identity table

There is no `customer_id` foreign key anywhere in this schema - "Owner" is
always a free-text `customer_name`/`customer_phone` snapshot on whichever
MQR/PM/NTR record happens to be most recent for the serial. Two
consequences, both inherited unchanged from Vehicle 360 (not introduced by
the Passport):

- Two records for the same real customer with slightly different
  spelling/formatting of their name are indistinguishable to the system -
  there is no canonical Customer entity to de-duplicate against.
- "Owner History" (a list of past owners over time) cannot be built
  without either a new Customer entity + FK, or a purpose-built ownership-
  transfer event (the milestone timeline's type list already reserves
  `Other` for exactly this kind of not-yet-modeled event, but no module
  writes it today).

Both are called out as gaps, not solved here - solving them is a Customer/
Owner Identity Platform-sized decision, out of scope for "add the
Passport page."

## No dedicated Warranty table

Warranty status shown on the Passport is **computed**, not stored:
`calcWarranty(deliveryDate, today, 'powertrain')` (`lib/warranty.ts`,
unchanged, pre-existing) evaluates delivery date against a fixed 48-month
powertrain limit every time the page loads. There is no
`warranty_policies`/`warranty_claims` table - "Claims" on the Passport is
really "MQR records that happen to have a `warranty_status` recorded,"
which is a byproduct of the MQR workflow, not a first-class warranty
claim record (no claim number, no approval workflow, no reimbursement
tracking). A real Warranty module (already on the roadmap per
`docs/ROADMAP.md`'s "Next Development Phase" priority order) would own
this properly; this Passport reads what already exists rather than
inventing a stand-in table.

## Documents have no category field

`AttachmentService`/`attachments` table (ADR-010) stores `filename`/
`mimeType`/module/entity linkage - it has no "this is a Registration doc"
vs. "this is an Invoice" vs. "this is a Warranty doc" tag. The Passport's
Documents section approximates this with a MIME-type split (images vs.
everything else) purely as a display heuristic - it is not a real document
taxonomy, and should not be read as one by a future caller.

## Summary of genuine gaps (not fabricated, not silently dropped)

1. Manufacturing Country - no column anywhere (unlike Manufacturing
   Year, this one has no source at all, sparse or otherwise).
2. Region - no column on `dealers`/`branches`/`vehicles`.
3. Owner History - no ownership-history table, no Customer entity.
4. A dedicated Warranty table (policies/claims) - status is computed, not stored.
5. A document category/taxonomy field on attachments - MIME type is a heuristic stand-in.

Every one of these renders honestly in the UI ("not tracked yet" / "not
available") rather than a fake or guessed value.

Manufacturing Year and a true Variant field are **not** in this list
anymore - they exist (sparsely, on `NtrRecord`), which is a different
kind of problem (unreliable/partial coverage, not "no column"). See
"Documentation correction" above.
