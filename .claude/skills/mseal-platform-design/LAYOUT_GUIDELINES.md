# Layout Guidelines

Pointer to `docs/UI_STANDARD.md`'s Layout/Header/Sidebar sections - not
duplicated here. The one addition from this framework:

## Navigation is now grouped

`AppShell` -> `PlatformHeader` + `Sidebar` is unchanged structurally.
What changed: `Sidebar` renders `navConfig.ts`'s `getNavGroups()` (Group ->
Item, optionally -> Subgroup) instead of a flat list plus two hardcoded
section headers. See `NAVIGATION_GUIDELINES.md`.

## Page shell composition (unchanged)

Every authenticated page: `PageHeader` (title/subtitle/actions) then
content in `Card`/`KpiCard`/`ChartCard`/tables as appropriate. Don't
invent a new page-title pattern - `PageHeader`'s props already cover every
shape used across the app (see its own header comment for the specific
per-page variations it already absorbs).

## Card variants (unchanged, frozen per `UI_STANDARD.md`)

`elevated` (tables/filter bars), `flat` (KPI/dashboard cards, detail
sections), `compact` (smaller detail pages) - pick the variant matching
what similar existing screens already use, not a new one.
