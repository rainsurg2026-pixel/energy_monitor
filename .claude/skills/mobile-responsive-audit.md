# Skill: mobile responsiveness audit

Use when adding a new page/component, or asked to audit an existing one
for mobile.

## Checklist

1. Every layout uses mobile-first Tailwind (base styles target the
   smallest screen; `sm:`/`md:`/`lg:` add desktop overrides — never style
   desktop-first and try to shrink it down).
2. Tables that don't fit a phone width either scroll horizontally inside a
   contained wrapper or collapse to a stacked-card layout — check which
   pattern the page already uses nearby and match it.
3. The sidebar/nav uses the existing mobile-drawer pattern; don't introduce
   a second nav pattern.
4. Tap targets (buttons, row actions) are large enough for touch, not just
   mouse-sized.
5. Forms: inputs stack full-width on mobile; multi-column layouts only
   appear at `md:`+.
6. Any modal/popup (SweetAlert2) renders usably on a small viewport —
   check it isn't clipped or requiring horizontal scroll.
7. Test at actual phone widths (375px, 414px) in addition to a resized
   desktop browser — emulator viewport, not just a narrowed window.
