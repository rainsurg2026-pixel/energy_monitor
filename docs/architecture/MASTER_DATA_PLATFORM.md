# Master Data Platform

Current-state reference for `MasterDataService` - the one entry point
every business module uses for master/reference/lookup data. Binding
rules live in `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s "Master
data rules" section; this document is the inventory of what actually
exists today, kept in sync with the code.

## Architecture

```
Business Module
  ↓
MasterDataService (src/shared/master-data/MasterDataService.ts)
  ├── Address Platform   → AddressRepository → Supabase
  ├── Lookup Platform    → lookup/*.ts (own values, or re-exports from lib/types.ts / shared/attachments)
  ├── Configuration Platform → config/businessConfig.ts (env-overridable, lazy)
  └── Reference Data Platform → reference/referenceData.ts → lib/db.ts → Supabase
```

`MasterDataService` is the only public surface - a module imports it
from `@/shared/master-data`, never reaches into `address/`/`lookup/`/
`config/`/`reference/` directly (one documented exception: a Client
Component that only needs a small Lookup Platform value imports that
submodule directly rather than the full facade, to avoid bundling the
Address Platform's Supabase client code and Reference Data Platform's
`lib/db` import into browser JS - see `ntr-search.tsx`'s own doc
comment).

## Address Platform

See `docs/architecture/ADDRESS_PLATFORM.md` for the full reference.
Supabase-backed as of v1.2.1 (`docs/adr/ADR-011-Address-Platform.md`'s
v2 Supersession) - canonical `provinces`/`districts`/`subdistricts`
tables behind `AddressRepository`.

## Lookup Platform

Controlled-vocabulary values, one canonical source each:

| Lookup | Module | Source of values |
|---|---|---|
| Customer Type | `lookup/customerType.ts` | Own (Individual/Company) |
| Customer Title | `lookup/customerTitle.ts` | Own (Mr/Mrs/Ms) |
| Attachment Type | `lookup/attachmentType.ts` | Re-exports `shared/attachments`' `AttachmentType` |
| Severity / Priority | `lookup/severity.ts` | Re-exports `lib/types.ts`'s `Severity` (MQR's only priority-like classification - exposed under both names) |
| Status | `lookup/status.ts` | Re-exports `lib/types.ts`'s MQR `StatusValue`/transition rules |

`Severity`/`Status` are declared in `lib/types.ts` (Infrastructure)
rather than here, because `lib/db.ts` (also Infrastructure) is typed
against them and Infrastructure may not depend upward on this Platform
service - the Lookup Platform re-exports them (Platform depending
downward on Infrastructure is the allowed direction) rather than
duplicating the values. Not yet implemented (no consumer yet - added
only when a real module needs one, per the Architecture Evolution
Rule): Job Status/Workflow Status, Fuel Type, Machine Color.

## Configuration Platform

`config/businessConfig.ts` - env-overridable business-rule constants,
read lazily at call time (never throws before an optional override env
var is configured). Implemented: `getWarrantyLimitMonths(problemSystem)`
(48 months powertrain / 24 months other, overridable via
`WARRANTY_POWERTRAIN_MONTHS`/`WARRANTY_GENERAL_MONTHS`), consumed by
NTR's warranty-status filter (`supabaseNtrRepository.ts`). Not yet
implemented: Required Attachments/Upload Limits/Allowed File
Types/Default Language/Theme/Feature Flags/Workflow Settings - no
consumer yet.

## Reference Data Platform

`reference/referenceData.ts` - a thin pass-through to `lib/db.ts`'s
already-centralized dealer/branch/technician/product-family reads; it
does not re-implement data access, it exists so a module reaches
reference data through one platform-service entry point. Implemented:
`getDealers`/`getDealerById`/`getBranchesForDealer`/`getBranch`/
`getTechniciansForDealer`/`getActiveProductFamilies`/
`getProductFamilyById`. Not yet implemented: Machine Model/Failure
Codes/Warranty Codes - no consumer yet.

## Adding a new Lookup/Configuration/Reference Data item

Per the Architecture Evolution Rule
(`docs/architecture/MASP_ENTERPRISE_STANDARD.md`): only when a real
business module needs it, not speculatively. When one does:

1. Add the value/constant/query to the appropriate `address/`/`lookup/`/
   `config/`/`reference/` submodule (or a new file in that folder).
2. Expose it as a static member/method on `MasterDataService`.
3. Re-export any new public type from `src/shared/master-data/index.ts`.
4. Update this document's inventory tables above in the same PR.
