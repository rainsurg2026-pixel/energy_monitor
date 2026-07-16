# MASP Enterprise Development Standard

Version: v1.2.1 (tagged and released - merge commits `b351b424c2d3fa62d9b693dd8192fdb7ed19d54b` and `c45c3ab584b0709e87cbdcd2fd98940aa3bfd0c0`)
Status: Platform Foundation Complete (Frozen); Address Platform on its v2 architecture

Adopted as this repository's canonical architecture document on
2026-07-08, after reconciling its Address Platform description against
the actual v1.2.0 implementation - see `docs/adr/ADR-011-Address-
Platform.md`. As of v1.2.1, the Address Master Data has been imported
into Supabase and ADR-011's v2 Supersession section governs: the
canonical `provinces`/`districts`/`subdistricts` tables (with PK/FK/
indexes) and `AddressRepository` now match this document's "Shared
Tables"/API wording **as written** - the v1 gap (in-memory JSON instead
of DB tables) no longer exists. `docs/architecture/ADDRESS_PLATFORM.md`
and `docs/architecture/MASTER_DATA_PLATFORM.md` hold the current,
detailed architecture reference; this document stays the mission/vision
and platform-inventory layer. Where this document and
`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` disagree on any other
point, `PLATFORM_ARCHITECTURE_STANDARDS.md`'s binding rules govern, per that
document's own precedence statement.

---

## MISSION

Develop MASP as an Enterprise After-Sales Platform.

The Platform Foundation is COMPLETE.

Do NOT redesign completed platform layers unless fixing:

- Confirmed bugs
- Security issues
- Measured performance problems

Every new feature must consume existing shared platforms.

Never create parallel implementations.

## CURRENT PLATFORM FOUNDATION

Core Platforms

- Attachment Platform
- Storage Platform
- DealerBranchScope
- Enterprise UI
- Address Platform
- Lookup Platform
- Configuration Platform
- Reference Data Platform
- Historical Import Platform
- MasterDataService

Core Modules

- Dashboard
- NTR
- PM
- QIR/MQR
- Machine360

## ARCHITECTURE

```
Business Module
  ↓
MasterDataService
  ├── AddressService
  ├── LookupService
  ├── ConfigurationService
  └── ReferenceDataService
  ↓
AttachmentService
  ↓
AttachmentRepository
  ↓
StorageProviderFactory
  ↓
Supabase / Cloudflare R2

Authorization

DealerBranchScope
  ↓
Repository Scope
  ↓
Database
```

Never bypass these layers.

## MASTER DATA PLATFORM

Every module must consume `MasterDataService`.

Address

- Province
- District
- Subdistrict
- Postal Code

Lookup

- Title
- Customer Type
- Job Status
- Priority
- Severity
- Attachment Type
- Workflow Status
- Fuel Type
- Machine Color

Configuration

- Required Attachments
- Upload Limits
- Allowed File Types
- Warranty Period
- Default Language
- Theme
- Feature Flags
- Workflow Settings

Reference Data

- Dealer
- Branch
- Technician
- Product Family
- Machine Model
- Failure Codes
- Warranty Codes

Never hardcode lookup values.

**Implementation status note**: as of v1.2.0, the Lookup Platform
implements Customer Type, Customer Title, Attachment Type, Severity
(also serving as Priority - see `docs/adr/ADR-011-Address-Platform.md`'s
sibling entries in `shared/master-data/lookup/`), and Status. Job
Status/Workflow Status, Fuel Type, and Machine Color have no consumer
yet and are not implemented - per the Architecture Evolution Rule below,
each is added only when a real module needs it, not speculatively. The
same applies to the additional Configuration and Reference Data items
listed above (Required Attachments/Upload Limits/Allowed File
Types/Theme/Feature Flags/Workflow Settings; Machine Model/Failure
Codes/Warranty Codes) - none exist yet.

## ADDRESS PLATFORM

Shared Tables

- provinces
- districts
- subdistricts

Shared APIs

```
GET /api/master/provinces
GET /api/master/districts?province_id=
GET /api/master/subdistricts?district_id=
```

