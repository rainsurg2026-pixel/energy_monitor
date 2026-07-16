# Visual Language (pointer - no new tokens introduced)

This framework is **not a visual redesign**. Every token below is
existing and unchanged; this file exists so an agent doesn't need to
re-derive them from `tailwind.config.ts`/`globals.css` every time.

## Tokens (`tailwind.config.ts`)

- Brand: `brand.red #c8102e`, `brand.redDark #9c0c24`, `brand.redLight
  #e63950`, `brand.dark #1a1d23`, `brand.gray #5b6168`.
- Status: `status.success/warning/danger/info/neutral` - aliases for the
  ad-hoc colors already used in per-module status maps (those per-module
  maps stay separate by design - see `StatusPill`'s own header comment).
- Radius: `rounded-card` (0.75rem), `rounded-control` (0.25rem).
- Shadow: `shadow-card`, `shadow-card-hover`, `shadow-glow`.
- Gradient: `bg-gradient-primary` (red), `bg-gradient-dark`.

## Class vocabulary (`globals.css`)

`.card`, `.card-interactive`, `.btn`, `.btn-primary`, `.btn-secondary`,
`.btn-outline-danger`, `.btn-ghost` - use these, never a one-off Tailwind
class combination that duplicates one of them.

## Icons

**No icon library** - inline SVG or emoji only (ADR-023 resolved the
prior `DESIGN_SYSTEM.md`/`TECH_STACK.md` contradiction that named Lucide
React; Lucide is not installed and should not be introduced without a new
ADR).

## Typography

One type scale, one font stack, applied through shared primitives
(`PageHeader`'s title classes, etc.) - don't introduce a new heading size
outside what `PageHeader`/existing pages already use.

## Charts

Recharts only - see `CHART_GUIDELINES.md`.
