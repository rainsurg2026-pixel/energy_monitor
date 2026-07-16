# Development Guide

Coding conventions for this repository, current and target. Nothing here
changes existing code by itself — it documents the standard that new code
(and, eventually, migrated code) is held to.

## 1. Definition of Done

Every change, regardless of size, follows: **Analyze → Design → Plan →
Implement → Test → Refactor → Document.** Concretely:

1. Read `CLAUDE.md` (root) and `docs/ARCHITECTURE.md` before touching code.
2. Check `.claude/rules/` for the convention area you're touching.
3. Prefer reuse — check `shared/`, `templates/`, and existing modules before
   writing something new.
4. Never leave a `TODO`, never use fake/placeholder data unless explicitly
   asked for, never guess at an unclear requirement — ask.
5. Manually verify the change (no automated test suite exists yet — see
   §6) before considering it done.

## 2. TypeScript conventions

- No implicit `any`. Use the interfaces in `types.ts` (or the module's own
  `types.ts` once modules exist) rather than re-declaring shapes inline.
- Prefer explicit return types on exported functions in `lib`/`shared` code.
- File naming: kebab-case for files (`report-form.tsx`), PascalCase for
  component/type names, camelCase for functions and variables.
- Pages under `(app)/` are Server Components by default; add `'use client'`
  only to the smallest subtree that actually needs interactivity (the
  existing pattern: a thin Server Component page that renders a Client
  Component for the interactive form/table).

## 3. Styling conventions

- Tailwind only, mobile-first. Always specify the base (mobile) style, then
  layer `sm:`/`md:`/`lg:` overrides — never the reverse.
- Use the brand tokens already defined in `tailwind.config.ts`
  (`brand.red`, `brand.dark`, `brand.gray`, the `card`/`card-hover`/`glow`
  shadows, the `gradient-primary`/`gradient-dark` backgrounds) instead of
  hard-coded hex values or ad-hoc shadows.
- Reuse the existing small class vocabulary in `globals.css` (`.card`,
  `.btn-*`) rather than inventing parallel one-off classes.

## 4. Non-negotiable conventions (see `.claude/rules/` for the full list)

- **Timestamps**: any timestamp shown to a user goes through the shared
  Thai/GMT+7 date formatter — never `Date.toString()` / `toLocaleString()`
  called directly, ever (this has caused real bugs before).
- **Feedback**: SweetAlert2 (`swal.ts`) is the only UI feedback mechanism.
  No `alert()`, no inline ad-hoc error banners.
- **Data access**: all Supabase access goes through the shared db layer.
  No component or API route talks to Supabase directly.
- **Soft delete only** for business data; RLS + `applyScope()` both apply to
  every new table.
- **Permissions**: role checks only via the shared `scope.ts` predicates —
  never an inline `if (role === 'SuperAdmin')` scattered in a route.
- **API envelope**: every API route returns `{ ok: true, ... }` or
  `{ ok: false, error: string }` — no exceptions.

## 5. Git / deployment workflow

This project is sometimes worked from environments **without a local git
CLI or a clean clone** (see `.claude/playbooks/deploy-without-git-cli.md`).
Where that's the case, changes are committed directly through the GitHub
web UI (`Add file → Upload files`), and Vercel auto-deploys `main` on every
push. Where a real local clone with push access exists, normal practice
applies: one logical change per commit, descriptive commit messages,
push to `main` (there is currently no branch/PR workflow — direct-to-main
is the existing convention, not something Sprint 1 is changing).

After any deploy that touches a user-facing flow, do a live manual check —
a CI pipeline (`.github/workflows/ci.yml`) now runs on every push/PR, but
it validates the code (typecheck/lint/test/build), not a live deployment,
so this manual check is still the only way to catch a real runtime
regression before it reaches users.

## 6. Testing (partial — service/repository/API layers, not yet full UI coverage)

Vitest was introduced for the PM Record module (technical name
`maintenance` since the Architecture Refactoring pass —
`src/features/maintenance/`, `src/app/api/pm-records/`) — unit tests for
the service/repository layers plus API integration tests, all run in CI.
The Production Stabilization Sprint extended this to shared platform code
and MQR's non-UI logic: `lib/db.ts`'s audit log
(`logAuditEvent`/`diffFieldsForAudit`), the MQR status transition state
machine, `listRecordsPaginated()`, `exportCsv.ts`, the Maintenance Program
versioning resolver/sync functions, and the PM lock-evaluation logic
(`evaluateMaintenanceLock()`) all now have unit test coverage. React UI
components (`records`/`report`/`admin/*`/`pm-records` pages and forms)
still have no automated coverage; verification there remains manual:
exercise the changed flow in the deployed app, check the relevant Supabase
tables/RLS where applicable, check Vercel function logs for server errors.
Extending automated coverage to the UI layer is tracked as an open item
in `docs/ROADMAP.md`, not something this guide pretends is solved.

## 7. Environment variables

Documented in full in the root `CLAUDE.md`. Never commit a real secret to
the repo or paste one into a command — `.env.local` (gitignored) and
Vercel's project environment variables are the only places secrets live.
