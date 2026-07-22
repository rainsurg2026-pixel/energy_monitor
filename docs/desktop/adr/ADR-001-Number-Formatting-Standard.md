# ADR-001: Number Formatting Standard

> **Provenance note (documentation cleanup pass, 2026-07-21):** this
> record was originally filed as `docs/adr/ADR-014-Number-Formatting-Standard.md`,
> inside this repository's *other*, unrelated Supabase/Next.js platform
> documentation tree (`docs/adr/`; see that directory's own governed
> index, `docs/adr/README.md`). It collided with the pre-existing,
> heavily cross-referenced `docs/adr/ADR-014-Authentication-Platform-v3.md`
> and was never actually a member of that platform's ADR sequence — it
> documents this desktop application (`docs/desktop/`), a separate
> product. Per this repository's own precedent for resolving an ADR
> numbering collision (`docs/adr/README.md`'s "ADR numbering
> normalization" section: rename the file with fewer real
> cross-references, not the older one), it has been relocated here as
> the first record in a new, desktop-scoped ADR sequence and renumbered
> ADR-001. No content below this note was changed. `ADR-014-Authentication-Platform-v3.md`
> was not touched.

## Status

Accepted — RC-2.

## Decision

All presentation numeric values use the shared formatter in
`src/utils/numberFormat.ts`. UI code must use `formatNumber`, `formatDecimal`,
`formatPercentage`, or `formatEnergy`; it must not call `toFixed`,
`toLocaleString`, or `Intl.NumberFormat` directly.

## Scope and exceptions

This policy changes display strings only. It does not change calculations,
stored values, workbook values, or editable input behavior. Native rounding is
allowed for calculation and parsing. `toFixed` is allowed for SVG/canvas
geometry because those values are coordinates, not displayed measurements.

## Rationale

One formatter prevents different screens, sites, reports, tooltips, and exports
from presenting the same value with different precision. It also makes future
modules inherit the product standard automatically.

## Developer rule

Before merging UI changes, run `npm.cmd run validate:formatting`. Any direct
presentation formatting outside the central utility is a regression.

## Layer Dependency Rules

The allowed dependency direction is:

```text
Presentation Layer
        ↓
Formatting API (numberFormatBridge.ts)
        ↓
Formatting Implementation (numberFormat.ts)

Business Layer
        ↓
Domain / Excel / Calculation modules (including energyCost.ts)
```

`energyCost.ts` owns domain calculations only. It must not export formatting
helpers. Presentation components must import formatting APIs from
`numberFormatBridge.ts` (or the underlying formatting implementation), never
from `energyCost.ts`.

Business modules must never depend on presentation helpers. This keeps display
precision independent from calculation precision and prevents formatting from
becoming part of domain contracts.

The architecture validator rejects formatting imports from `energyCost.ts` and
direct presentation formatting calls in UI components. SVG/PDF coordinate
formatting remains an explicit geometry exception.

## Public API Recommendation

`numberFormatBridge.ts` is the compatibility-facing public formatting API for
the current release. Keep it stable during RC-2.1. A future major cleanup may
move its exports into `src/utils/format/index.ts` with domain-specific modules,
but that migration is not required now and must preserve the current import
contract.
