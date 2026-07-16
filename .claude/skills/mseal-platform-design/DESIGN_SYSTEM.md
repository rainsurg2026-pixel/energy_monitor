# Design System (pointer)

Canonical source: `docs/DESIGN_SYSTEM.md` (aspirational target vision) and
`docs/UI_STANDARD.md` (current-state, binding - wins when the two
disagree). Do not duplicate either here; read both before any UI change.

## What this framework adds on top of those two

- **Navigation Standard** - see `NAVIGATION_GUIDELINES.md`.
- **Dashboard Standard** ("decision center, not statistics page") - see
  `DASHBOARD_GUIDELINES.md`.
- **Widget Standard** (seven named card contracts) - see
  `WIDGET_GUIDELINES.md`.
- **Screen Contract** template - see `SCREEN_CONTRACT.md`.
- Reconciled one live contradiction between `DESIGN_SYSTEM.md` and
  `UI_STANDARD.md`: **no icon library** (inline SVG/emoji only) is the
  current, binding rule - `DESIGN_SYSTEM.md`'s old "Lucide React" line was
  corrected by ADR-023.

## Governance

Design Framework is the tenth entry in
`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s Foundation Freeze.
Modification requires: a confirmed defect, a security issue, a measurable
UX/performance problem, or a further approved ADR - the same bar every
other frozen platform layer already meets.

## Full reference

`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` - the ten-deliverable
synthesis (Design Framework, Navigation Standard, Dashboard Standard,
Widget Standard, Screen Contract, Enterprise UX Checklist, Gap Analysis,
Migration Roadmap, Technical Debt, Future Recommendations).
