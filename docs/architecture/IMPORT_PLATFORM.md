# Import Platform (v2)

Current-state architecture reference for the Import Platform - the
decision record (why it looks like this, what was considered and
rejected, what's deliberately deferred) lives in
`docs/adr/ADR-022-Import-Platform-v2.md` (and, for the original
framework, `docs/adr/ADR-024-Universal-Import-Framework.md`, renumbered
from `ADR-009` - see `docs/adr/README.md`). This
document is the architecture/pipeline reference kept in sync with the
code, matching the pattern `MASTER_DATA_PLATFORM.md`/`ADDRESS_PLATFORM.md`
already follow for their own ADRs.

## Pipeline

The requested pipeline, mapped to where each stage actually lives today:

| Stage | Implementation | Status |
|---|---|---|
| Read Source | `ImportParser.parseImportFile()` | Existing (ADR-009) |
| Detect Import Profile | `ImportContract` (one per module - NTR's is `NTR_IMPORT_CONTRACT`) | Existing (ADR-009) - "detection" is trivial today since there is exactly one profile per route; a multi-profile-per-route auto-detect has no real consumer yet |
| Header Mapping | `ColumnMappingService` + `HeaderNormalizer` + `ImportFieldDefinition.aliases` | Existing (ADR-009) |
| Column Transformation | `ImportFieldDefinition.parse` | Existing (ADR-009), now backed by... |
| Value Transformation | **Transformation Library** (`TransformationLibrary.ts`) | New (ADR-022) |
| Master Data Resolver | **Master Data Resolver** (`MasterDataResolver.ts`) | New (ADR-022) |
| Thailand Address Resolver | **Thailand Address Resolver** (`ThailandAddressResolver.ts`) | New (ADR-022) |
| Duplicate Detection | **Duplicate Detector** (`DuplicateDetector.ts`), wired into NTR's `validateRows()` | New (ADR-022), NTR migrated |
| Business Rules | The module's own service (`NtrImportService.validateRows()`) | Existing (ADR-009) - deliberately never in the shared framework |
| Validation | Same - `ImportContract.validators` for field-shape checks, module service for the rest | Existing (ADR-009) |
| Preview | `ImportPreviewBuilder` | Existing (ADR-009) |
| Commit | Module's own repository, one transaction per row (NTR: `commit_ntr_legacy_import_row()`, ADR-008) | Existing (ADR-008/009) |
| Audit | `record_audit_log`, written inside the same per-row transaction | Existing (ADR-008) |
| Timeline | Same `record_audit_log` row, readable via `mapAuditLogToActivityEvents` | Existing (ADR-008) - **no NTR page renders it yet** (deferred, see ADR-022) |
| Notification | `sendImportCompletionEmail()` | New (ADR-022) |
| Archive | `NtrImportService.archiveSession()`/`processArchiveQueue()` (Google Drive, background, retryable) | Existing (ADR-008) |

## Architecture

```
Business Module (NTR today)
  │  supplies: ImportContract (fields/aliases/version), business rules, repository
  ▼
Universal Import Framework (src/shared/import/) - ADR-009 + ADR-022
  ├── ImportParser            - bytes -> header + rows (Excel/CSV)
  ├── ColumnMappingService    - header -> canonical field, by alias, order-independent
  ├── TransformationLibrary   - named coercion primitives (NEW)
  ├── DuplicateDetector       - in-file duplicate tracking, composite keys (NEW)
  ├── ImportTemplateService/Validator - template generation + header validation
  ├── ImportPreviewBuilder    - per-row outcome -> summary/result DTO
  ├── ImportErrorFormatter    - technical reason -> business-facing message
  ├── ImportHistoryService    - fan-out/merge of every module's own session list
  └── ImportMetrics           - rows/sec, avg validation time (pure arithmetic)
  ▲
  │  reads (never re-implements)
  ▼
Master Data Platform (src/shared/master-data/) - ADR-011 + ADR-022
  ├── AddressRepository            - canonical provinces/districts/subdistricts (Supabase)
  ├── ThailandAddressResolver      - bottom-up resolve + confidence + method (NEW)
  ├── MasterDataResolver           - ID/Name/Alias/Fuzzy for Dealer/Branch/Product Family (NEW)
  └── reference/referenceData.ts   - dealers/branches/product families (thin pass-through to lib/db.ts)
```

No business module talks to `AddressRepository`/Supabase directly for
address or reference data - `MasterDataService` remains the one public
surface, per `PLATFORM_ARCHITECTURE_STANDARDS.md`'s Master data rules, unchanged
by this pass.

## Future Modules

Per ADR-009's original "Future Module Adoption" section and the
Architecture Blueprint's Blueprint v1.1 Business Capability Map, the
following are *designed for*, not built (no real consumer today - per
this repo's Architecture Evolution Rule, building their profiles
speculatively would itself be the "just in case" this platform's own
rules warn against):

| Module | Onboarding step |
|---|---|
| Machine (Vehicle Master) | Define an `ImportContract`; reuse every service above unchanged |
| PM | Same - PM already reuses `MasterDataService`'s Address Platform for its own address fields (`ADDRESS_PLATFORM.md`) |
| Warranty, PIP, Dealer, Customer, Parts, Recall | Same - none has a business module/table yet (Warranty/Parts are tracked gaps per the Architecture Blueprint's 14-RISKS-AND-TECHNICAL-DEBT.md); an import profile for a module that doesn't exist yet is not designed here |

## Future Sources

The framework's only real seam today is `ImportParser.parseImportFile()`
(bytes → header + rows). Every future source in the brief plugs in at
exactly that seam, without touching anything downstream of it:

| Source | How it plugs in |
|---|---|
| Excel, CSV | Already implemented |
| Google Sheets | A new "fetch sheet → same header+rows shape" adapter feeding the same `ColumnMappingService`/`TransformationLibrary` pipeline - no redesign |
| REST API, ERP, SAP, Dealer Portal | Same seam - a source-specific adapter produces the header+rows shape; everything from Column Mapping onward is unchanged. Matches the Architecture Blueprint's own Future Integrations Readiness pattern (12-FUTURE-INTEGRATIONS-READINESS.md) - "a new producer/consumer of an existing pattern, never a fourth integration pattern" |

No adapter for any of these is built in this PR - none has a real
consumer today.

## Import Profiles & Versioning

`ImportContract.templateVersion` is the profile version today (a plain
string, bumped by a module when its template shape changes - column
matching is alias/name-based, so an older file still parses). A
DB-backed, replayable profile-history system (Task 18's "historical
replay") is **not built** - no current requirement needs it, and building
it speculatively would be exactly the kind of infrastructure this
platform's Architecture Evolution Rule exists to prevent. Named here as
a real, deliberate gap, not a silent omission - see ADR-022's "Explicitly
deferred" section.

## What this document does not cover

Import Dashboard UI, Import Preview color taxonomy, cancelable/resumable
background processing for 5000+ rows, and REST/ERP/SAP/Dealer-Portal
source adapters are all named and designed (this document, ADR-022) but
**not implemented** in this pass - see ADR-022's "Explicitly deferred"
section for why each one specifically was scoped out rather than
attempted alongside everything else in this PR.
