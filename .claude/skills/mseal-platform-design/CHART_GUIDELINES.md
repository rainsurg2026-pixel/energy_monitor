# Chart Guidelines

## Every chart answers a named decision - otherwise remove it

Before adding a chart, write the one sentence it supports (e.g. "shows
whether backlog is growing so a manager decides to add capacity"). If you
can't write that sentence, don't add the chart.

## Use `ChartCard`

`src/components/shared/dashboard/ChartCard.tsx` requires a `decision`
prop - there is no way to render this wrapper without stating the
decision, by design. Existing charts on `/quality/dashboard` use the
page-local `Panel` helper with the same title+note shape; `ChartCard` is
that same pattern promoted to a named, reusable component for any *new*
chart. Migrating `/quality/dashboard`'s existing `Panel` usages to
`ChartCard` is a small, low-risk follow-up, not required by this change.

## Library

Recharts only (`charts.tsx`) - no second charting library without an ADR
(`docs/TECH_STACK.md`'s existing rule). Chart types already in use:
`LineChart`, `BarChart`. Adding a new type (Pie/Area/etc.) is fine within
Recharts; don't add a dependency for it.

## Empty data

A chart with zero rows renders as an `EmptyState` (reason + next step),
not an empty chart canvas or a bare "no data" line - see
`/quality/dashboard`'s existing `ยังไม่มีข้อมูล` placeholders as the
precedent to match (and prefer the shared `EmptyState` component for any
*new* chart rather than repeating that inline string).
