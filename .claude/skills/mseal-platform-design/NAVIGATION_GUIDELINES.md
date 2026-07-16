# Navigation Guidelines

Single source of truth: `src/app/(app)/navConfig.ts`'s `getNavGroups()`,
consumed by both `Sidebar` (rendering) and `PlatformHeader`
(breadcrumb/title lookup via `flattenRealNavItems()`). Never add a nav
entry inline in a component - always through `navConfig.ts`.

## Principles

**Navigation Principle**: Navigation represents platform capabilities.
Users see available capabilities. SuperAdmin may see future
capabilities. Navigation is never the roadmap.

**Capability Principle**: Every capability has an **Owner** (the domain
that owns it - see Domain ownership below), a **Status**
(`CapabilityStatus` - ACTIVE/COMING_SOON/PREVIEW/BETA/DEVELOPMENT), a
**Permission** (the `lib/scope.ts` predicate that gates it once real),
and a **Lifecycle** (it moves through statuses via named releases, never
silently reclassified). Visibility is derived from capability state,
never from hardcoded module names - see Capability status below.

## Taxonomy

Group -> Item, optionally -> Subgroup (one level of nesting, never
deeper). Current groups: Dashboard, Machines, Service, Quality,
Engineering Intelligence, Reports, Administration - see
`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` §2 for the full table.

## Coming Soon convention

A leaf with no real route is `{ href: null, comingSoon: true, label }`,
which never links anywhere - use the `comingSoon()` helper in
`navConfig.ts` rather than constructing the object by hand. It renders
disabled with a "Coming Soon" badge for SuperAdmin only; every other role
never receives it from `getNavGroups()` in the first place (see
Capability status below) - never silently omitted for SuperAdmin, never
shown as a placeholder to anyone else.

## Capability status (Navigation Visibility Rule, post-Foundation Freeze)

Every `NavItem` has an `effectiveStatus()` of `ACTIVE`, `COMING_SOON`,
`PREVIEW`, `BETA`, or `DEVELOPMENT` (`CapabilityStatus`, `navConfig.ts`) -
derived from `comingSoon` today, with an optional explicit `status` field
reserved for the next capability that needs a Preview/Beta/Development
badge instead of Coming Soon. **Navigation represents available business
capability, not the roadmap**: `getNavGroups()` shows every status to
SuperAdmin and only `ACTIVE` leaves to every other role
(`isCapabilityVisible()`) - one generic, status-driven filter applied to
every leaf in every group, never a per-module `if (key === '...')`
special case. Adding a new future capability (Dealer Portal, IoT,
Predictive Maintenance, Notifications, ...) at any non-`ACTIVE` status is
automatically SuperAdmin-only with no filtering code to write - only the
new nav entry itself, via `comingSoon()` (or an explicit `status:`).

This is a UX-visibility rule only, not a new authorization boundary: a
Coming Soon leaf's `href` is always `null`, so there is no real route
being newly protected - see `docs/standards/SECURITY_STANDARD.md`'s
Application-layer authorization section for how real routes are
separately, and unconditionally, enforced server-side.

## Role visibility

Nav visibility mirrors (but never replaces) server-side enforcement -
every route re-checks its own `lib/scope.ts` predicate regardless of
whether the nav shows it. This RBAC item-inclusion check and the
capability-status visibility check above are independent filters, both
applied inside `getNavGroups()` (e.g. Legacy Import is real and `ACTIVE`,
but still hidden from every role except SuperAdmin by its own
`canManageLegacyImport` predicate - nothing to do with capability status).
A group or subgroup with zero visible items for the current role is
omitted entirely (`filterGroupsByCapability()`) rather than rendered
empty - the same rule the Administration group's own construction logic
already applied, now generalized to every group.

## Adding a new nav entry

1. Real route exists and is permission-checked server-side -> add as a
   real item with its route's gating predicate.
2. No route yet, module planned -> add as Coming Soon (or, if it's
   genuinely further along, an explicit `status: 'PREVIEW' | 'BETA' |
   'DEVELOPMENT'`) in the group where it belongs per the Target
   Navigation, not omitted. It is automatically SuperAdmin-only per the
   Capability status rule above - no separate role gate needed for "not
   built yet."
3. Never invent a new top-level group without checking
   `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` §2 first - most new
   items belong under an existing group.

## Known open item

PDI and Parts Request have no nav entry (real or Coming Soon) today - see
`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` §2/§7. Don't silently add or
silently continue omitting them - it's a named, open product decision.

## Domain ownership (UI Terminology & Navigation Cleanup, supersedes the original ADR-023 addendum split; Knowledge ownership corrected by ADR-018, Engineering Knowledge Platform)

- **Quality owns execution: Quality Cases (รายงานปัญหาคุณภาพ) and
  Troubleshooting.** Troubleshooting is the technician-facing activity of
  diagnosing an active quality problem - it has exactly one nav entry,
  under Quality, never a second copy under Engineering Intelligence.
- **Knowledge (องค์ความรู้) owns itself** - an independent domain
  (ADR-018), not owned by Quality, PM, Warranty, or Machine, with its own
  `knowledge_cases`/`knowledge_evidence` tables and `KnowledgeService`.
  Its nav entry sits under the Quality menu group for UX/discoverability
  only (this section previously said Quality owned Knowledge - corrected
  since that contradicted ADR-018's own Vision).
- **Engineering Intelligence owns analysis, not execution**: exactly
  three items - AI Engineering, PIP, Predictive Quality. It consumes
  Knowledge (never raw Quality data directly) and Quality's own Cases/
  Troubleshooting to produce analysis; it does not get its own separate
  "Knowledge Engine" entry (Knowledge's one nav entry lives under Quality,
  for discoverability, not ownership) and "AI Analysis"/"Insights" are
  consolidated into the one AI Engineering entry rather than kept as
  three overlapping placeholders. PIP is produced from Quality Cases/
  Knowledge but is itself an Engineering deliverable - it has exactly one
  Quality-adjacent nav entry, under Engineering Intelligence, never a
  second copy under Quality. (Service > Campaigns' separate, unchanged
  PIP entry represents a different relationship - Service tracking a PIP
  as a campaign, not a
  duplicate page - see `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`
  §2a.)
- **Recall was removed entirely** - no Recall module/data exists and it
  had no distinct destination from Service Campaign; not carried forward
  as a Coming Soon placeholder.
- **Reports is cross-cutting, not a domain** - it consumes data from every
  domain group above it, owns none of its own. It gets a nav group for the
  same reason Administration does, not because it's a domain like
  Machines/Service/Quality (§2b in the framework doc).

## Terminology

Official UI wording for cross-cutting terms (nav labels, dashboard,
Machine Passport, and anywhere else the same concept appears) is defined
in `docs/standards/TERMINOLOGY_STANDARD.md` - check it before introducing
a new label for an existing concept, rather than inventing a new phrase
for something already named.
