# Rule: Coding standards

- TypeScript, no implicit `any`. Use/extend the interfaces in `types.ts`
  rather than re-declaring shapes inline.
- File naming: kebab-case files, PascalCase components/types, camelCase
  functions/variables.
- Pages under `(app)/` are Server Components by default. Add `'use client'`
  only to the smallest subtree that needs interactivity — keep the
  established pattern of a thin Server Component page wrapping a Client
  Component for the interactive part.
- Tailwind only, mobile-first (`base` styles first, then `sm:`/`md:`/`lg:`
  overrides). Use the brand tokens in `tailwind.config.ts`, not hard-coded
  hex/shadow values.
- Reuse the existing class vocabulary in `globals.css` (`.card`, `.btn-*`)
  instead of inventing parallel one-off classes.
- No `TODO` comments left in committed code. No fake/placeholder data
  unless explicitly requested. No incomplete implementations.
- No new dependency (state library, icon library, ORM, validation library)
  gets added casually — it's a deliberate, documented decision (see open
  items in `docs/ROADMAP.md`), because the app currently has none of these
  and that's a known, intentional gap, not an oversight.
