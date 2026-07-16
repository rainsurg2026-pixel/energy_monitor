# Search Guidelines

Data contract (already defined, do not re-derive): `docs/SEARCH_MODEL.md`.
Covers Serial Number, Engine Number, Customer, Dealer, Branch, Technician,
Job Number. Ownership: one shared `search` platform service (see
`docs/PLATFORM_SERVICES.md`), never a per-module `ILIKE` query
reimplemented independently. Results are mixed-entity; each result
self-labels its module (e.g. "MQR", "NTR", "Vehicle").

## Status: no Universal Search UI exists yet

No search index, query, endpoint, or UI is built - `docs/SEARCH_MODEL.md`
says so explicitly and this framework does not close that gap (named in
`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`'s Migration Roadmap as a
"Later" item). `SearchToolbar` (`shared/layout/`) exists today as a
per-page filter-bar search input (used by list pages), not a cross-entity
Universal Search - don't confuse the two.

## When Universal Search UI is eventually built

- Reuse `SearchToolbar`'s input styling/placement convention rather than a
  new search input pattern.
- Results render via `NotificationCard`-style rows (icon + title + module
  label) or a new dedicated `SearchResultRow`, not a generic table -
  results are heterogeneous by nature.
- Respect the same tenant isolation as any other query
  (`docs/SEARCH_MODEL.md`'s scoping rule) - a DealerUser never sees a
  search result they couldn't otherwise query directly.
