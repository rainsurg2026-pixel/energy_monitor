# Repository Structure Map

> **v3.0 Foundation Hardening note (ADR-032):** the `src/features/`
> list below was stale (missing `delivery/`, `inspection/`, `knowledge/`,
> `mqr/`) - corrected in this pass. See
> `docs/architecture/V3_FOUNDATION_HARDENING_AUDIT.md` for the current
> feature-module-grain ownership/dependency detail this map doesn't go
> into.

## Relationship to existing documents

Root `CLAUDE.md` §4 already has a repository-structure listing for
`src/`. **This document does not restate it** - it adds the top-level
(outside `src/`) map `CLAUDE.md` doesn't cover, and cross-references each
area to the governance document that owns it, which no prior document
does. Verified directly against the actual working tree
(`ls -d */`, `ls src/`, `ls src/features/`, `ls -d docs/*/`) at the time
of writing, not copied from memory.

## Top-Level Map

| Path | Purpose | Governed by |
|---|---|---|
| `src/` | All working application code | `CLAUDE.md` §4 (detailed layout), `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` (layer rules) |
| `docs/` | All documentation | `DOCUMENTATION_HIERARCHY.md`, `DOCUMENTATION_POLICY.md` |
| `.claude/` | Claude Code configuration, rules, skills | `REPOSITORY_POLICY.md` §4, `SKILL_GOVERNANCE.md` |
| `public/` | Static assets (Next.js convention) | Not separately governed - standard framework convention |
| `scripts/` | One-off operational scripts (e.g. `architecture-check.ts`, OAuth setup) | `docs/engineering/ARCHITECTURE_ENFORCEMENT.md` for `architecture-check.ts` specifically |
| `modules/`, `shared/` (top-level, **not** `src/shared/`), `templates/` | **Sprint-1-era scaffolding - placeholder-only, no executable code** | `.claude/CLAUDE.md`'s "Sprint 1 status" section (binding: do not move code here without an explicit approved sprint task); `.claude/rules/01-architecture-boundaries.md` |
| `node_modules/` | Dependencies | N/A |

**The most important trap in this map**: top-level `shared/` and
`src/shared/` are two different directories with confusingly similar
names. `src/shared/` is real, active platform-service code (`src/shared/
import/`, `src/shared/master-data/`, `src/shared/attachments/`). Bare
`shared/` at the repository root is Sprint-1 scaffolding - placeholder
only. Do not confuse the two when reading a path in an ADR or this
framework; every reference in this governance framework to a platform
service means `src/shared/`, never the top-level placeholder.

## `src/` (detailed - see `CLAUDE.md` §4 for the file-level listing this doesn't repeat)

| Directory | Owns |
|---|---|
| `src/app/` | Routes (App Router) - `login/`, `(app)/` (authenticated shell), `api/` |
| `src/components/` | Shared UI (`components/shared/`) - see MSEAL Design Framework (ADR-023) for the widget/layout/form catalog |
| `src/features/` | Business modules - currently `delivery/`, `inspection/`, `knowledge/`, `machine/`, `maintenance/`, `maintenance-due/`, `mqr/`, `ntr/`, `vehicle/`, `vehicle-event/`, `vehicle-health/` (re-verified via `ls src/features/`, v3.0 Foundation Hardening pass) - each is a bounded context per `02-DOMAIN-MODEL-AND-CONTEXT-MAP.md`. Note `mqr/` holds only its `VehicleSummaryProvider` - MQR's own service/repository logic still lives directly in `src/lib/db.ts`, unlike every other module here (see `V3_FOUNDATION_HARDENING_AUDIT.md` §11.2) |
| `src/lib/` | Infrastructure - direct external-system integration (Supabase, Google Drive, Resend, JWT) per `PLATFORM_ARCHITECTURE_STANDARDS.md`'s layer table |
| `src/shared/` | Platform services - `import/` (ADR-024, ex-ADR-009), `master-data/` (ADR-011/012), `attachments/` (ADR-010) |
| `src/locales/` | i18n dictionaries (`th.json`/`en.json`) |
| `src/types/` | Cross-cutting TypeScript types |
| `src/middleware.ts` | Auth gate - excludes `/fonts/*` |

## `docs/` (top-level subdirectories, verified via `ls -d docs/*/`)

| Directory | Owns | Frozen? |
|---|---|---|
| `docs/adr/` | Every ADR + `README.md` (the ADR Index, this pass) | ADR-009/010/011/014 individually frozen per Foundation Freeze; the directory itself is not |
| `docs/architecture/` | Living architecture documents + `blueprint/` (the frozen Baseline) | `blueprint/` frozen; the rest living |
| `docs/deployment/` | Deployment runbooks | Not frozen |
| `docs/engineering/` | Engineering-level detail docs (e.g. `IMPORT_FRAMEWORK.md`, `MACHINE_DOMAIN.md`, `ARCHITECTURE_ENFORCEMENT.md`) | Not frozen |
| `docs/governance/` | This framework | Governed by itself (`README.md`) |
| `docs/import/` | Import-specific operational docs | Not frozen |
| `docs/operations/` | Operations handbook material | Not frozen |
| `docs/release/`, `docs/releases/` | Release notes (two directories - see Gap Analysis) | Not frozen |
| `docs/roadmap/` | Phase plans (e.g. `PHASE_6_PLAN.md`) | Not frozen |
| `docs/standards/` | Binding standards (API/Security/Database/Testing/etc.) | Individually binding, not "frozen" in the Architecture-Freeze sense unless cited as such |
| `docs/*.md` (root-level, no subdirectory) | Foundational/living docs (`ROADMAP.md`, `VISION.md`, `PRODUCT_PHILOSOPHY.md`, `CORE_DOMAIN_MODEL.md`, etc.) | Not frozen, except where they cite a frozen decision |

## `.claude/`

| Path | Purpose | Governed by |
|---|---|---|
| `.claude/CLAUDE.md` | AI-agent entry point (this repo's own operating rules for an assistant) | Itself; read alongside root `CLAUDE.md` |
| `.claude/rules/` | Binding, granular rules (architecture boundaries, coding standards, data access/security, UI feedback, git safety) | Cited throughout this framework, not restated |
| `.claude/skills/` | Gitignored by default; a small official set is tracked | `REPOSITORY_POLICY.md` §4, `SKILL_GOVERNANCE.md` |
| `.claude/playbooks/`, `.claude/prompts/` | Operational procedures / reusable prompt templates | Not separately governed by this framework |

## Gap Analysis

- **`docs/release/` vs `docs/releases/`** - two similarly-named
  directories exist side by side. Not investigated further in this pass
  (out of scope for the specific governance blockers this refinement
  targets) - flagged as a real, likely-accidental duplication worth a
  follow-up consolidation, consistent with `DOCUMENTATION_POLICY.md`'s
  own "check before creating a second one" rule having apparently been
  missed once already here too.
- This map reflects the repository structure at the time of writing
  (verified via direct `ls`, not memory) - re-verify before citing it if
  significant time has passed, per this framework's own general caution
  about snapshot documents (`MODULE_MATURITY_MATRIX.md`'s closing note
  makes the same point).