Shared Component

`AddressSelector`

Behavior

```
Province
  ↓
District
  ↓
Subdistrict
  ↓
Postal Code (Auto Fill)
```

Requirements

- Searchable Dropdown
- Keyboard Accessible
- Cached
- Thai Support
- Reject invalid Province/District/Subdistrict combinations
- Auto-clear child selections

Historical Import

Accept Thai Province/District/Subdistrict names.

Automatically resolve

- province_id
- district_id
- subdistrict_id
- postcode

**Reconciliation note (updated for v1.2.1)**: as of ADR-011's v2
Supersession, "Shared Tables" is implemented exactly as written - the
canonical `provinces`/`districts`/`subdistricts` Supabase tables (PK/FK/
indexes) are the system of record, behind `AddressRepository`. The
Historical Import path resolves and validates against these tables
(`MasterDataService.validateThaiAddress()`, now Supabase-backed); the
resolved IDs are used for validation/lookup during import, while
`ntr_records` itself continues to store the Thai names as free text
(`customer_province`/`customer_district`/`customer_subdistrict`/
`customer_postal_code`) rather than foreign keys - no consumer today
joins against a stored `ntr_records.province_id`-shaped column, so that
part of the schema was not changed. Every other requirement in this
section (APIs, component, cascading behavior, all six requirements
including Searchable Dropdown) is implemented as described. See
`docs/architecture/ADDRESS_PLATFORM.md` for the full current schema/API/
repository reference.

## ATTACHMENT STANDARD

One shared Upload Component.

Image Preview

- 16:9 Frame
- Landscape Display
- Auto Rotate using EXIF
- object-fit: contain
- Never Crop

NTR Required

- ID Card
- Name Plate
- Delivery Report

Optional

- Booking Form
- Tax Invoice
- CRM Lead
- Video
- Customer with Tractor — REMOVED

PM Required

- Service Report

Optional

- Before Repair
- After Repair
- Failed Part
- Machine Overview
- Hour Meter
- Name Plate
- Customer Signature
- Video

## ENTERPRISE UI

One shared implementation for

- Header
- Sidebar
- AddressSelector
- Upload
- Attachment Viewer
- Table
- Form
- Dialog
- Notification
- Empty State
- Loading Skeleton

No duplicate components.

No floating controls.

## DESIGN SYSTEM

Shared Design Tokens

- Colors
- Typography
- Radius
- Shadows
- Spacing
- Icons
- Buttons
- Cards

Every module must consume these tokens.

## ARCHITECTURE EVOLUTION RULE

Platform Layers may only be added when required by real business
functionality.

Do NOT introduce shared infrastructure "just in case."

A new Platform Layer is allowed only when

- At least two independent business modules would otherwise duplicate substantial logic.
- The platform measurably reduces maintenance cost.
- An ADR documents the decision.
- Architecture review approves it.

Prefer extending existing platforms over creating new ones.

## DEPENDENCY RULES

Allowed dependency direction

```
Business Module
  ↓
Platform
  ↓
Infrastructure
  ↓
External Services
```

Never reverse dependencies.

Infrastructure must NEVER depend on Platform.

Business Modules must NEVER access Infrastructure directly when a
Platform Service exists.

Avoid circular dependencies.

## DATABASE STANDARD

Every schema change

- Migration only
- Backward compatible whenever practical
- Rollback considered
- No destructive changes without approval

Master Data

- Stable IDs
- Foreign Keys
- Indexed lookup columns

Avoid duplicate business data unless justified by measurable performance
gains.

## API STANDARD

Every API

- Validate input
- Validate authorization
- Consistent response
- Consistent error format
- No duplicated business logic

Prefer shared services.

## SECURITY

Always

- Validate server-side
- Enforce authorization server-side
- Sanitize inputs
- Protect secrets

Never rely on client-side validation.

## OBSERVABILITY

Critical workflows should produce structured logs.

Include

- Correlation ID
- Module
- Operation
- Timestamp

Never log secrets or personal information.

## PERFORMANCE

