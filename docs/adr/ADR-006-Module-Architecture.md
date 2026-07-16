# ADR-006: Modules as Self-Contained Units Within One Application

## Context

The platform will grow to support up to eleven business modules (`docs/VISION.md`). The `modules/` directory was scaffolded in Sprint 1 (currently only `modules/template/`, explicitly empty pending future work) anticipating this growth. This sprint decides the structural relationship between modules, the shared platform, and each other.

## Decision

Each business module is a self-contained unit living under `modules/<module-name>/`, following the structure already scaffolded in `modules/template/`. A module owns its own routes, pages, and module-specific logic, and depends on `shared/ui/`, `shared/admin/`, and `shared/services/` for everything cross-cutting (`docs/ARCHITECTURE_PRINCIPLES.md`, points 1–2). Modules do not depend on each other directly — if two modules need the same capability, that capability belongs in `shared/`, not in a cross-module import.

The platform remains a single deployed Next.js application (per `docs/TECH_STACK.md`'s Vercel hosting choice); "modular architecture" describes internal code organization and boundaries, not separate deployments.

## Alternatives Considered

- **Separate applications/repositories per module (microservices-style)** — rejected: would multiply deployment, authentication, and shared-UI distribution complexity for a platform whose explicit goal is "One Platform," not many; also incompatible with "One Login" without building a federation layer that adds complexity with no clear benefit at current scale.
- **A single flat application with no module boundaries** (all business logic alongside shared code) — rejected: this is closer to the fragmentation problem the platform exists to solve (`docs/VISION.md`'s mission); without enforced boundaries, module-specific logic tends to leak into shared code over time.
- **Modules allowed to depend on each other directly** — rejected: creates a dependency graph that gets harder to reason about as more modules are added; routing a cross-module need through `shared/` keeps the graph one level deep (module → shared) instead of arbitrarily deep (module → module → module).

## Consequences

- A new module can be scaffolded by copying `modules/template/`'s structure, keeping onboarding predictable.
- Enforcing "no module-to-module imports" requires discipline (and potentially future lint rules) since Next.js itself does not prevent it technically.
- Because all modules ship in one deployment, a build-breaking change in one module's code can, in principle, block deployment of the whole platform — this is an accepted trade-off of single-application deployment and is mitigated by the existing build/verification discipline (`docs/DEVELOPMENT_GUIDE.md`) rather than by splitting deployments.
