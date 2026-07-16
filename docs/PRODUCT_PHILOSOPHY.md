# Product Philosophy

These are the standing principles every module and every feature decision is checked against. Where a feature request conflicts with one of these, the conflict should be surfaced rather than quietly resolved in either direction.

## Dealer First

The dealer technician and dealer staff are the primary users, not MSEAL back-office staff. When a design or workflow trade-off must be made, optimize for the person standing in a workshop with a phone, not the person at a desktop reviewing reports later. Back-office and reporting needs matter, but they are served by the same data the dealer enters once — they should not impose extra steps on the dealer to satisfy a back-office convenience.

## Simple UI

Screens should be understandable without training. If a screen needs a manual to be usable, the screen is wrong, not the manual. Prefer fewer fields, clear labels, and sensible defaults over flexibility that most users will never need.

## Minimal Clicks

Every required tap, click, or screen transition is a cost paid by a dealer in the field, often on a slow connection. Common tasks (creating a record, searching for a vehicle, attaching a photo) should take the fewest possible steps. When a workflow grows past a small number of steps, look for ways to combine, default, or pre-fill before adding more UI to explain it.

## Fast Performance

Dealer locations frequently have poor connectivity. Pages must load fast, work acceptably on a degraded connection, and never block the user on a slow non-critical request (e.g. a background sync or a report export). Perceived speed — immediate feedback, optimistic UI, clear loading states — matters as much as raw response time.

## Consistency

A user who has learned one module should already understand the next one. The same component looks and behaves the same way everywhere; the same workflow pattern (search → select → act) repeats across modules. Consistency is enforced structurally through the shared design system and shared component library (`docs/DESIGN_SYSTEM.md`, `shared/ui/`), not left to individual developer judgment per module.

## Reuse Before Create

Before building a new component, service, or pattern, check whether one already exists in `shared/ui/`, `shared/admin/`, or `shared/services/`. New code is only justified when no existing shared piece fits, and even then, the new piece should be built so it can become shared if a second module needs it. Duplication across modules is treated as technical debt, not a shortcut.

## Documentation First

Every shared service, module boundary, and architecture decision is documented before — or as part of — being built, not after. Documentation is not an afterthought for this platform; it is what allows multiple modules and multiple developers to build on shared foundations without constantly re-deriving how those foundations work. This sprint exists because of this principle.

## Security First

Permission checks, data scoping (e.g. branch- or dealer-level visibility), and audit logging are part of a feature's design from the start, not something added once a vulnerability or incident is found. New modules adopt the platform's shared authentication and permission model (`shared/admin/PERMISSION_GUIDE.md`) rather than inventing their own.

## How These Principles Are Used

These are deliberately framed as checks, not slogans. When reviewing a design, a pull request, or a new module proposal, each principle above should be answerable with a concrete "yes, because..." — if it can't, that is a signal to revisit the design before building it.
