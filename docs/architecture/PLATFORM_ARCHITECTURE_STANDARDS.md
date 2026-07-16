# MASP Platform Architecture Standards

> **Renamed from "MASP Platform Constitution"** (Platform Constitution
> v1.0, governance improvement, not architecture drift). The permanent
> platform-level Vision/Mission/Values/Principles now live one layer
> above this document, in `docs/architecture/PLATFORM_CONSTITUTION.md` -
> that document is the platform's highest-level governing document; this
> one holds the implementation-level architecture rules the Constitution
> references rather than duplicates. Every rule below is unchanged by the
> rename; only the title and this document's place in the governance
> hierarchy changed. See `docs/governance/DOCUMENTATION_HIERARCHY.md` for
> the full precedence chain.

The permanent architecture policy for the Mahindra After Sales Platform
(MASP), effective from the Storage Platform freeze. This document does
not replace `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE_PRINCIPLES.md`,
`docs/standards/DOMAIN_LANGUAGE_STANDARD.md`, `docs/architecture/
MASP_ENTERPRISE_STANDARD.md` (the mission/vision and platform-inventory
document), `docs/architecture/PLATFORM_CONSTITUTION.md` (the permanent
platform principles this document operationalizes), or any ADR - it
consolidates the binding rules those documents already established,
adds the rules the Storage Platform build-out (Phase 5B onward) proved
out in practice, and is the one place future work should check first
before introducing a new module, service, or dependency. Where this
document and an older one disagree, the newer, more specific decision
governs (see ADR-009's explicit supersession of the original "Tractor,
NOT Vehicle" rule as the precedent for how that works) - and the
disagreement itself should be resolved with a new ADR, not by silently
picking one. This precedence rule is what let `docs/adr/ADR-011-Address-
Platform.md` supersede `MASP_ENTERPRISE_STANDARD.md`'s Address Platform
storage/API wording without editing that document's substance. Where
this document and `PLATFORM_CONSTITUTION.md` disagree, the Constitution
governs (per the Constitution's own Constitution Rules section) - that
should never happen in practice, since this document contains
implementation rules the Constitution's principles govern the
interpretation of, not competing principles.

## Layer definitions

MASP is one Next.js application with four layers, in strict dependency
order:

| Layer | Lives under | Owns |
|---|---|---|
| **Business modules** | `src/features/*`, `src/app/(app)/*`, `src/app/api/*` | Module-specific routes, pages, domain logic, repositories, services. MQR (the original `records`/`report` code), Maintenance/PM, NTR (New Tractor Registration), Machine (Machine 360), Vehicle Event, Vehicle Health, Maintenance Due. |
| **Platform services** | `src/shared/*` | Cross-cutting capabilities every module consumes through a defined interface: the Attachment/Storage Platform (`shared/attachments/`), the Platform Event framework (`vehicle-event`'s `VehicleEventPublisher`), and (per ADR-004, not yet built) auth/upload/pdf/scheduler/notification/audit/logging/monitoring/cache/search. |
| **Infrastructure** | `src/lib/*` | Direct integration with an external system: Supabase (`lib/supabase.ts`, `lib/db.ts`), Google Drive (`lib/googleDrive.ts`), Resend (`lib/email.ts`), JWT/session (`lib/auth.ts`). A business module or platform service calls infrastructure through a service/repository, never an SDK directly, except where the platform service itself *is* the thin wrapper (e.g. `SupabaseStorageProvider` wrapping Supabase Storage). |
| **Database** | Supabase Postgres, RLS enabled on every table | The one source of truth (`docs/adr/ADR-001-Supabase.md`). Google Sheets/Drive are downstream consumers, never alternative stores of record. |

`modules/`, `shared/`, and `templates/` (the Sprint-1-era scaffolding
referenced in `.claude/CLAUDE.md`) remain placeholder-only as of this
document - all working code stays under `src/` until an explicit,
approved sprint task moves it, per that file's own standing rule.

## Dependency rules

1. **One direction only**: business modules depend on platform services;
   platform services depend on infrastructure; infrastructure depends on
   external SDKs. Nothing depends upward. A platform service (`shared/`)
   never imports from a business module (`src/features/*`,
   `src/app/(app)/*`) - this is the single rule most likely to reintroduce
   coupling if violated (`.claude/rules/01-architecture-boundaries.md`).
2. **A module may not import another module's internals directly.** If
   two modules need the same logic, it moves to a platform service - it
   is never cross-imported module-to-module. (Today's one narrow,
   documented exception: `features/mqr/providers/MqrSummaryProvider`
   reads through MQR's existing, unmodified `getVehicleHistory()` to
   register with Vehicle 360's provider registry - a read-only adapter at
   an explicit extension point, not a general license to reach into
   another module.)
3. **A business module reaches infrastructure only through its own
   repository/service, or through a platform service** - never a raw
   Supabase query, Drive API call, or SDK client constructed inline in a
   route handler or page component.
4. **Every table has RLS and is filtered through application-layer scope
   checks** (`lib/scope.ts`'s predicates today) - both layers, always;
   neither alone is sufficient (`.claude/rules/03-data-access-security.md`).
5. **A dependency direction violation is a defect, not a style
   preference** - flag it in review the same way a security or
   correctness bug would be flagged, per the same weight this
   document gives dependency rules as it gives to RLS/soft-delete
   rules.

## Platform service boundaries

A platform service is consumed through its public interface only - never
copy-pasted into a module, never reached into for its internals (ADR-004,
Architecture Principle 7: "Services are boundaries, not libraries to
inline").

The Storage Platform is the reference implementation of this boundary:
`AttachmentService` is the *entire* public surface business modules use.
`AttachmentRepository`, every `StorageProvider` implementation, and
`StorageProviderFactory` are internal to the service - a business module
that imports any of them directly is a boundary violation, full stop,
regardless of whether the resulting code happens to work. (Verified
clean for every current consumer as of the Storage Platform freeze - see
`docs/engineering/STORAGE_PLATFORM_FINAL.md`.)

The one documented exception pattern: an **operational/maintenance
surface** (this platform's `OrphanCleanupService`,
`StorageHealthService`, `StorageMetricsService`, `StorageAuditService`,
`StorageScheduler`) may read a service's repository/provider directly,
because its job is specifically to detect when the service's own
invariants have already broken - something the service's normal
abstraction cannot see past by design. This exception is narrow: it
applies to genuinely operational code (hygiene, health, metrics,
scheduling), gated to admin/SuperAdmin routes, never to a business
module's normal read/write path.

Every future platform service (the remaining ADR-004 list: auth, upload,
pdf, scheduler, notification, audit, logging, monitoring, cache, search)
follows the same shape: one public service class/interface a module
calls, internals not exposed, an equivalent "operational surface"
exception only if that service's own maintenance genuinely needs it.

## Infrastructure rules

- Infrastructure code (`lib/*`) never contains business logic - no dealer
  scoping, no status transitions, no validation beyond what's needed to
  talk to the external system correctly. That belongs in the
  repository/service layer above it.
- A new infrastructure integration (a new external SDK, a new third-party
  API) is wrapped in exactly one place under `lib/` (or a platform
  service's own provider, for a swappable capability like storage) -
  never called directly from two different call sites with two different
  wrapping conventions.
- Credentials/tokens are read from environment variables lazily (at call
  time, not module load), matching `getSupabase()`/`getR2Config()`'s
  existing pattern - so importing the file never throws in an environment
  that hasn't configured that integration yet (tests, a fresh clone
  before secrets are set).
- Infrastructure failures are translated into a small, fixed,
  business-friendly vocabulary at the platform-service boundary (see
  `AttachmentErrors.ts`'s `AttachmentErrorContext` for the pattern) -
  a raw SDK/HTTP/bucket-name error never reaches a business module or the
  UI.

## Domain language

Business terminology is governed by
`docs/standards/DOMAIN_LANGUAGE_STANDARD.md` - this document does not
duplicate it, only points to it as binding. Current state (as of ADR-009):
the platform business entity is **Machine** (Machine 360/Registry/
Timeline/Search/Health), with "Tractor" surviving one level down as
today's one Product Category. Database table names (`vehicles`,
`vehicle_id`, `vehicle_events`) are unaffected by business-terminology
renames - a rename is business terminology only (repository/service/UI/
docs), never a table rename, unless a dedicated migration ADR says
otherwise.

Every new module's user-facing strings, PDF/CSV headers, and status names
must be checked against `DOMAIN_LANGUAGE_STANDARD.md` before shipping -
"Documentation Precedes Implementation for Shared Surfaces"
(Architecture Principle 9) applies to business vocabulary exactly as it
does to shared services.

## Event rules

Vehicle Event (Phase 4.5, `src/features/vehicle-event/`) is the platform's
one event backbone: `Module -> Domain Service -> VehicleEventPublisher ->
VehicleEventService -> VehicleEventRepository -> Supabase`. No module may
write directly into `vehicle_events` - the Publisher is the only entry
point, including the platform's own `/api/platform/events` POST route
(it calls `publisher.publish()`, not `VehicleEventService.createEvent()`
directly, for the same reason a business module can't).

Current, explicitly-tracked state: the Publisher is fully built and unit
tested, but **no real module call-site invokes it yet** - MQR's and PM's
`create()`/status-transition code do not call
`publishMqrOpened()`/`publishMaintenanceCompleted()`/etc., and Vehicle
360's Timeline still reads via its own provider-registry aggregation
(`src/features/vehicle/registry.ts`), not from `vehicle_events`. Wiring
real call-sites and migrating the Timeline to read from `vehicle_events`
are two separate, explicit, not-yet-scheduled decisions - not implied by
anything in this document.

Every event row always stores `event_definition_id` (an FK), never the
`event_code` string directly (Reference Integrity - `event_definitions`
is the Event Definition Master). `vehicle_events` has no `dealer_id`
column; dealer scope is enforced via a `vehicles!inner(dealer_id)` join
at query time, the same "every query enforces scope, never relies on a
denormalized column alone" discipline every other table follows.

## Storage rules

The Storage Platform (`src/shared/attachments/`) is frozen per
`docs/engineering/STORAGE_PLATFORM_FINAL.md`/`STORAGE_PLATFORM_DECISION.md`.
Binding rules, restated here as permanent policy (not just this
milestone's finding):

1. `AttachmentService` is the only door a business module uses for file
   storage - never a `StorageProvider`, the repository, or a storage SDK
   directly.
2. Every storage backend implements the same `StorageProvider` interface;
   swapping the active primary/archive provider is a `StorageProviderFactory`
   configuration change (`STORAGE_PROVIDER`/`ARCHIVE_PROVIDER`), never a
   code change to `AttachmentService` or any caller.
3. A provider never returns a permanent/public object URL as part of
   `upload()`'s result - the only way to get a renderable URL is
   `AttachmentService.getUrl()` -> a provider's `getSignedUrl()`, resolved
   fresh, never stored and trusted long-term (the one exception being
   Google Drive's genuinely-permanent share link, which is inherent to
   that backend, not a shortcut taken by this platform).
4. `AttachmentRepository` never assumes or hardcodes which provider
   stored an object's bytes - the actual provider name is always passed
   in explicitly by `AttachmentService`.
5. The maintenance layer (hygiene/health/metrics/audit/scheduling) may
   read providers/repository directly (the operational-surface exception
   above) but must never perform a destructive action automatically -
   every cleanup defaults to dry-run, and nothing in this platform is
   wired to a timer or cron trigger.
6. Object-path segments derived from caller input are always sanitized
   before becoming part of a storage key (`sanitizePathSegment()`).

## Authorization rules (DealerBranchScope)

The Dealer/Branch Scope Platform Standard (`src/lib/dealerBranchScope.ts`
and `src/components/shared/scope/`) is frozen as of MASP Platform
Foundation v1.1.0 (`docs/releases/MASP_PLATFORM_FOUNDATION_V1.1.md`).
Binding rules, restated here as permanent policy:

1. Every module's dealer/branch authorization flows through exactly one
   path, no exceptions:

   ```text
   UI -> DealerBranchScope (resolveDealerScope / resolveBranchScope /
         assertBranchAccess / canAccessDealerBranch)
       -> Repository scope (applyScope() in lib/db.ts)
       -> Database
   ```

2. **No module may implement dealer/branch authorization
   independently** - a raw `seesAllDealers(role) ? requested :
   session.dealerId` ternary, a manual `record.dealer_id ===
   session.dealerId` comparison, or any other re-derivation of scope
   outside `dealerBranchScope.ts` is a boundary violation, the same
   weight this document gives a Storage Platform boundary violation.
3. `DealerUser` visibility is **branch-scoped**: every record in the
   user's own `session.branchId`, never "records I personally created"
   (`seesOwnRecordsOnly` - removed from `scope.ts` at v1.1.0). A
   `DealerUser` with `branchId: null` sees zero records - fail-closed,
   never fail-open.
4. List/filter reads enforce scope via `applyScope()`'s own dealer+branch
   `.eq()` pair (a mismatched pair returns zero rows, not an error).
   Single-record detail/mutate paths additionally call
   `canAccessDealerBranch()` at the route level - both layers, always,
   the same defense-in-depth discipline as RLS + `applyScope()`.
5. The client-side hook/component (`useDealerBranchScope()` /
   `<DealerBranchSelector>`) is the only dealer/branch filter UI a module
   builds - never a hand-rolled `dealerId`/`branchId` `useState` pair
   plus its own `/api/branches` fetch effect.
6. A new module's dealer/branch filtering is judged the same way a new
   Storage Platform consumer is judged: does it call the shared
   resolver, or did it build a parallel mechanism? The latter is always
   wrong, regardless of whether it happens to produce the same result.

## Master data rules (MasterDataService)

The MASP Platform Layer (`src/shared/master-data/`) completed as of
MASP Platform Foundation **v1.2.0** (tagged/released on merge commit
`6b7afb67765610337c04d10857a2c8028efdaa4c` - see `PROJECT_STATE.md`'s
"MASP Platform Layer" entry and `RELEASE_NOTES_v1.2.0.md`); its Address
Platform sub-domain was then migrated onto Supabase canonical tables in
**v1.2.1** (merge commits `b351b424c2d3fa62d9b693dd8192fdb7ed19d54b` and
`c45c3ab584b0709e87cbdcd2fd98940aa3bfd0c0` - see `docs/adr/ADR-011-
Address-Platform.md`'s v2 Supersession section and
`RELEASE_NOTES_v1.2.1.md`). v1.2.1 is the current baseline this
repository builds on. `MasterDataService` is the one entry point for every
"master/reference/lookup data" concern: Address (Thai province/district/
subdistrict/postal-code lookup and hierarchy validation), Lookup
(controlled-vocabulary values - Customer Type, Customer Title, Attachment
Type, Severity/Priority, Status), Configuration (business-rule
constants), and Reference Data (dealers/branches/technicians/product
families). Binding rules:

1. **`MasterDataService` is the only public surface** - a module imports
   `MasterDataService` from `@/shared/master-data`, never reaches into
   `address/`/`lookup/`/`config/`/`reference/` directly, the same
   boundary `AttachmentService` already established for the Storage
   Platform.
2. **Never hardcode a lookup value a module could get from
   `MasterDataService` instead** - a controlled-vocabulary value
   (Customer Type today; any future lookup) is defined once, in
   `lookup/`, and referenced everywhere else - not re-typed as a raw
   string literal in a component's options array, a zod schema, or an
   import-column normalizer.
3. **Never duplicate address logic** - Thai province/district/
   subdistrict lookup and hierarchy validation live in `address/` only,
   behind `AddressRepository` (Supabase-backed, async, as of v1.2.1).
   Originally built for and used only by NTR; promoted to a shared
   platform service specifically so a second module needing address
   validation reuses it instead of building a second Thai-address index.
   No business module queries the `provinces`/`districts`/`subdistricts`
   tables directly - only `AddressRepository` does, and only
   `MasterDataService` calls `AddressRepository`. The canonical Address
   Platform architecture (Supabase tables with PK/FK/indexes;
   `/api/master/provinces`/`districts`/`subdistricts` with
   `province_id`/`district_id` params; a filter input paired with each
   `<select>` for "searchable dropdown") is
   `docs/adr/ADR-011-Address-Platform.md` (see its v2 Supersession
   section) and `docs/architecture/ADDRESS_PLATFORM.md` - it explicitly
   supersedes any other document's description of this platform's
   storage/API shape, until a real business need justifies revisiting it
   again.
4. **Reference Data delegates to `lib/db.ts`, never re-implements data
   access** - `reference/referenceData.ts` is a thin pass-through to the
   dealer/branch/technician/product-family reads already centralized in
   infrastructure; it exists so a module reaches reference data through
   one platform-service entry point, not so the query logic moves.
5. **Configuration values are read lazily, at call time** (matching
   `lib/supabase.ts`'s established convention) with the already-shipped
   business rule as the default - importing the config module never
   throws before an optional override env var is configured.

## Foundation Freeze

**MASP Platform Foundation is complete.** As of `v1.2.1`
(`c45c3ab584b0709e87cbdcd2fd98940aa3bfd0c0`, PR #18, plus its docs
closeout `8d50363f9929b6e27039f0be0fcd335696e70ef8`, PR #19), the
following platform layers are **frozen** - considered stable
infrastructure every business module builds on top of, never
reimplements:

- Storage Platform
- Authentication Platform (reopened once, deliberately, for the v3.0
  Login/Password/Session/Invitation/Lockout build - see
  `docs/adr/ADR-014-Authentication-Platform-v3.md` and
  `docs/architecture/AUTHENTICATION_PLATFORM.md`; the same four-condition
  bar below still applies to any change after that)
- DealerBranchScope
- Attachment Platform
- Address Platform
- MasterData Platform
- Lookup Platform
- Configuration Platform
- Reference Data Platform
- Design Framework (added by ADR-023 - navigation taxonomy, dashboard
  composition rules, and the widget/screen-contract components under
  `src/components/shared/dashboard/` and `src/components/shared/layout/`;
  see `docs/adr/ADR-023-MSEAL-Design-Framework.md` and
  `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`. Visual tokens/typography
  themselves remain governed by `docs/UI_STANDARD.md` as before - this
  layer is the structural rules on top, not a second token system.)

Future modification to any of these ten is allowed **only** for:

1. A confirmed defect.
2. A security issue.
3. A measurable performance improvement.
4. A change carried by an approved ADR (per the Future extension rules
   below - the same discipline that produced ADR-011's v1→v2 Address
   Platform migration).

Anything else - a redesign, a parallel implementation, a "nicer" API
shape, a speculative new field - is out of scope until a real business
requirement makes it in-scope, exactly as the Architecture Evolution
Rule in `docs/architecture/MASP_ENTERPRISE_STANDARD.md` already states.
Workflow Engine (and everything after it in `docs/ROADMAP.md`'s priority
order) is a **consumer** of this frozen Foundation, not an occasion to
revisit it.

## Master Data Governance

Province, District, and Subdistrict are **System Master Data** - the
same category of "administered, not authored by any business module"
data as `dealers`/`branches`/`technicians`/`product_families`, formalized
here because the Address Platform migration (ADR-011 v2) made it
concrete with real tables for the first time.

1. **Business modules are read-only.** `MasterDataService` (via
   `AddressRepository`) is the only path a business module has to this
   data, and every method on that path is a read (`list*`/`find*`) -
   there is no `create`/`update`/`delete` method, and none should be
   added without the same ADR process any other platform-boundary change
   requires.
2. **No API may directly modify Address Master Data.** Verified: the
   `provinces`/`districts`/`subdistricts` tables (and their `*_raw`
   staging counterparts) have RLS `SELECT` policies only - no
   `INSERT`/`UPDATE`/`DELETE` policy exists on any of the six tables,
   and no route under `src/app/api/` writes to them.
3. **Changes are allowed only through approved migrations or approved
   administrative import procedures** - a corrected postal code, a
   renamed subdistrict, or a re-import of updated Thai administrative
   data all go through a reviewed Supabase migration (the same
   `address_platform_canonical_tables`-style process ADR-011 used), never
   an ad hoc `UPDATE` run against production, and never a change made
   through application code.

## Future extension rules

A future module or platform service must, before writing any code:

1. **Identify its layer** (business module vs. platform service vs.
   infrastructure) using the Layer Definitions above, and place its files
   accordingly.
2. **Check for an existing platform service first** - reuse before
   create (`docs/PRODUCT_PHILOSOPHY.md`), the same principle that led to
   the Attachment Platform being one shared thing MQR/PM/Machine 360 all
   consume instead of three separate upload implementations.
3. **Extend, don't fork, an existing platform service's interface** when
   the need is close to what already exists (e.g. a fourth
   `StorageProvider` implementation) rather than building a parallel,
   competing mechanism.
4. **Register at the one designated extension point**, if the platform
   service has one (Vehicle 360's `registry.ts` for summary providers,
   `event_definitions` for a new event code) - never by modifying every
   existing module's code to know about the new one.
5. **Never enable automatic execution of a new operational capability
   silently** - scheduling, automatic cleanup, and production rollout of
   any new capability each require their own explicit, separately-approved
   milestone, exactly as every Storage Platform milestone from Cloudflare
   R2 onward required.
6. **Record the decision** - a new platform service, a new provider, or a
   change to how modules interact is captured as an ADR (`docs/adr/`)
   before or alongside the code, per Architecture Principle 10.
7. **Add or update an architecture-enforcement check** if one exists for
   the boundary being extended. **Updated as of v1.1.0**: this is no
   longer future work - `scripts/architecture-check.ts` exists, is wired
   into CI (`.github/workflows/ci.yml`) ahead of typecheck/lint/test/
   build, and currently enforces five Storage Platform boundary rules
   (see `docs/engineering/ARCHITECTURE_ENFORCEMENT.md`). It does not yet
   cover the DealerBranchScope authorization rules above or general
   module-to-module isolation repo-wide - extending it to do so remains
   explicit, not-yet-scheduled future work.