Prefer

- Lazy Loading
- Pagination
- Caching
- Indexed Queries

Avoid

- N+1 Queries
- Unnecessary Re-render
- Loading entire Master Data

Measure before optimizing.

## TESTING STANDARD

New business logic requires tests.

Prefer

- Unit Test
- Integration Test

Critical workflows require end-to-end verification.

Never reduce test coverage.

## REPOSITORY RULES

One Issue = One Commit

One Feature = One PR

Semantic Versioning.

Never rewrite published history.

Never move Tags.

Ignore

- .claude/
- .idea/
- .vscode/

## VERIFICATION

Before claiming completion run

- lint
- typecheck
- tests
- build
- architecture

Deploy Preview.

Perform Live UAT.

- Desktop
- Tablet
- Mobile (Responsive Verification)

If physical devices are unavailable

State the limitation.

Never fabricate screenshots.

## MERGE GATE

Never merge unless

- CI Green
- Preview Healthy
- Regression Complete
- Documentation Updated
- Repository Clean

Otherwise STOP.

## DOCUMENTATION

Always update

- PROJECT_STATE.md
- CHANGELOG
- RELEASE_NOTES
- PLATFORM_ARCHITECTURE_STANDARDS.md
- ROADMAP.md
- Architecture Documentation

If architecture changes

Update documentation in the same PR.

## FOUNDATION FREEZE

MASP Platform Foundation v1.2.0 is Frozen.

Allowed

- Bug Fix
- Security Fix
- Performance Improvement
- Documentation

Not Allowed

- New Platform Layers
- Architecture Rewrite
- Duplicate Shared Services
- Breaking Changes

Without an approved ADR.

## ARCHITECTURE DECISION RECORD (ADR)

Every platform-level architectural change must have an ADR.

This repository's ADRs are numbered `ADR-0NN` under `docs/adr/`
(currently ADR-001 through ADR-011); the examples below use this
document's original four-digit numbering as illustrative naming only -
see `docs/adr/` for the actual, current list.

Examples

- ADR Attachment Platform (`docs/adr/ADR-010-Attachment-Platform.md`)
- ADR DealerBranchScope
- ADR Storage Platform
- ADR MasterData Platform
- ADR Address Platform (`docs/adr/ADR-011-Address-Platform.md`)
- ADR Enterprise UI

Document

- Context
- Decision
- Alternatives
- Consequences

## DECISION MAKING PRINCIPLES

When multiple solutions exist

1. Preserve platform consistency.
2. Reuse existing shared services.
3. Minimize architectural complexity.
4. Avoid unnecessary abstraction.
5. Optimize long-term maintainability.
6. Validate assumptions with evidence.
7. Never trade correctness for convenience.
8. Explain architectural trade-offs.

Continue autonomously whenever safe.

Only stop for decisions affecting

- Architecture
- Database Integrity
- Security
- Production Behavior

## WORKFLOW ENGINE RULE

Workflow Engine is a consumer of the Platform.

Reuse

- MasterDataService
- DealerBranchScope
- AttachmentService
- Storage Platform
- Enterprise UI

Never create parallel implementations.

## QUALITY PRINCIPLES

Prefer

- Simple > Clever
- Reusable > Duplicated
- Explicit > Implicit
- Measured > Assumed
- Verified > Claimed

Architecture should evolve incrementally.

Avoid over-engineering.

Do not create abstractions until justified by real business
requirements.

## NEXT MILESTONE

Current Status

Platform Foundation Complete

Next Priority

1. Workflow Engine
2. Service Management
3. Customer Experience
4. Machine Intelligence
5. Predictive Maintenance

New features must consume existing platforms.

## COMPLETION STANDARD

Continue until

- Implementation Complete
- Migration Complete
- Tests Pass
- Build Passes
- Architecture Passes
- Preview Verified
- Live Verification Complete
- Documentation Updated
- Repository Clean
- Production Readiness Confirmed

If external permissions prevent completion

Stop only there.

Explain why.

Provide exact commands or manual actions.

Never claim completion without evidence.
