# ADR-022: Import Platform v2

## Status

Reopens the **Historical Import Framework** frozen layer (root `CLAUDE.md`
§3.6: "feature-frozen — bug/security/performance fixes only"), per this
work's explicit brief ("Replace Legacy Import implementation with a
reusable Import Engine") — the same treatment ADR-014 gave Authentication
Platform v3.0 and ADR-011's v2 Supersession gave the Address Platform:
a deliberate, documented, approved reopening, not a silent bypass of the
freeze.

**Numbering note**: skips ADR-015 through ADR-021, which the Architecture
Blueprint v1.1 (`docs/architecture/blueprint/16-ADR-RECOMMENDATIONS.md`)
already reserved for its own future ADRs (Machine Domain v2, Event Model,
Inspection, Knowledge, Engineering Intelligence, Analytics, Machine
Digital Passport) - none created yet, but reusing one of those numbers
here would collide the moment any of them is.

## Problem

The brief asks for a "next-generation Import Platform": flexible header
mapping, a Thailand Address Resolver, a Master Data Resolver, a
Transformation Library, formalized duplicate detection, an import
dashboard, audit/versioning, and forward compatibility with Machine/PM/
Warranty/PIP/Dealer/Customer/Parts/Recall and Excel/CSV/GSheet/REST/ERP/
SAP/Dealer-Portal sources — "without architectural changes."

**Grounding audit before any design work** (per this repo's own
"never write code from memory" rule): `src/shared/import/` already exists
(`docs/adr/ADR-024-Universal-Import-Framework.md`, renumbered from
`ADR-009` by the Platform Governance Framework's ADR normalization pass
after this ADR was written - see `docs/adr/README.md` - built explicitly
ahead of a second real consumer, exactly anticipating this kind of future
module). It already provides, module-agnostically:

| Brief's ask | Already exists as |
|---|---|
| Flexible Header Mapping, aliases, ignore-unsupported-columns | `ColumnMappingService` + `HeaderNormalizer` + `ImportFieldDefinition.aliases` |
| Import Profiles (Header Mapping + Version) | `ImportContract` (+ `templateVersion`) |
| Dry Run / Validate Only | `preview()` already writes zero business rows - only the tracking session |
| Partial Commit, row-level errors | `commit_ntr_legacy_import_row()` - one Postgres transaction **per row**, per ADR-008; a failed row never blocks another |
| Import Audit (rows/imported/skipped/failed/checksum) | `ntr_import_sessions` already stores all of this, including a `file_content` SHA-256 `fileChecksum` |
| Reusable parser (Excel/CSV) | `ImportParser.parseImportFile()` |
| Standard result DTO for future modules | `ImportResult`/`ImportPreviewBuilder.buildImportResult()` |

Building a parallel "Import Engine" from scratch, as the brief's literal
pipeline diagram might suggest read in isolation, would be **exactly the
duplicated mapping/validation/resolver the brief itself prohibits**. The
real gap, once ADR-009's actual scope is read, is narrower and different
from "replace everything": five capabilities ADR-009 explicitly named
**out of scope** for its own pass, plus formalizing two more that exist
today only as NTR-specific inline logic.

## Decision

**Extend, do not replace.** `src/shared/import/` and
`src/shared/master-data/` remain the single source of truth; this ADR
adds the pieces ADR-009 deliberately deferred, as new, additive,
module-agnostic services under those same directories, and migrates NTR
(the only real consumer today) onto them as the adopting example -
exactly the "Future Module Adoption" pattern ADR-009's own doc already
describes, just exercised for real instead of only in theory.

### New shared services (additive, zero existing behavior removed)

1. **Thailand Address Resolver** (`src/shared/master-data/address/
   ThailandAddressResolver.ts`) - wraps the existing `AddressRepository`
   (never re-implements Supabase access), adding what
   `validateThaiAddress()` doesn't do today: resolve from the most
   specific level given (Subdistrict → District → Province, not
   "all three or nothing"), return `province_id`/`district_id`/
   `subdistrict_id` + `confidence` + `resolutionMethod`, recognize
   Bangkok/abbreviation/English aliases, and produce `Address Ambiguous`/
   `Address Not Found` as distinct, named outcomes that never throw and
   never stop a batch.
2. **Master Data Resolver** (`src/shared/master-data/MasterDataResolver.ts`)
   - formalizes ID → Exact Name → Alias → Fuzzy priority resolution for
   Dealer/Branch/Product Family, on top of `MasterDataService`'s existing
   reference-data reads (`getDealers`/`getBranchesForDealer`/
   `getActiveProductFamilies`) - never a new query path.
3. **Transformation Library** (`src/shared/import/TransformationLibrary.ts`)
   - named, reusable coercion primitives (trim/case/date/boolean/number/
   null-handling) that `ImportFieldDefinition.parse` functions call
   instead of each module hand-rolling its own (NTR's own
   `parseImportDate`/`toNumberOrNull`/`toStringOrNull` become thin
   call-throughs, not forks).
4. **Duplicate Detector** (`src/shared/import/DuplicateDetector.ts`) -
   formalizes the in-file + against-existing-record duplicate pattern
   `ntrImportService.ts`'s `validateRows()` already implements inline,
   as a reusable, composite-key-capable utility any future module can
   call instead of re-deriving the same `Map`-based tracking.

### NTR migration (the adopting example, not a redesign of NTR)

