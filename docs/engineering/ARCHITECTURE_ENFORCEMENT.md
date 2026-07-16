# Architecture Enforcement

`scripts/architecture-check.ts` (`npm run architecture`) is the first
automated check for the boundary rules `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`
documents as policy. Before this milestone, every compliance finding in
`docs/engineering/STORAGE_PLATFORM_FINAL.md`/`docs/releases/STORAGE_PLATFORM_RELEASE.md`
was produced by manual `grep`/read-through - this script makes the same
checks repeatable and CI-able (once wired in - see "CI integration"
below).

## Why a plain regex scan, not a full TypeScript AST/import-graph tool

The violations this tool looks for are all shape-level: "does file X's
import statement mention symbol Y from module Z," "does file X call
`new SomeClass(...)`," "does a same-folder relative import form a
cycle." A regex scan over each file's `import ... from '...'`/
`require(...)` statements answers all of that without adding a
`ts-morph`/`typescript` compiler-API dependency for what is, today, a
small, well-defined rule set. If a future rule needs real type
information (e.g. "flag any variable typed `StorageProvider` regardless
of how it got that type"), upgrading to the TypeScript compiler API is
the natural next step - not required by anything this milestone asks
for.

## Validation rules

| # | Rule | Scope | Failure mode |
| --- | --- | --- | --- |
| 1 | Business modules never import platform internals (`StorageProvider`, `CloudflareR2Provider`, `SupabaseStorageProvider`, `GoogleDriveStorageProvider`, `StorageProviderFactory`, `AttachmentRepository`) from `@/shared/attachments`, and never deep-import a specific file under `@/shared/attachments/*` (must go through the barrel). | `src/app/`, `src/features/`, `src/components/`, `src/middleware.ts` | FAIL |
| 2 | Business modules never import a raw SDK (`@aws-sdk/*`, `googleapis`/`google-auth-library`, `@supabase/*`, `@cloudflare/*`) directly. | Same as above | FAIL |
| 3 | Only `AttachmentService` (+ the documented operational-surface exception) references the `StorageProvider` interface directly. | `src/shared/attachments/*.ts` (excluding `__tests__`) | FAIL |
| 4 | Only `StorageProviderFactory` constructs a concrete provider (`new SupabaseStorageProvider()`/`new GoogleDriveStorageProvider()`/`new CloudflareR2Provider()`). | All of `src/` (excluding `__tests__`) | FAIL |
| 5 | No circular dependency exists among the (non-test) files inside `src/shared/attachments`. | `src/shared/attachments/*.ts` (excluding `__tests__`) | FAIL |
| 6 | No `class *Repository`/`class *Service` defines a field initializer (or constructor-body statement) that performs eager runtime work - a direct lowercase-named function call (`getSupabase()`, `createClient()`, `fetch(...)`) or a direct `process.env` read - at the class's own body level. `new PascalCase(...)` is not flagged (recursively fine, checked when that class's own file is scanned); a lazy `get x()` accessor is the required, exempt pattern. See `docs/standards/SERVICE_CONSTRUCTION_STANDARD.md`. | All of `src/` (excluding `__tests__`) | FAIL (new violations); pre-existing legacy count is grandfathered per file, see below - it cannot increase |

Every rule prints `PASS` (zero violations) or `FAIL` (one or more,
listed by file). The script has no `WARNING`-producing rule of its own
today - `WARNING` is currently used only for the one honest tooling gap
noted below (CI integration), not for a source-code finding. Exit code
is `1` if any of the six rules FAILs, `0` otherwise - safe to use as a
CI gate.

## Rule 3's allowlist - the documented operational-surface exception

