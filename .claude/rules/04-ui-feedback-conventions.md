# Rule: UI & feedback conventions

- SweetAlert2 (`swal.ts`) is the only UI feedback mechanism app-wide. No
  `alert()`, no `confirm()`, no inline ad-hoc error banners.
- Any timestamp shown to a user goes through the shared GMT+7 date
  formatter (`formatThaiDateTime()` today). Never call
  `Date.toLocaleString()`/`toString()` directly in a component — this has
  caused real production bugs (wrong-timezone timestamps).
- Print-only views use the existing `print:hidden` / dedicated print-view
  component convention rather than CSS hacks scattered across a page.
- Mobile-first responsive design is mandatory, not optional — the sidebar,
  forms, and tables all have an established mobile pattern; match it
  rather than introducing a new one per page.
- No icon library exists today; the app uses inline SVG/emoji where icons
  appear. Don't add an icon library casually — see
  `docs/ROADMAP.md` open items if this needs to change.
