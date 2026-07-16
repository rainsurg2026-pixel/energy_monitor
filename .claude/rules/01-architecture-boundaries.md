# Rule: Architecture boundaries

- `modules/<name>/` may import from `shared/`. It must not import from
  another `modules/<other>/` directly. If two modules need the same code,
  move that code to `shared/`.
- `shared/` must never import from `modules/<anything>`. Dependency
  direction is one-way: `modules → shared`.
- `templates/` is copy-source only. Nothing at runtime imports from
  `templates/`.
- New business logic does not get added to `shared/` "just in case." It
  goes in `shared/` only when at least two modules genuinely need it (or,
  as with `calcWarranty()`, a second module's need is already known and
  planned).
- As of Sprint 1, none of the above is enforced by tooling — it's a
  reviewed-by-hand convention until the migration sprints actually
  populate these folders. Treat it as binding anyway.