The milestone that requested this rule describes it as "only
`AttachmentService` may access providers." Read completely literally,
that would FAIL `OrphanCleanupService.ts`, `StorageHealthService.ts`,
and `StorageScheduler.ts` - all three legitimately hold a
`StorageProvider` reference today, by explicit design approved in the
Storage Operations and Platform Freeze milestones
(`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s "Platform service
boundaries" section documents exactly this: the maintenance layer reads
a provider directly because its job is to detect when
`AttachmentService`'s own invariants have already broken - something its
normal abstraction can't see past by design).

Rather than either (a) silently weakening the rule to "anything in
`src/shared/attachments/` is fine" - which would defeat the rule's
purpose - or (b) reporting a FAIL against code that was already reviewed
and approved as correct, this tool encodes the actual, documented
exception as an explicit allowlist
(`PROVIDER_ACCESS_ALLOWLIST` in `scripts/architecture-check.ts`):
`AttachmentService.ts`, `StorageProviderFactory.ts`, the three concrete
provider files (they implement the interface), `OrphanCleanupService.ts`,
`StorageHealthService.ts`, `StorageScheduler.ts`. Any other file under
`src/shared/attachments/` that references `StorageProvider` is a FAIL.
Adding a new file to this allowlist should always come with an update to
`PLATFORM_ARCHITECTURE_STANDARDS.md` explaining why it needs the exception - the
allowlist is meant to track the constitution, not drift ahead of it.

## Rule 6's allowlist - grandfathered legacy debt, not a permanent exception

A real bug of exactly this shape broke a production build (PR #45): a
page constructed `NtrService` at module scope, and `SupabaseNtrRepository`
eagerly calls `getSupabase()` in a class field initializer - the moment
Next.js's build imported that page module (before any request, before
any env var was necessarily available in that phase), the eager call
threw. Rule 6 exists so this class of defect fails Architecture Check
immediately, anywhere, rather than surfacing only when some future page's
import order happens to trigger it again.

Read completely literally against the *existing* codebase, Rule 6 would
also FAIL four other files that already have this exact pattern, none of
which this milestone introduced or touched:
`supabaseMaintenanceRepository.ts`, `supabaseNtrImportSessionRepository.ts`,
`supabaseNtrRepository.ts` (the one PR #45 actually tripped over),
`supabaseRepository.ts` (Vehicle Event). Fixing all four in the same pass
as this milestone would mean editing unrelated modules (Maintenance, NTR,
Vehicle Event) for a documentation/tooling refinement - disproportionate
scope creep, and exactly the kind of change this milestone's own brief
says not to make ("do not redesign," "update the existing PR only").

Rather than either (a) silently weakening the rule until it stops
catching this shape at all, or (b) reporting a FAIL against code that
predates this rule and isn't part of this change, the four are
grandfathered via an explicit, per-file **count** allowlist
(`EAGER_CONSTRUCTION_ALLOWLIST` in `scripts/architecture-check.ts`) -
temporary technical debt, not a permanent exception:

- The rule still FAILs immediately on any **new** file with this pattern
  (not in the list) - the actual protection this milestone exists to add.
- The rule still FAILs if any **already-listed** file's violation count
  *increases* (e.g. a second eager field added to `supabaseNtrRepository.ts`)
  - the grandfathered count can only shrink (as each file is migrated to
    lazy initialization), never grow.
- Per `docs/standards/SERVICE_CONSTRUCTION_STANDARD.md`'s Migration
  Guidance: whoever next makes a *functional* (non-documentation) change
  to one of these four files must migrate it to the required lazy
  pattern first, as part of that change - not indefinitely deferred.

## Forbidden imports (full list)

**Business modules must never import, from `@/shared/attachments`:**
`StorageProvider`, `CloudflareR2Provider`, `SupabaseStorageProvider`,
`GoogleDriveStorageProvider`, `StorageProviderFactory`,
`AttachmentRepository`. (`AttachmentService`, `Attachment`,
`AttachmentType`, `toUserFacingAttachmentError`, and the orphan/storage-operations
types are all fine - the barrel intentionally also exports
`OrphanCleanupService` for the one existing admin/operational API route
that legitimately needs it, `/api/attachments/orphan-cleanup` - that
route is not a business module and is exempt from Rule 1 by definition,
the same as any other file under `src/app/api/`.)

**Business modules must never import**, from any specifier: `@aws-sdk/*`,
`googleapis`, `google-auth-library`, `@supabase/*`, `@cloudflare/*`.

## Dependency rules enforced

- Business modules → platform services (`AttachmentService`) only, never
  platform internals or a raw SDK (Rules 1-2).
- Only the platform's own designated files touch a `StorageProvider`
  directly (Rule 3), and only `StorageProviderFactory` constructs one
  (Rule 4) - matching `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s
  Dependency Rules and Storage Rules sections.
- The platform's own internal file graph stays acyclic (Rule 5) - a
  cycle inside `src/shared/attachments` would make the module graph hard
  to reason about and is exactly the kind of drift a freeze is meant to
  prevent, even though nothing here today has one.
- Every Repository/Service is safe to construct anywhere, including at
  module scope (Rule 6) - matching `docs/standards/
  SERVICE_CONSTRUCTION_STANDARD.md`'s "constructors must be side-effect
  free" rule. This is what makes the pervasive, otherwise-unremarkable
  `const service = new XxxService();` pattern at the top of nearly every
  page/route handler in this app safe in the first place.

This script does not yet check the platform's other documented boundary
rules (e.g. "a module may not import another module's internals
directly," "`shared/` never imports from a business module" as a fully
general rule beyond the Storage Platform specifically) - it is scoped to
what this milestone asked for. Extending it to the rest of
`PLATFORM_ARCHITECTURE_STANDARDS.md`'s Dependency Rules is a natural, separate
future step, not assumed here.

## CI integration

**Wired in** (Release Preparation milestone). `.github/workflows/ci.yml`
now runs `npm run architecture` immediately after `npm ci`, before
`Type check`/`Lint`/`Test`/`Build` - a misconfigured boundary fails fast,
before spending time on the rest of the pipeline:

```yaml
      - name: Install dependencies
        run: npm ci

      - name: Verify architecture
        run: npm run architecture

      - name: Type check
        run: npx tsc --noEmit
```

`npm run architecture` exits non-zero on any Rule 1-6 FAIL (the `CI
Integration` WARNING the script itself prints does not affect its exit
code), so this step fails the whole workflow run exactly like any other
step here.

## Known gap: a permanent `tsx` devDependency

`scripts/architecture-check.ts` is a real `.ts` file, run via `tsx`
(added as a new devDependency for this milestone) rather than Node's own
native TypeScript type-stripping (available unflagged since Node 23.6) -
CI (`.github/workflows/ci.yml`) pins Node 20, which has no native
TypeScript support at all, so relying on the local dev machine's newer
Node version would make this script pass locally and fail (or simply not
run) in CI. `tsx` is devDependency-only - never shipped in the deployed
app - the same category of addition as `@tanstack/react-table`/`exifr`/
`jszip`-class dependencies documented elsewhere in this project's own
history, each added deliberately for one clear purpose rather than
casually.

## Running it

```bash
npm run architecture
```

Exits `0` (all PASS) or `1` (one or more FAIL). Output lists every
violating file and the specific rule it broke.
