# Accessibility Guidelines

Target: WCAG AA. Pointer to `docs/UI_STANDARD.md`'s existing accessibility
work (branded `:focus-visible` ring, `globals.css`) - not superseded.

## Keyboard navigation

Every interactive element reachable and operable by keyboard alone - see
`FORM_GUIDELINES.md` for forms specifically. New widgets in this
framework (`QuickActionCard`, `NotificationCard`) are plain `<Link>`/
`<a>` elements - keyboard-focusable by default, no custom handling added
or needed.

## ARIA

- Use semantic HTML first (`<button>`, `<nav>`, `<table>`) - ARIA
  attributes are a supplement, not a replacement, for the wrong element.
- `Skeleton` carries `role="status" aria-label="Loading"` - reuse this
  exact pattern for any new loading indicator rather than a bare `<div>`.
- Disabled Coming Soon nav items carry `aria-disabled="true"` - see
  `Sidebar.tsx`'s `NavLink`.

## Focus

The existing branded `:focus-visible` ring (`globals.css`) applies
globally - don't suppress it (`outline-none` without a replacement) on
any new interactive element.

## Contrast

New widgets reuse existing Tailwind color tokens (brand red/dark, status
green/amber/red/blue/gray) already verified for contrast in prior
accessibility work - don't introduce a new color for a new widget without
checking it against this same bar.

## Screen reader

Icons in new widgets (`HealthCard`, `NotificationCard`, `QuickActionCard`)
are `aria-hidden="true"` decorative emoji next to real text labels - the
label, not the emoji, carries the meaning. Never rely on an emoji alone to
convey status.

## Not yet done (named, not hidden)

A full screen-reader pass and automated contrast check of the seven new
widgets has not been performed - see
`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`'s Technical Debt.
