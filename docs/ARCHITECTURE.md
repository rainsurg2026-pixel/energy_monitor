# Architecture

> Status as of Sprint 1 (Repository Foundation). This document describes
> **two things side by side**: the architecture as it actually runs in
> production today, and the target modular architecture this repository is
> being grown into. As of Sprint 1, only the target folders exist
> (`modules/`, `shared/`, `templates/`) — nothing has been moved. The
> "current" column below is still 100% accurate.

For the full original deep-dive this document is distilled from, see
`STARTER_ANALYSIS.md` at the repo root.

## 1. Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2.35, App Router, TypeScript |
| Styling | Tailwind CSS 3 |
| Database | Supabase (Postgres 17, region `ap-northeast-2`), RLS enabled on every table |
| Auth | Custom JWT (`jose`, HS256) — **not** Supabase Auth |
| File storage | Google Drive, OAuth2 real-account client |
| Vehicle master feed | Public Google Sheet, read via `gviz` CSV export |
| Email | Resend |
| Hosting | Vercel (Hobby plan), auto-deploy on push to `main` |

## 2. Current architecture (production today)

Everything lives under `src/`. There is one Next.js app, one Supabase
project, one Drive account. There is no module boundary — `src/app/(app)/*`
pages and `src/lib/*` shared code all belong to a single implicit module
("MQR").

Request lifecycle, typical case (loading the records list):

1. `middleware.ts` checks the `mqr_session` cookie exists; otherwise redirects
   to `/login`.
2. The page is a Server Component (`src/app/(app)/records/page.tsx`). It
   calls `getSession()` again (cheap re-check), then calls into `db.ts`
   (`listRecords()`), which Supabase-queries through `applyScope()` —
   filtering by the caller's dealer/role *in addition to* Postgres RLS.
3. The page renders server-side and ships HTML; any further mutation
   (status update, delete, photo edit) happens through a Client Component
   calling a same-origin `/api/...` route via `fetchJson.ts`.
4. API routes re-validate the session and re-check scope **independently**
   of whatever the client believed — every write is defended twice (RLS +
   `applyScope`) and revalidated server-side regardless of what the request
   body claims.
5. User-visible feedback for any async action goes through `swal.ts`
   (SweetAlert2) exclusively — there is no other UI feedback mechanism in
   the app.

Architectural character worth preserving in the target design:
- **Server-component-first, API-route-mutation-second.** Reads are cheap
  server-rendered queries; writes are explicit, auditable API calls.
- **Defense in depth.** Tenant isolation is enforced at the database layer
  (RLS) *and* the application layer (`applyScope`) — neither is trusted
  alone.
- **No client-side state library, no ORM, no schema-validation library, no
  test framework.** Validation is hand-written and intentionally duplicated
  between client and server (the server copy is the one that matters for
  security; the client copy is only for UX).

## 3. Current folder map (`src/`)

```
src/
  app/
    (app)/                 route group — pages behind the session check
      dashboard/           KPI dashboard + recharts wrappers
      report/              new-record form
      records/             list + [jobId] detail/print
      admin/               dealers / branches / technicians / users / problem-codes (5x duplicated CRUD pattern)
      sidebar.tsx, layout.tsx, language-toggle.tsx
    api/
      auth/login, logout
      records/, records/[jobId]/
      upload/, upload/init, upload/chunk, upload/finalize
      vehicles/search, vehicles/list
      admin/dealers, admin/branches, admin/technicians, admin/users, admin/problem-codes (+ [id] routes)
    login/page.tsx
    globals.css
  lib/
    auth.ts, scope.ts, db.ts, supabase.ts
    types.ts, thaiDate.ts, warranty.ts
    googleDrive.ts, email.ts, tractorSheet.ts
    exportPdf.tsx, exportExcel.ts
    fetchJson.ts, swal.ts
  middleware.ts
```

(Repo root also currently holds some local artifacts — `.patch` files, log
files — left over from earlier patch-based deploys. Out of scope for
Sprint 1; tracked separately, not touched here.)

## 4. Target folder map

```
modules/        — one folder per business module (mqr, pdi, warranty, parts, ntr, dashboard)
shared/         — cross-module code (today's src/lib, relocated mechanically in Sprint 2)
templates/      — copy-and-fill scaffolds for new modules/resources
docs/           — this document and its siblings
.claude/        — AI-agent knowledge base (rules, skills, prompts, playbooks)
src/            — unchanged until each migration sprint actually moves something out of it
```

See `docs/MODULE_GUIDE.md` for the module contract and `docs/ROADMAP.md` for
the sprint sequence that gets from here to there.

## 5. Two-layer tenant isolation (must survive any future refactor)

Every table has Postgres RLS **and** every query in `db.ts` passes through
`applyScope()`, which adds a dealer/role filter in application code. Both
layers do soft-delete filtering too (`record_status` / `deleted_by` /
`deleted_at` — only the `users` table supports a true hard delete, and only
for `SuperAdmin`). Any new module's data layer must replicate both layers,
not just one — this is the single most important non-negotiable rule
carried forward from the current app into the target architecture.

## 6. Known gaps (carried into `docs/ROADMAP.md` as open items)

- No shared React hooks exist anywhere in the codebase today (state is
  inline `useState`/`useEffect`, module-level caches, or Server Components).
- No schema-validation library (no zod/yup) — validation is hand-written and
  duplicated between client and server.
- No automated tests of any kind.
- Dashboard aggregation runs in JavaScript over up to 5000 rows pulled from
  Postgres, not in SQL — a scale risk once record volume grows.

These are documented, not fixed, in Sprint 1. Fixing them is a deliberate
later decision (see `docs/ROADMAP.md`), not an accidental side effect of
adding folders.
