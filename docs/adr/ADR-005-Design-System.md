# ADR-005: An Aspirational, Module-Independent Design System

## Context

The platform needs one consistent visual and interaction language across all modules (`docs/VISION.md` — "Shared UI"). Two existing reference points were considered and explicitly rejected as the basis: PM Record, which does not exist anywhere in this repository yet, and the current MQR UI, which was built before any shared design system existed and was not designed with cross-module reuse in mind.

## Decision

`docs/DESIGN_SYSTEM.md` defines a forward-looking target design language for the entire MSEAL SERVICE SYSTEM, independent of any single existing module's current appearance. The current MQR codebase (`shared/ui/`, `shared/admin/`) is referenced only to identify components and patterns worth reusing — not as a description of the target look. Three explicit commitments follow: MQR will migrate to this system gradually without changing business logic; PM Record will be the first module built directly on it; and all future modules must follow it.

## Alternatives Considered

- **Use current MQR UI as the design standard** — this was the initially recommended approach, and was explicitly rejected by product direction: MQR's current screens were not designed with multi-module reuse in mind, and codifying its current look as "the standard" would lock in incidental choices rather than deliberate ones.
- **Use PM Record as the primary reference** — not possible: PM Record has no implementation in this repository (confirmed via repo-wide search before this decision was made), so there is nothing to reference.
- **Design system per module, reconciled later** — rejected: directly contradicts "Shared UI" and "Consistency" (`docs/VISION.md`, `docs/PRODUCT_PHILOSOPHY.md`); reconciling N independently-designed module UIs after the fact is far more expensive than designing the shared system first.

## Consequences

- MQR's migration to the new design system is a presentation-layer effort tracked separately from business-logic changes — this ADR does not authorize or schedule that migration; it only establishes the target it will migrate toward.
- PM Record's first implementation has no legacy UI debt, but also no existing screens to shortcut from — it is built design-system-first.
- Because the design system was defined without a concrete existing UI to mirror, early gaps (a pattern not yet anticipated) are expected and should be resolved by extending `shared/ui/` and `docs/DESIGN_SYSTEM.md` together, not by a module quietly diverging.
