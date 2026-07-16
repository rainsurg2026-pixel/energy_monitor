# Component Guidelines

**Reuse before create.** Before writing any new component, grep
`src/components/shared/` - most needs are already met.

## Current shared component inventory (`src/components/shared/`)

| Folder | Components |
|---|---|
| `layout/` | `AppShell`, `PlatformHeader`, `PageHeader`, `Card`, `DetailRow`, `SearchToolbar`, `NotificationBell`, **`EmptyState`, `ErrorState`, `Skeleton`** (new, page/section-level) |
| `dashboard/` | `KpiCard` (Statistic Card, now with optional `action`), **`ChartCard`, `QuickActionCard`, `HealthCard`, `NotificationCard`, `ProgressCard`** (new) |
| `status/` | `StatusPill`, `StatusBadge` |
| `admin/` | `AdminCrudTable`, `ActionButtons`, `EmptyState`/`LoadingState` (table-row-scoped - distinct from `layout/EmptyState`) |
| `forms/` | `TextField`, `SelectField` |
| `activity-timeline/` | `ActivityTimeline` + row/diff helpers (platform standard, MQR today, extend to other modules rather than duplicate) |
| `timeline/` | `Timeline`/`TimelineItem` - older, simpler; check it's still used before extending it further (`activity-timeline/` is the newer standard) |
| `attachments/`, `gps/`, `scope/`, `i18n/`, `auth/` | Domain-specific shared components - check before assuming a new one is needed |

## Rule for adding a new shared component

1. Confirm a real gap (this framework's own seven new widgets were each
   added only after confirming no existing component covered the need).
2. Extend an existing component non-breakingly if the gap is small (see
   `KpiCard`'s new optional `action` prop - every existing caller is
   unaffected).
3. Name it after its *contract*, not its first consumer (`ChartCard`, not
   `DashboardChart`).
4. Document the "why" in a short header comment, matching the pattern
   every existing shared component already uses (see `Card.tsx`,
   `PageHeader.tsx` for the tone/length to match).
