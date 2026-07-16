# Motion Guidelines

This platform uses very little animation by design - keep it that way
unless there's a specific, named reason.

## What exists today

- `animate-pulse` for loading skeletons (`Skeleton`,
  `admin/LoadingState.tsx`) - the only "content is loading" signal, don't
  add a spinner alongside it.
- Simple `transition`/`hover:` utility classes on buttons/cards/links
  (`.btn-*`, `Card`'s hover variants, `QuickActionCard`) - a subtle
  shadow/color shift on hover, nothing more elaborate.
- Sidebar's mobile drawer slide-in (`transform transition-transform`) -
  the one "real" motion in the app, functional (reveals/hides content),
  not decorative.
- SweetAlert2's own built-in modal transitions - not something this app
  controls or should try to override.

## What NOT to add

- No page-transition animations.
- No skeleton-to-content cross-fade beyond the plain swap already used.
- No animated chart entrances (Recharts' defaults are used as-is).
- No new motion library (Framer Motion, GSAP, etc.) without an ADR - this
  repo has none today and that's a deliberate gap
  (`.claude/rules/02-coding-standards.md`'s "no new dependency casually"
  rule applies here too).

## Prefer Skeleton Loading, avoid full-page spinners

Already the platform's convention (`admin/LoadingState.tsx`'s shimmer
rows); the new `Skeleton` component extends this to non-table contexts. A
full-page spinner is acceptable only for a genuine full-navigation
transition (there is no such spinner in this app today - Next.js's own
route transition is instant enough not to need one).
