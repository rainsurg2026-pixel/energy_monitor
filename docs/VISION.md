# Vision

**Product:** MSEAL SERVICE SYSTEM
**Subtitle:** Integrated After Sales & Dealer Operations Platform
**Status:** Foundational — defines the long-term direction for all future sprints.

## Mission

Build one unified platform for all MSEAL after-sales operations.

Today, after-sales work at MSEAL is split across separate applications, each with its own login, its own UI conventions, and its own copy of shared logic (auth, permissions, file storage, reporting). The MSEAL SERVICE SYSTEM exists to end that fragmentation: every after-sales workflow — from a dealer's first service quotation to warranty claims, parts requests, and KPI reporting — should run on one platform, under one identity, with one design language.

## Long-term Goal

Replace isolated applications with reusable business modules running on one common platform.

Concretely, this means:

- New business capability is delivered as a **module** added to the platform, not as a new standalone application.
- Modules consume **shared services** (authentication, file storage, PDF generation, notifications, reporting sync) instead of re-implementing them.
- Modules share a **single design system and component library**, so dealers and MSEAL staff experience one consistent product, not a collection of look-alike tools.
- Existing applications — starting with MQR — migrate onto this foundation incrementally, without service interruption and without rewriting business logic for the sake of the migration itself.

## Core Principles

| Principle | Meaning |
|---|---|
| One Login | A single authentication session grants access to every module the user is permitted to use. No per-module accounts. |
| One Platform | All modules are deployed, versioned, and operated as parts of one system, not as separate products. |
| Shared UI | Every module is built from the same component library and layout system (see `docs/DESIGN_SYSTEM.md`). |
| Shared Services | Cross-cutting concerns (auth, upload, PDF, sync, notifications, audit, logging, monitoring, cache, search) live in `shared/services/`, not duplicated per module. |
| Shared Authentication | Identity, sessions, and permission scopes are defined once and consumed by every module (see `shared/admin/PERMISSION_GUIDE.md` and `docs/PLATFORM_SERVICES.md`). |
| Shared Media Storage | Photos, videos, and PDFs produced by any module are stored under one Google Drive structure with one naming convention (see `docs/GOOGLE_DRIVE_ARCHITECTURE.md`). |
| Shared Reporting | Operational data is mirrored from Supabase into Google Sheets on a predictable schedule, giving every module the same reporting surface (see `docs/DATA_SYNCHRONIZATION.md`). |
| Modular Architecture | Each business module is a self-contained unit with a clear boundary, so it can be developed, tested, and reasoned about independently (see `docs/MODULE_ARCHITECTURE.md`). |
| Mobile First | Every screen is designed for a dealer technician on a phone in a workshop before it is adapted for a desktop back-office user. |
| Security First | Access control, data scoping, and audit logging are designed in from the start of a module, not retrofitted. |
| Cloud Native | The platform runs on managed cloud infrastructure (Vercel, Supabase) with no dependency on on-premise servers. |

## Business Modules

The platform is organized around the following business modules. Some exist today, some are planned; this document defines the shared target, not the current implementation status of each (see `ROADMAP.md` for sequencing and `docs/MODULE_ARCHITECTURE.md` for current status per module).

- **Dashboard** — cross-module overview and KPIs for dealers and MSEAL staff.
- **MQR** — the platform's first production module (maintenance/quality records); the current reference implementation for shared services and the migration target for the design system.
- **PM Record** — preventive maintenance records; planned as the first module built directly on the new design system.
- **New Tractor Delivery** — delivery and handover workflow for new units.
- **NTR** — new tractor registration workflow.
- **Warranty** — warranty claim submission and tracking.
- **Parts Request** — dealer parts ordering and fulfillment tracking.
- **Campaign** — service campaigns and recall management.
- **Dealer KPI** — dealer performance scorecards and reporting.
- **Service Bulletin** — technical bulletins and service advisories distributed to dealers.
- **Administration** — shared admin framework for master data (dealers, branches, users, technicians, problem codes) — see `docs/ADMIN_FRAMEWORK.md`.

## Why This Document Exists

Every architecture decision made in this sprint and beyond should trace back to the mission and principles above. Where a future decision appears to conflict with this document, the conflict should be raised explicitly (see `docs/adr/`) rather than resolved silently.
