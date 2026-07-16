# ADR-004: Centralized Platform Services Under `shared/services/`

## Context

As more business modules are added (PM Record, New Tractor Delivery, NTR, Warranty, Parts Request, Campaign, Dealer KPI, Service Bulletin), each will need authentication, file upload, PDF generation, notifications, and similar cross-cutting capabilities. Several of these already exist in some form inside MQR's own `src/lib/` (e.g. `email.ts`, `googleDrive.ts`, `exportPdf.tsx`). This sprint decides whether each module re-implements these capabilities or whether they're centralized.

## Decision

Cross-cutting capabilities are centralized as platform services under `shared/services/` — `auth`, `upload`, `google-drive`, `pdf`, `synchronization`, `scheduler`, `notification`, `audit`, `logging`, `monitoring`, `cache`, `search` (full responsibilities in `docs/PLATFORM_SERVICES.md`). A module consumes a service through its defined interface; it does not duplicate the service's logic locally. This sprint documents the structure (`shared/services/README.md` and `docs/PLATFORM_SERVICES.md`); it does not implement the services themselves.

## Alternatives Considered

- **Leave each module to implement its own version of these capabilities** — rejected: directly contradicts "Reuse Before Create" (`docs/PRODUCT_PHILOSOPHY.md`) and would mean N slightly-different email/upload/PDF implementations as N modules are built, each with its own bugs and inconsistencies.
- **A single, monolithic "utils" or "lib" package with no service boundaries** — rejected: without clear per-service boundaries, dependencies tend to tangle (e.g. PDF generation code reaching directly into Drive upload internals); explicit service boundaries (`docs/ARCHITECTURE_PRINCIPLES.md`, point 7) keep responsibilities separable and independently testable.
- **External, third-party SaaS for each concern** (e.g. a dedicated notification platform, a dedicated file-upload SaaS) — not rejected outright as a future option for an individual service's internal implementation, but rejected as the organizing decision here: the platform still needs its own consistent internal interface to whatever backs a service, so that swapping a backing provider later doesn't ripple into every module.

## Consequences

- Existing working code (`src/lib/email.ts`, `src/lib/googleDrive.ts`, `src/lib/exportPdf.tsx`, etc.) is the de facto starting point for migrating into the corresponding `shared/services/*` directory in a future sprint — this ADR does not require rewriting that code, only relocating/wrapping it behind a service boundary when that migration happens.
- A new module's onboarding cost is lower (it consumes existing services) but the platform's coordination cost is higher (a service change can affect every module using it) — this is an accepted trade-off consistent with "One Platform."
- This sprint intentionally stops at documentation; implementing any of the 12 services is explicitly out of scope per the Safety Rules and must be approved as separate future work.