`NtrImportService`/`ntrImportFields.ts` are updated to call the four
services above instead of their own inline equivalents. **Every existing
accepted/rejected outcome is unchanged** - this is a refactor of *how*
NTR reaches a decision, not a change to *which* decision it reaches,
verified by the existing NTR import test suite continuing to pass
unmodified plus new tests for the extracted services themselves.

### Genuinely new capability (not a refactor of existing logic)

- **Import Completion Notification** - checked before assuming this was
  missing: `commit_ntr_legacy_import_row()`'s own doc comment
  (`supabaseNtrRepository.ts`) confirms Tractor + NTR + **Timeline** +
  Audit all land in the same Postgres transaction per imported row - the
  brief's "Timeline Event" and "Audit Event" per commit already exist at
  the data layer, for every row, today. The real, narrower gap: no page
  in NTR renders `<ActivityTimeline>` for a single record yet (only MQR's
  `records/[jobId]` does) - a real but separate UI task, named here as
  deferred rather than attempted alongside everything else in this PR
  (see "Explicitly deferred" below). What genuinely does not exist yet
  and *is* built in this PR: a **Notification** when an import finishes -
  `sendImportCompletionEmail()` (`lib/email.ts`, following the exact
  "never throws" contract every email function there already uses)
  emails the importer a summary (imported/skipped/failed counts + a link
  back to the session's report) once `commit()` completes.
- **Import Dashboard** - cards (Today's/Successful/Failed/Pending
  Imports, Average Duration, Last Import) + Recent History (latest 3) +
  View All, replacing the current flat history list; the Archive Queue
  is removed from this UI (moved under an explicit admin action) but the
  backend archive worker (`archiveSession()`/`processArchiveQueue()`,
  ADR-008) is untouched.
- **Import Preview color taxonomy** (🟢 New / 🟡 Update / 🔵 Auto
  Corrected / 🟠 Warning / 🔴 Error) - a UI-layer addition over the
  existing `valid`/`duplicate`/`skipped`/`failed` outcomes, with a new
  `corrected` signal surfaced when the Address/Master Data Resolvers
  above resolve a value via alias/fuzzy match rather than an exact one.

## Explicitly deferred (named, not silently dropped)

Per this repo's own Architecture Evolution Rule ("a platform layer
changes only when a real business module needs it... not just in
case") and 01 Principle 9 in the Architecture Blueprint ("no new
infrastructure without a confirmed need"):

- **NTR record detail Timeline UI.** The data is already there (every
  imported row's `record_audit_log` entries, written atomically per
  ADR-008); no NTR page renders `<ActivityTimeline>` for a single record
  yet (only MQR does). A real, scoped, UI-only follow-up - not attempted
  in this PR alongside everything else, to avoid a rushed UI change to
  a page this PR doesn't otherwise touch.
- **Import Dashboard UI, Preview color taxonomy.** Both are named and
  designed in this ADR's "Genuinely new capability" section above but
  **not implemented in this PR** - building a full dashboard rebuild and
  a new preview color scheme to real, live-verified quality, on top of
  everything else in this PR, was judged too large to do well in the
  same pass; tracked as the next scoped follow-up once this PR's shared
  services land.
- **Cancelable/resumable background processing for 5000+ rows.** NTR's
  existing bulk-prefetch design (ADR referenced in `ntrImportService.ts`'s
  own comments) is already measured against a 10,000-row live UAT and
  completes synchronously within a normal request. True cancel/resume
  requires a job queue this platform doesn't have (`docs/ROADMAP.md`:
  "no job-queue infrastructure" is a known, intentional gap) - out of
  scope for this pass; flagged as technical debt, not built speculatively.
- **REST/ERP/SAP/Dealer-Portal source adapters.** The adapter seam
  (`ImportContract` + a source-specific "bytes/rows → parsed rows" step)
  is confirmed extensible without redesign (see the Import Platform
  Architecture doc's Future Sources section) - no adapter is actually
  built for any of these, since none has a real consumer today.
- **Full Import Profile versioning + historical replay** (Task 18).
  `ImportContract.templateVersion` already versions the header/field
  shape; a DB-backed, replayable profile-history system is a larger,
  separate initiative warranting its own future ADR once a real need
  (e.g. two profile versions genuinely in concurrent use) exists.
- **Machine/PM/Warranty/PIP/Dealer/Customer/Parts/Recall import
  profiles.** Per ADR-009's own "Future Module Adoption" section, these
  are *designed for* (the contract shape and every new shared service
  above is generic over `module`), not built - there is still no second
  real consumer today, and building speculative profiles for modules
  with no import UI/business rules yet would be exactly the "just in
  case" this repository's rules warn against.

## Consequences

- `src/shared/import/`, `src/shared/master-data/` gain four new,
  tested, module-agnostic files; zero existing exported function's
  signature changes in a breaking way.
- NTR's accepted/rejected import outcomes are unchanged (verified by its
  existing test suite); its internal implementation now delegates to
  the new shared services instead of duplicating their logic inline.
- The next module to adopt import (per ADR-009's original "Vehicle
  Master or PM" expectation) now also gets Address/Master Data
  resolution, transformation, and duplicate detection for free, not
  just header mapping/templating as before this ADR.
- `docs/engineering/IMPORT_FRAMEWORK.md` is updated in the same PR to
  describe the four new services; this ADR is the decision record for
  why they exist and why cancel/resume, external-source adapters, and
  profile replay are named but not built.
