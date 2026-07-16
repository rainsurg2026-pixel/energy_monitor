# ADR-024: Universal Import Framework

Note: requested as `ADR-008-Universal-Import-Framework.md`; renumbered to `ADR-009` because `ADR-008-Google-Drive-Decoupling.md` (this same branch's prior commit) already occupies that slot.

**Renumbered again, `ADR-009` → `ADR-024`, by the Platform Governance Framework's ADR normalization pass** (`docs/governance/DOCUMENTATION_POLICY.md`, `docs/adr/README.md`): `ADR-009-Machine-Domain.md` was committed one day after this file and independently reused the same number, producing a real duplicate-ADR-number defect on `main`. Machine-Domain's number is cross-referenced roughly 25 times across the frozen Architecture Blueprint itself (chapters 02/10/11/13/14/16/17/20, its README) plus `PLATFORM_ARCHITECTURE_STANDARDS.md`, `PERMISSION_MATRIX.md`, `DOMAIN_LANGUAGE_STANDARD.md`, `ADR-013`, `AI_CONTEXT.md`, and `PROJECT_STATE.md` - renumbering it would mean editing frozen Baseline content, which itself requires 20's Breaking Change Process for a documentation-hygiene fix, wildly disproportionate to the problem. This file's only real cross-reference outside its own filename was `docs/engineering/IMPORT_FRAMEWORK.md` (one line, now updated) - renumbering it instead resolves the duplicate with the Baseline itself untouched. `ADR-024` was chosen because `ADR-015`-`ADR-021` are reserved by `16-ADR-RECOMMENDATIONS.md` for specific named future blueprint-domain ADRs this file isn't one of, and `ADR-022`/`ADR-023` are already claimed by other in-flight PRs (#36, #37) at the time of this renumbering - `ADR-024` was the next number free on all three counts.

**Known follow-up, not fixable from this branch**: `docs/adr/ADR-022-Import-Platform-v2.md` (proposed, PR #36) references this ADR by its old number ("ADR-009-Universal-Import-Framework") since it was written before this renumbering and lives on an independent branch. Whoever merges this PR should update PR #36's reference to `ADR-024` before PR #36 itself merges - tracked in `docs/adr/README.md`'s own notes, not silently forgotten.

## Problem

NTR Legacy Import needed a 5-step wizard UX (Download Template → Upload → Preview & Validation → Confirm Import → Import Complete), and this is explicitly meant to become the standard import architecture for every future MASP module (Vehicle Master, PM, PDI, MQR, Campaign, Parts) — not a one-off NTR feature. Building it as NTR-specific code would mean re-deriving the same header-mapping, template-generation, and validation-flow logic once per module, with no guarantee any two implementations stay consistent.

At the same time, only NTR exists as a real consumer today. There is no second module to validate the abstraction against, which is exactly the situation `.claude/rules/01-architecture-boundaries.md` warns about ("shared/ only when at least two modules genuinely need it").

## Decision

Built `src/shared/import/` as a generic framework, parameterized entirely by a module-supplied `ImportContract`, with NTR as the first (and today, only) real consumer. Every module-agnostic piece — `ImportParser`, `ColumnMappingService`, `ImportTemplateService`, `ImportTemplateValidator`, `ImportErrorFormatter`, `ImportPreviewBuilder`, `ImportMetrics`, `ImportHistoryService`, and the `ImportWizard`/`StepIndicator` UI shell — depends only on `ImportContract` and has zero knowledge of NTR or any other module.

### Why Dynamic Header Mapping
A fixed-position parser (the original NTR implementation) breaks the moment a dealer reorders columns or a template gains a new column mid-list. Reading by header name instead of position means template evolution (adding a column) and minor user variation (a slightly different but recognizable header) both just work.

### Why Alias Mapping
Different dealers, exports, and legacy systems name the same business field differently ("Dealer" vs "Dealer Code" vs "DealerCode"). A single canonical field name with a declared alias list lets the mapper recognize all of them without the module writing per-file, per-variant special cases.

### Why a Shared Parser
The actual bytes-to-rows mechanics (reading `.xlsx`/`.csv`, skipping blank rows, stopping at the last real row, safely stringifying rich-text/hyperlink/formula cells) have nothing to do with any module's business fields. Keeping this in one place means a defect fixed once (e.g. the `"[object Object]"` cell-stringification bug) is fixed for every module, forever - a module only ever supplies field definitions and coercion functions, never a parser fork.

### Why Import Contracts
Before this pass, `ColumnMappingService`/`ImportTemplateService`/`ImportTemplateValidator` each took a bare `ImportFieldDefinition[]` plus a separately-passed `ImportTemplateMeta` - two parameters a caller could pass out of sync with each other. `ImportContract` unifies `module`/`templateName`/`templateVersion`/`fields` (and optional field-level `validators`) into one object, with `requiredFieldsOf()`/`optionalFieldsOf()`/`aliasesOf()` as pure derivations rather than separately-stored, independently-driftable arrays. Every generic framework piece now takes exactly one parameter type.

### Why the Business Adapter Pattern
`NtrImportService` (and any future module's own import service) is the adapter between the generic framework and real business logic: it owns validation (dealer existence, duplicate detection), persistence (via its own repository), and the module's actual database writes. The framework never reaches into a module's tables or business rules - it only ever hands the module parsed, mapped rows and receives back outcomes to summarize. This keeps `src/shared/import/` free of business logic permanently, regardless of how many modules adopt it.

## Alternatives Considered

- **Fork the parser per module** — rejected: exactly the duplication this framework exists to prevent; a bug fixed in one module's copy wouldn't be fixed in the others.
- **A single mega-config object per module (fields + validation rules + UI copy + template layout all in one file)** — rejected in favor of the current split (`ImportContract` for structure, the module's own service for business validation, module-specific instruction text passed separately to `ImportTemplateService`): keeps "business logic remains inside each module" true without the framework needing to interpret arbitrary validation rule objects.
- **Immediately migrating NTR's `NtrImportPreview`/routes to the new `ImportResult` DTO** — rejected for this pass: out of scope per this issue ("Do NOT modify NTR functionality," "Do NOT redesign the UI"). `ImportResult`/`buildImportResult()` exist now so a future, explicitly-scoped NTR migration (or any new module from day one) can adopt the standard shape without inventing a second one.

## Trade-offs

- The abstraction is unverified against a second real module until one actually adopts it - if the `ImportContract` shape turns out wrong for, say, PDI's needs, that surfaces only when PDI is built, not now.
- `NtrImportPreview` and `ImportResult` are two different response shapes today for the same underlying data - an intentional, temporary duplication rather than an unreviewed NTR-facing change.
- Performance metrics (`ImportMetrics.ts`) and `ImportHistoryEntry`'s new fields are informational-only and not wired into any live NTR data path yet - real per-run measurement requires a future NTR-specific change (measuring actual wall-clock time around `preview()`/`commit()`), deliberately deferred since it would touch NTR's service code, which is out of scope here.

## Consequences

- Any new module can define an `ImportContract` and reuse the entire pipeline (parse → map → template → validate header → preview/commit → archive) without touching `src/shared/import/`.
- NTR's actual import behavior, validation rules, and UI are unchanged by this pass - only the internal parameter shape (`ImportFieldDefinition[]` + separate meta → one `ImportContract`) changed, which is a pure refactor covered by the existing (and newly added) test suite.
- `docs/engineering/IMPORT_FRAMEWORK.md` is the living reference for onboarding the next module; this ADR is the historical record of why the framework looks the way it does.

## Future Expansion

A second module (most likely Vehicle Master or PM, per `docs/PROJECT_STATE.md`'s roadmap) should be the first real test of this abstraction. When one is built:

1. Define its own `ImportContract` + instruction text - no framework changes expected.
2. If its business validation needs field-level checks beyond `parse` coercion, use `ImportContract.validators` rather than inventing a parallel mechanism.
3. If `ImportResult`/`ImportMetrics` prove out, consider migrating NTR onto them too, as its own explicitly-scoped follow-up - not bundled into that module's onboarding.
