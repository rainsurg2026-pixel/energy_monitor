# Table Guidelines

Every table works toward supporting: Search, Filter, Sort, Column
Visibility, Pagination, Bulk Action, Export, Responsive Layout.

## Current reality (be honest about this, don't claim more than exists)

`AdminCrudTable` is a thin shell (wrapper + `<table>` + header row from
`columns[]`) - it does **not** currently implement sort/filter/pagination
itself; each admin screen renders its own rows. `docs/COMPONENT_CATALOG.md`
and `docs/SHARED_UI_ANALYSIS.md` both confirm pagination is not
implemented as a shared pattern anywhere in the app today. This is a
real, pre-existing gap, not something this framework closes - see
`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`'s Migration Roadmap.

`@tanstack/react-table` is already a dependency (`package.json`) and is
used by exactly one feature today
(`src/features/maintenance/components/maintenance-history.tsx`) - it is
**not** yet the platform-wide table standard. When the sort/filter/
pagination gap above is finally closed, prefer extending that existing
dependency's usage rather than introducing a second table library or
reinventing pagination by hand.

## What to do until the full contract is built

- New tables: follow the existing admin-table pattern
  (`page.tsx` -> `*-table.tsx` -> `route.ts`, `docs/ADMIN_FRAMEWORK.md`)
  rather than inventing a parallel table system.
- If a new table genuinely needs sort/filter now, build it for that one
  table rather than trying to retrofit generic sort/filter into
  `AdminCrudTable` as a side effect - that's a scoped, reviewed effort of
  its own.
- Export: reuse `lib/exportExcel.ts`'s existing pattern (list/single/
  monthly-summary) rather than a new export mechanism.
- Responsive: mobile stacked-card-per-row (per `docs/DESIGN_SYSTEM.md`'s
  Tables section) for any new table wider than fits a phone screen -
  don't ship a table that only works with horizontal scroll on mobile.

## Bulk actions

No table has bulk selection today. If a new screen genuinely needs it,
design the selection-state pattern explicitly (checkbox column + a
sticky action bar) rather than a one-off inline solution.
