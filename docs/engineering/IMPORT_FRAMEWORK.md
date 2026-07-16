# Universal Import Framework

> **Note (2026-07-16, ADR-038)**: NTR Legacy Import - this framework's
> first and, until now, only real consumer - is permanently retired
> (Product Owner decision). The framework described below (`src/shared/
> import/`) is **not** itself retired by that decision (a separate ADR-024/
> ADR-022 architectural layer), but it currently has no adopter beyond
> `TransformationLibrary.normalizeDate()` (used independently by
> `TractorInSyncService`). Kept as platform infrastructure for a future
> import module, flagged as technical debt, not deleted - see
> `docs/adr/ADR-038-Historical-NTR-Import-Retirement.md`'s Scope section.

`src/shared/import/` — the reusable Import Wizard framework every module's bulk/historical-data import is meant to use. NTR Legacy Import was the first, and until its retirement the only, real consumer; every piece here is generic over a module's own `ImportContract`, with zero NTR-specific knowledge baked in. See `docs/adr/ADR-024-Universal-Import-Framework.md` for the original framework's rationale (renumbered from `ADR-009` by the Platform Governance Framework's ADR normalization pass - see that ADR's own note and `docs/adr/README.md`) and `docs/adr/ADR-022-Import-Platform-v2.md` for the four services added below.

## Import Platform v2 additions (ADR-022)

Four new, module-agnostic services - added because ADR-024 (then numbered ADR-009) explicitly named them out of scope for its own pass, not because the original framework was wrong:

