# Machine Domain

Phase 5B (Maintenance Intelligence + Machine Domain + Media Platform) makes
**Machine** the platform business entity — not Vehicle, not Tractor. See
`docs/adr/ADR-009-Machine-Domain.md` for the decision record; this document
is the living reference for how the rename actually works in code.

## Product Hierarchy

```
Machine
  └─ Product Category   (e.g. Tractor - today's only category)
       └─ Product Family
            └─ Model
                 └─ Variant
                      └─ Serial Number
```

Future Product Categories: Harvester, Power Tiller, Implement, Engine — no
code change is required to add one; `product_families`/
`product_family_models` are already category-agnostic (a `Product Category`
column is the only gap, tracked as a future addition, not part of this
pass since exactly one category exists today).

## What changed, and what didn't

- **Database**: nothing renamed. `vehicles`, `vehicle_events`,
  `vehicle_health` (etc.) keep their existing names permanently — renaming
  live tables for a terminology change only, with no functional benefit,
  is exactly the kind of unnecessary migration this phase's spec calls out
  to avoid.
- **`src/features/vehicle/`, `src/features/vehicle-event/`,
  `src/features/vehicle-health/`**: untouched. There was no
  `VehicleRepository`/`VehicleService` class to rename in the first place —
  vehicle reads live as plain functions in `lib/db.ts`, and the Machine
  360 aggregation logic (provider merge, Health Score computation) lives
  in `vehicle/service.ts`. Rewriting/renaming that logic wasn't requested
  and carries real regression risk for a pure terminology change.
- **New: `src/features/machine/`** — a facade layer other code should
  depend on going forward:
  - `MachineService` (`service.ts`) wraps `vehicle/service.ts`'s
    `getVehicleSummary`/`getVehicleTimeline` as `getMachine360()`/
    `getMachineTimeline()`.
  - `MachineRepository` (`repository.ts`) wraps `lib/db.ts`'s
    `getVehicleBySerial`/`searchVehicles` for Machine Search.
  - `types.ts` re-exports `VehicleSummary`/`VehicleEvent`/etc. as
    `MachineSummary`/`MachineEvent`/etc. — type aliases, not new shapes.
- **UI**: `Vehicle360Page` (`src/app/(app)/vehicles/[serial]/page.tsx`)
  renamed to `Machine360Page` and now calls `MachineService` instead of
  importing `vehicle/service.ts` directly. User-facing strings for the
  aggregation-layer feature ("Tractor Profile" → "Machine 360", "Tractor
  Registry" → "Machine Registry", "Tractor Life Cycle"/"Tractor Health" →
  "Machine Timeline"/"Machine Health") were updated in both
  `src/locales/en.json` and `src/locales/th.json`. Route path (`/vehicles`)
  is unchanged — a URL change wasn't requested and would be a bigger,
  separate blast radius (bookmarks, links) than a business-terminology
  update.
- **`docs/standards/DOMAIN_LANGUAGE_STANDARD.md`**: this pre-existing,
  binding standard said "the primary business asset is Tractor, NOT
  Vehicle... User-facing UI must never use 'Vehicle'" and explicitly
  instructed to "stop and report the conflict" rather than introduce new
  terminology silently. Flagging that conflict here: Phase 5B's brief is
  an explicit, dated supersession of that rule ("Effective immediately...
  Machine becomes the ubiquitous language of MASP"), so the standard's
  Business Domain section, Official Menu Standard, and Official Business
  Terminology table were updated to describe Machine as the platform
  entity with Tractor demoted to "today's one Product Category" — not
  silently overwritten without a record of the change.

## Why a facade, not a rewrite

Renaming `src/features/vehicle/` → `src/features/machine/` and every
symbol inside it (`VehicleSummaryProvider` → `MachineSummaryProvider`,
etc.) would touch the provider registry, every module's own
`*SummaryProvider` implementation (Maintenance, MQR), and every import
site — dozens of files, for a change that is purely about the name
business/UI code sees, not the logic itself. The facade gets the same
result (all new code depends on "Machine") at a fraction of the
regression surface, and can still be promoted to a full rename later if a
second reason (not just naming) ever justifies touching that many files
at once.

## For a future module

Depend on `@/features/machine` (`MachineService`, `MachineRepository`,
`MachineSummary`, `MachineEvent`, ...), not `@/features/vehicle` directly,
for any new code. Contributing to Machine 360 itself still means
implementing `VehicleSummaryProvider` (aliased as `MachineSummaryProvider`)
and registering it in `src/features/vehicle/providers/registry.ts` — that
registry file is unchanged.
