# Responsive Guidelines

Desktop first, tablet adaptive, mobile optimized - matches
`docs/DESIGN_SYSTEM.md`'s existing Responsive Rules (not superseded,
just restated as a checklist here).

## Patterns already established - reuse, don't reinvent

- Grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-{3,4,5}` for KPI/widget
  rows (see Platform Overview, Quality Dashboard).
- Sidebar: fixed desktop aside, slide-in mobile drawer with overlay
  (`AppShell`/`Sidebar` - unchanged by this framework beyond grouping the
  nav content itself).
- Tables: horizontal scroll container (`overflow-x-auto`) at minimum;
  stacked-card-per-row is the longer-term target per `DESIGN_SYSTEM.md`
  for tables that don't fit a phone screen even scrolled (not built for
  every table yet - see `TABLE_GUIDELINES.md`).
- Touch targets: buttons/links meet the existing minimum tappable size
  already used across `.btn-*` classes - don't shrink a touch target to
  fit more content.

## New widgets in this framework

All seven widgets (`WIDGET_GUIDELINES.md`) render at a `Card`'s natural
width and stack via the grid patterns above - none introduces a new
breakpoint or responsive behavior of its own.
