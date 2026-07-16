# Screen Contract

Every new or materially-changed screen documents these eleven fields
before it's considered done (in a PR description, a code comment block at
the top of the page file, or an entry in
`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`'s §5):

1. **Purpose** - one sentence: what this screen is for.
2. **Primary User** - which role(s) actually use this day-to-day.
3. **Primary Decision** - the one question this screen helps answer.
4. **Primary Action** - the one thing a user does here most often.
5. **Success Criteria** - how you'd know the screen is working (a metric
   or a concrete user outcome, not "looks good").
6. **Permissions** - which `lib/scope.ts` predicate gates this screen, and
   whether it's enforced server-side (it must be - see
   `docs/standards/SECURITY_STANDARD.md` - nav visibility is UX only).
7. **Navigation** - where this screen sits in the Group/Item taxonomy
   (`NAVIGATION_GUIDELINES.md`).
8. **KPIs** - which Statistic Cards, if any (`WIDGET_GUIDELINES.md`).
9. **Quick Actions** - which Quick Action Cards, if any.
10. **Timeline** - does this screen render `<ActivityTimeline>`; if not,
    why not (many screens legitimately have no per-record timeline).
11. **Related Records** - what this screen links out to.
12. **Future AI Panel** - reserve the layout slot even if empty today (a
    Coming Soon `EmptyState`, per `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`
    §14) - never bolt an AI panel onto a screen later without having
    planned where it goes.

## Worked examples

See `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` §5 for two filled-in
Screen Contracts (Platform Overview, Import History) - use them as the
template shape, not a checklist to copy-paste blank.

## What this is not

A retrofit mandate. Existing screens are migrated to this contract
gradually (`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`'s Migration
Roadmap, item 2) - reviewed one at a time, not stamped mechanically across
the whole app in one pass.