- **Thailand Address Resolver** (`src/shared/master-data/address/ThailandAddressResolver.ts`, exposed via `MasterDataService.resolveThaiAddress()`) - bottom-up (Subdistrict → District → Province) resolution with `province_id`/`district_id`/`subdistrict_id`, `confidence`, and `resolutionMethod` (`exact`/`alias`/`ambiguous`/`not_found`). Recognizes Bangkok's common aliases (กทม./กรุงเทพฯ/Bangkok) and ฯ-truncated province names (นครศรีฯ → นครศรีธรรมราช, only when the prefix is nationally unique). Never throws, never stops a batch, never creates Master Data. Complements, does not replace, `validateThaiAddress()`'s stricter top-down consistency check.
- **Master Data Resolver** (`src/shared/master-data/MasterDataResolver.ts`, exposed via `MasterDataService.resolveDealer()`/`resolveBranch()`/`resolveProductFamily()`) - ID → Exact Name → Alias → Unique Fuzzy Match priority, over the existing Reference Data Platform reads. Alias data is supplied by the calling module (this file has no business-specific naming knowledge). Read-only - never creates a Dealer/Branch/Product Family row.
- **Transformation Library** (`src/shared/import/TransformationLibrary.ts`) - named, reusable coercion primitives (`trim`/`toUpperCase`/`toLowerCase`/`toStringOrNull`/`toNumberOrNull`/`toBooleanOrNull`/`normalizeWhitespace`/`normalizeDate`). NTR's own date/number/string coercion (previously inline in `ntrImportFields.ts`) now calls these instead of a module-local copy.
- **Duplicate Detector** (`src/shared/import/DuplicateDetector.ts`) - `InFileDuplicateTracker` formalizes the in-file duplicate-tracking pattern `ntrImportService.ts` already used (three separate `Map`s), plus `buildCompositeKey()` for composite business keys (e.g. Serial + Dealer). `peek()`/`recordSeen()` support a module that only wants to record a key once a row is confirmed valid (NTR's exact usage) alongside the simpler combined `check()` for a module that doesn't need that distinction. Checking against an *existing database record* remains the calling module's own repository query - this file only ever answers "seen already in this file, yes/no, on which row."

## Import Completion Notification (ADR-022, Task 15)

`lib/email.ts`'s `sendImportCompletionEmail()` - sent once `NtrImportService.commit()` finishes (wired in `api/ntr/import/commit/route.ts`), to the importer's own registered email (looked up by username; silently skipped if they have none, matching this platform's existing "Missing Email" handling elsewhere). Follows the exact "never throws, warn-and-skip if unconfigured" contract `sendRecordNotification()` already established - a failed/unconfigured notification must never fail an import that already committed.

Note: the **per-row Timeline/Audit event already existed before this ADR** - `commit_ntr_legacy_import_row()`'s own doc comment confirms Tractor + NTR + Timeline + Audit all land in the same Postgres transaction, per ADR-008. What was missing, and is what this ADR actually adds, is the *notification* - no NTR page renders `<ActivityTimeline>` for a single record yet (a separate, deferred UI task - see ADR-022's "Explicitly deferred" section).

Built in `src/shared/` ahead of a second real consumer existing — a deliberate exception to this repo's own `.claude/rules/01-architecture-boundaries.md` ("shared/ only when at least two modules genuinely need it"), justified because this is framework/infrastructure code, not business logic, and 7 target modules are already named (Vehicle Master, NTR, PM, PDI, MQR, Campaign, Parts). The trade-off: the abstraction is unverified against a second real caller until one of those modules actually adopts it — if it turns out to be the wrong shape, that's the cost of building ahead of evidence.

## Import Contract

`ImportContract.ts` — the single object a module hands the framework, and the *only* thing every generic piece (`ColumnMappingService`, `ImportParser`'s column resolution, `ImportTemplateService`, `ImportTemplateValidator`) depends on:

```ts
interface ImportContract {
  module: string;
  templateName: string;
  templateVersion: string;
  fields: ImportFieldDefinition[];
  validators?: ImportValidator[]; // optional, field-level checks beyond `parse` coercion
}
```

`requiredFieldsOf()`/`optionalFieldsOf()`/`aliasesOf()` derive their views from `contract.fields` on demand — there is no separately-stored `requiredFields`/`optionalFields`/`aliases` array to drift out of sync with the field list itself. `NTR_IMPORT_CONTRACT` (`src/features/ntr/services/ntrImportFields.ts`) is NTR's own instance; `NTR_IMPORT_FIELDS`/`NTR_IMPORT_TEMPLATE_META` remain separately exported only because a couple of call sites (the error-label map) need just the field list.

## Import Wizard (5 steps)

`src/shared/import/components/ImportWizard.tsx` + `StepIndicator.tsx` — a pure UI shell (progress indicator + Card-wrapped content area). It has no upload/parsing/business logic and no knowledge of any module; a module's own page component (`src/features/ntr/components/legacy-import-tool.tsx`) owns all step transitions, API calls, and step content.

1. **Download Template** — `ImportTemplateService.buildImportTemplate()`
2. **Upload File** — drag & drop or file picker; `.xlsx`/`.csv`
3. **Preview & Validation** — counts + column mapping report + per-row reasons, before any database write
4. **Confirm Import** — explicit confirmation screen, not a dialog
5. **Import Complete** — final counts, downloadable result/error CSV, link back to Step 1

## Parser

`ImportParser.ts` (`parseImportFile()`) reads a `.xlsx`/`.csv` down to a header row + raw trimmed-string data rows. This is the "parser logic" the spec says never to modify per module — it has no business field knowledge, handles empty-row skipping, stopping at the last non-empty row, and safely stringifying rich-text/hyperlink/formula-result cells (never falling through to the literal text `"[object Object]"`, the exact defect class the spec called out).

Module-specific type coercion (date/number parsing, enum normalization) is supplied per field via `ImportFieldDefinition.parse`, not hardcoded in the parser.

## Column Mapping

`ColumnMappingService.ts` matches an uploaded file's header row against a module's `ImportContract` by alias (`HeaderNormalizer.ts` normalizes case/whitespace/separators before comparing), independent of column order. A module lists genuine synonyms only — its own `canonicalKey` and `displayLabel` are always recognized automatically.

```ts
{ canonicalKey: 'dealer_id', displayLabel: 'Dealer Code', required: true, aliases: ['Dealer', 'Dealer_ID', 'DealerCode', 'dealer_code'] }
```

Future modules extend only their own field-definition list — the mapping engine itself is never touched.

## Template Version & Header Validation

`ImportTemplateService.buildImportTemplate()` generates one `.xlsx` with three sheets: **Instructions** (per-column guidance), **Data** (the actual header row to fill in), and **`_META`** (Template Name, Template Version, Module, Generated Date). `ImportTemplateValidator.readTemplateMeta()` reads `_META` back on upload (an absent `_META` — a `.csv`, or a hand-built spreadsheet predating the wizard — is expected, not an error); `validateHeader()` then checks required columns are present via `ColumnMappingService`. Only a missing **required** column blocks import; an absent optional column never does.

## Standard Import Result DTO

`ImportResult` (`types.ts`) is the canonical response shape every module's import pipeline is meant to return once it fully adopts the framework:

```ts
interface ImportResult {
  totalRows; readyRows; importedRows; skippedRows; duplicateRows; failedRows;
  warningCount; errorCount; warnings: ImportWarning[]; errors: ImportErrorEntry[];
  processingTime: number | null; // ms
}
```

`ImportPreviewBuilder.buildImportResult(rows, { importedRows, warnings?, processingTimeMs? })` builds it from the same per-row outcomes `buildImportSummary()` already uses for `ImportSummary` (Step 3/5's UI shape). NTR's own routes still return `NtrImportPreview` (predates this DTO) — changing that is a UI-facing/NTR-functionality change, explicitly out of scope for the framework-hardening pass that introduced `ImportResult`. **Future modules should return `ImportResult` directly from day one.**

## Import Lifecycle

1. **Upload** → generic sheet read (`ImportParser.parseImportFile()`)
2. **Header Validation** → `ImportTemplateValidator.readTemplateMeta()` + `validateHeader()` against the module's `ImportContract` — a file missing all its required columns is rejected here, before a session/row is ever created
3. **Column Mapping** → `ColumnMappingService.mapHeaders()`/`columnIndexFor()`
4. **Per-field coercion** → each `ImportFieldDefinition.parse` (or default trimmed-string-or-null)
5. **Business validation** → 100% inside the module's own service (dealer/master-data lookups, duplicate detection — never in the framework); `ImportContract.validators`, if a module declares any, run here too for field-shape checks that don't need repository access
6. **Preview** → `ImportPreviewBuilder.buildImportSummary()` (UI) / `buildImportResult()` (standard DTO) — nothing written to the database yet
7. **Confirm Import** → explicit user confirmation (Step 4)
8. **Commit** → the module's own repository/service performs the actual writes (for NTR: one atomic Postgres transaction per row via `commit_ntr_legacy_import_row()` — see ADR-008)
9. **Import Complete** → same DTO shape as Step 6, now reflecting what actually committed
10. **Archive** (NTR-specific today, not part of the generic framework) → background, retryable, never able to roll back a successful commit — see ADR-008

## Error Reporting

`ImportErrorFormatter.ts` rewrites a handful of known technical reason strings (`Unknown dealer_id "X"`, `Missing X`, the duplicate-detection/transactional-race messages) into business-facing language, given a module-supplied `canonicalKey -> displayLabel` map. Anything it doesn't recognize passes through unchanged — a best-effort layer, never lossy. A file that doesn't recognize any of its required columns at all is rejected up front with `formatUnsupportedTemplateMessage()` ("Uploaded file is not a supported import template"), before a session is even created.

## Import History

`ImportHistoryService.ts` is a fan-out/merge layer, not a shared table — each module keeps owning its own session storage (NTR's `ntr_import_sessions` today). A module registers an `ImportHistoryProvider { module, list() }`; `listImportHistory()` merges and sorts whatever providers exist. Today there is exactly one provider (NTR), so the "Module" column in the UI is currently a static `'NTR'` label rather than a real per-row field — this becomes a real per-provider value with zero changes to this file once a second module registers.

`ImportHistoryEntry` also carries `rowsPerSecond`/`averageValidationTimeMs` alongside `durationMs` — informational fields only (`ImportMetrics.ts` computes them from measurements a caller already took; nothing in the framework branches on them). Not yet wired into NTR's live data (would require timing `NtrImportService.preview()`/`commit()`, an NTR-service change out of scope for this pass) — available for any module (or a future NTR follow-up) to populate.

## Performance Metrics

`ImportMetrics.ts` — pure arithmetic, no timers of its own:

- `computeRowsPerSecond(rowCount, durationMs)`
- `computeAverageValidationTimeMs(totalValidationTimeMs, rowCount)`
- `computeImportPerformanceMetrics({ rowCount, durationMs, validationTimeMs? })` — combines both into `{ processingTimeMs, rowsPerSecond, averageValidationTimeMs }`

A module measures its own durations (`Date.now()` around `preview()`/`commit()`) and passes them in; this file only does the division/rounding, consistently, once.

## Future Module Adoption

To onboard a new module (e.g. Vehicle Master):

1. Define its `ImportContract` (fields + `templateName`/`templateVersion`/`module`, optional `validators`) + instruction text (mirrors `src/features/ntr/services/ntrImportFields.ts`'s `NTR_IMPORT_CONTRACT`).
2. Reuse `parseImportFile()`/`ColumnMappingService`/`buildImportTemplate()`/`validateHeader()` as-is — do not fork or copy them.
3. Keep all business validation (duplicate detection, master-data lookups) in that module's own service, exactly as `NtrImportService` does — the framework never gains module-specific business logic.
4. Reuse `ImportWizard`/`StepIndicator` for the UI; supply the module's own step content.
5. Return `ImportResult` (via `ImportPreviewBuilder.buildImportResult()`) from the module's API from day one, rather than inventing a bespoke response shape the way NTR's (pre-dating this DTO) `NtrImportPreview` did.
6. Register an `ImportHistoryProvider` so its runs appear in the shared Import History view; populate `ImportMetrics` if per-run performance data is wanted.

Out of scope for this framework (unchanged by this work): NTR's own business rules, Vehicle/NTR record creation, the Timeline/Audit platforms, Google Drive, and the Archive Worker (`NtrImportService.archiveSession()`/`processArchiveQueue()` — see `docs/adr/ADR-008-Google-Drive-Decoupling.md`).
