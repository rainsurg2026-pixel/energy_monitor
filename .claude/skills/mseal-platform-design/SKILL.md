---
name: mseal-platform-design
description: MSEAL DMS platform design framework - navigation, dashboard, widget, form, table, chart, notification, empty/error state, accessibility, and screen-contract standards. Use when building or reviewing any UI screen, component, or navigation change in this codebase.
---

# MSEAL Platform Design

This skill packages the MSEAL Design Framework (`docs/adr/ADR-023-MSEAL-Design-Framework.md`,
`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`) as an operational checklist,
the same way `.claude/skills/MSEAL_Skill_Library_v2.0/` packages this
repo's other standards. **The canonical prose lives under `docs/` - this
folder is a pointer + checklist layer, not a second source of truth.** If
this skill and a `docs/` file ever disagree, `docs/` wins; report the
drift rather than silently picking one.

## When to use this

Before building or reviewing: any new screen, any navigation change, any
dashboard/widget, any form/table/chart, any empty/error/loading state, any
notification surface, or any accessibility/responsive review.

## Before writing any UI code

1. Read `docs/UI_STANDARD.md` (current-state, binding) and
   `docs/DESIGN_SYSTEM.md` (aspirational target) - in that order.
2. Check `src/components/shared/` for an existing component before
   creating a new one. This framework's own build only added a component
   where grepping the shared directory first confirmed a real gap.
3. Read the specific guideline file below for the surface you're touching.

## Guideline files in this folder

| File | Covers |
|---|---|
| `DESIGN_SYSTEM.md` | Pointer to `docs/DESIGN_SYSTEM.md`/`docs/UI_STANDARD.md` + this framework's additions |
| `SCREEN_CONTRACT.md` | The 11-field template every new screen documents |
| `COMPONENT_GUIDELINES.md` | Reuse-before-create rule, current shared component inventory |
| `LAYOUT_GUIDELINES.md` | AppShell/PlatformHeader/Sidebar/Card/PageHeader composition |
| `FORM_GUIDELINES.md` | Native HTML, keyboard, inline validation, progressive disclosure |
| `TABLE_GUIDELINES.md` | Search/filter/sort/columns/pagination/bulk/export/responsive |
| `DASHBOARD_GUIDELINES.md` | Decision-center philosophy, Platform Overview vs domain dashboards |
| `CHART_GUIDELINES.md` | "What decision does this support" rule, `ChartCard` |
| `WIDGET_GUIDELINES.md` | The seven widget contracts |
| `NAVIGATION_GUIDELINES.md` | Group/Item/Subgroup taxonomy, Coming Soon convention |
| `SEARCH_GUIDELINES.md` | Universal Search data contract (UI not yet built) |
| `NOTIFICATION_GUIDELINES.md` | `NotificationCard` source vocabulary |
| `EMPTY_STATE_GUIDELINES.md` | Never "No Data" - reason + next step |
| `ERROR_STATE_GUIDELINES.md` | Problem/Reason/Resolution/Retry |
| `RESPONSIVE_GUIDELINES.md` | Desktop-first, tablet-adaptive, mobile-optimized |
| `ACCESSIBILITY_GUIDELINES.md` | WCAG AA, keyboard, ARIA, focus, contrast |
| `MOTION_GUIDELINES.md` | Where animation is/isn't used today |
| `VISUAL_LANGUAGE.md` | Tokens, color, typography, icons (pointer, no new tokens) |

## Non-negotiables (cross-cutting, apply regardless of which file you're in)

- Not a visual redesign license - don't restyle an unrelated screen while
  touching a nearby one.
- No icon library (ADR-023 resolved this - inline SVG/emoji only).
- No "No Data" anywhere - see `EMPTY_STATE_GUIDELINES.md`.
- SweetAlert2 only for feedback popups (`lib/swal.ts`) - never `alert()`/
  `confirm()`.
- Every new/changed screen gets a Screen Contract entry (`SCREEN_CONTRACT.md`)
  before it's considered done.
