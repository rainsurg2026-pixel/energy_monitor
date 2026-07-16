# Empty State Guidelines

## Never display "No Data" alone

Every empty state names: **why** it's empty (`reason`) and **what to do
next** (`nextStep`), plus an optional `action`. Use
`src/components/shared/layout/EmptyState.tsx` - required props enforce
this at the type level (`reason`/`nextStep` are not optional).

## Two flavors

- **Real empty** (a real query ran, returned zero rows) - default
  styling, e.g. "No import has been run yet" / "Run a Legacy Import from
  Machines > Legacy Import to see history here."
- **Coming Soon** (`comingSoon` prop) - dashed/muted styling, for a widget
  whose *data source doesn't exist yet* (no module/table/query) - e.g.
  Platform Overview's Active Warranty/Open PM/Recall widgets. Don't use
  this flavor for a real feature that just has zero rows today.

## Known exception, not yet fixed

`components/shared/admin/EmptyState.tsx` (a different, table-row-scoped
component) still defaults to "ไม่มีข้อมูล" ("No Data") - it's unused by
any screen today, so left as a named cleanup item
(`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`'s Technical Debt) rather
than changed speculatively. Do not copy its default message pattern into
new code.

## Where this replaces "0"

A KPI with no real answer (see `DASHBOARD_GUIDELINES.md`) renders as a
Coming Soon `EmptyState`, not a fabricated "0" that looks like a real
measured value.
