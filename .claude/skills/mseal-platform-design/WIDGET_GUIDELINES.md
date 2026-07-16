# Widget Guidelines

Seven reusable widget contracts, all under
`src/components/shared/dashboard/` unless noted. Use these, don't
hand-roll a similar-looking card inline.

| Widget | Component | Required props (contract) |
|---|---|---|
| Statistic Card | `KpiCard` | `label`, `value`; add `action` for a Primary Action link |
| Chart Card | `ChartCard` | `title`, `decision` (required - see `CHART_GUIDELINES.md`), `children` |
| Timeline Card | `ActivityTimeline` (`shared/activity-timeline/`) | `events`, `entityLabel` - now live on Platform Overview's "Today's Activities" (pre-merge refinement), fed by `listTodaysAuditLog()` + `mapMixedAuditLogToActivityEvents()`, not a second timeline component |
| Notification Card | `NotificationCard` | `source` (platform/import/quality/pm/warranty/auth/ai), `title` |
| Quick Action Card | `QuickActionCard` | `label`, `href` |
| Health Card | `HealthCard` | `label`, `status` (healthy/degraded/down/unknown) |
| Progress Card | `ProgressCard` | `label`, `value` (0-100) |

## Rules

- Don't create an eighth widget type without confirming the seven above
  genuinely don't fit - most new dashboard needs are a `KpiCard` with an
  `action`, or a `ChartCard`.
- `NotificationCard`'s `source` vocabulary is fixed (platform/import/
  quality/pm/warranty/auth/ai) - a new module gets a new source value
  added to that union, not a free-form string per caller.
- `HealthCard`'s `status` vocabulary is fixed (healthy/degraded/down/
  unknown) - map a module's own health signal onto these four, don't
  invent a fifth.
- Widgets never fetch their own data - the page/Server Component queries,
  the widget renders. Keeps every widget testable and reusable across
  Server and Client Components alike.

## Global Search (not a widget - header chrome, pre-merge refinement)

`GlobalSearchButton` (`PlatformHeader`) is architecture-reserved, disabled,
tooltip-only - mirrors `NotificationBell`'s existing pattern exactly. No
backend. Data contract for when it's built: `docs/SEARCH_MODEL.md`
(unchanged). Don't count it as an eighth widget contract - it's a
header-level placeholder, not a dashboard card.
