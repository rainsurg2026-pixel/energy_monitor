# Dashboard Guidelines

## Dashboard = Decision Center, NOT Statistics Page

Every dashboard widget answers "what should the user do next" - a number
with no action attached to it is a report, not a dashboard widget. If you
can't name the decision a widget supports, it doesn't belong on a
dashboard (same rule as charts - see `CHART_GUIDELINES.md`).

## Platform Overview vs. domain dashboards

- **Platform Overview** (`/dashboard`) - platform-wide, role-aware,
  small set of real KPIs + Quick Actions. Never a second copy of any one
  module's detailed analytics.
- **Domain dashboards** (`/quality/dashboard` today; Machines/Service/
  Engineering Intelligence later) - a module's own detailed KPIs/charts,
  built from the same shared primitives (`KpiCard`/`ChartCard`), never a
  bespoke reporting stack per module (`docs/DASHBOARD_MODEL.md`'s
  ownership rule, unchanged).

## Every widget includes

1. **Primary KPI** - the number.
2. **Secondary Context** - a sub-label, trend, or comparison (`KpiCard`'s
   `sub` prop; `HealthCard`'s `detail`/`lastCheckedAt`).
3. **Primary Action** - a link to go do something about the number
   (`KpiCard`'s `action` prop, or a paired `QuickActionCard`).

## Role-awareness

Every dashboard hides (not fakes) a widget the current role shouldn't
see - see Platform Overview's own `canManageLegacyImport`/`seesAllDealers`
checks. Never show a zero/placeholder value for data a role isn't
authorized to see; omit the widget entirely.

## No real data source yet?

Use a Coming Soon `EmptyState` (see `EMPTY_STATE_GUIDELINES.md`) naming
why and what's planned - never a fabricated "0" presented as if it were
real.

## Shared KPI definitions

`docs/DASHBOARD_MODEL.md` defines eight shared KPI computations
(Completed Jobs, Pending Jobs, Overdue, Waiting Parts, Average Repair
Time, Open MQR, Warranty Claims, PM Completion) - reuse those exact
definitions rather than recomputing a "similar" number a different way.
