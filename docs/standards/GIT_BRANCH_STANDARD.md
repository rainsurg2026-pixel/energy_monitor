# Git Branch & Release Standard

Binding branch, versioning, and PR-gate convention for MASP, current and
future modules. Read alongside `.claude/rules/git.md`, which this
document does not override or relax — that file's hard restrictions on
what an AI agent may do unattended still apply in full; this document
adds the branch/release model humans (and an AI agent, once explicitly
approved per action) follow inside those restrictions.

## Branch model

| Branch | Purpose |
|---|---|
| `main` | Always production-deployable. Auto-deploys to Vercel on every push (Hobby plan, team `MSEAL`). Never receives a direct commit for feature work — only merges from `release/*`, `hotfix/*`, or an explicitly-approved direct fix. |
| `release/*` | Cut from `main` (or the last integration point) to stabilize a version before it ships — e.g. `release/1.1.0` while NTR is being hardened. Only bug fixes and release-checklist work land here, no new scope. |
| `feature/*` | One feature = one branch, cut from `main`. Never mixes unrelated scope (a dependency bump does not ride along with a feature branch — see `.claude/CLAUDE.md`'s "one issue = one branch" rule). |
| `hotfix/*` | Cut from `main` for a production-breaking fix that cannot wait for the normal release train. Merges back to `main` directly (and is cherry-picked/merged into any in-flight `release/*` branch too, so the fix isn't lost on the next release). |
| `bugfix/*` | A non-urgent bug fix, cut from `main` or the relevant `release/*` branch, same one-fix-per-branch discipline as `feature/*`. |

## Naming

`<type>/<kebab-case-scope>` — lowercase, hyphen-separated, business-meaningful,
matching `docs/NAMING_STANDARD.md`'s module-naming convention:

- `feature/ntr-module`, `feature/pdi-module`, `feature/warranty`,
  `feature/campaign` — one module's initial build.
- `feature/pm-record-workflow-redesign` (already in use) — a scoped
  enhancement to an existing module.
- `bugfix/mqr-export-date-filter` — a single, scoped fix.
- `hotfix/pm-cross-tenant-idor` — an urgent production fix.

A branch name describes the change, not the ticket number alone — a
reviewer or future engineer should be able to guess what a branch does
from its name without opening the tracker.

## Commit discipline

- One issue = one commit series, using descriptive, issue-scoped commit
  messages (`.claude/CLAUDE.md` §Engineering Working Agreement).
- Never mix dependency updates, refactoring, feature work, or formatting
  into the same branch or commit.
- Whenever `package.json` changes, `package-lock.json` is updated in the
  same commit — never left out of sync.
- Prefer a new commit over `--amend` on anything already pushed;
  `git rebase -i`, `--force`, and history rewrites on shared branches are
  not used (`.claude/rules/git.md`).

## Release policy — Semantic Versioning

| Version | Meaning |
|---|---|
| `v1.0.0` | Production baseline — MQR + PM, current release |
| `v1.0.x` | Bug fix / patch release, no new module |
| `v1.1.0` | NTR module |
| `v1.2.0` | PDI module |
| `v1.3.0` | Warranty module |
| `v1.4.0` | Campaign module |
| `v2.0.0` | Dashboard (cross-module reporting layer — a major bump because it's expected to read from every module's data, a structural change in how the platform is used) |
| `v3.0.0` | Knowledge Platform / AI Copilot |

A patch (`v1.0.x`) never bundles new module scope. A minor (`v1.x.0`)
never contains a breaking change to an existing module's API response
shape, database schema, or report-number format — that would require a
major bump and an explicit migration note, not a minor release.

## Tags and releases

Creating a git tag or a GitHub Release is a human (or explicitly-approved,
per-action) decision, never something an AI agent does on its own
initiative — `.claude/rules/git.md`'s hard restriction. `v1.0-platform-foundation`
predates that rule and is not itself a violation of it; every tag/release
from this point forward requires the same explicit approval, every time —
approving one does not pre-approve the next.

## Quality gates

Every pull request must pass, in this order, before merge:

1. **Typecheck** — `tsc --noEmit` clean.
2. **Lint** — `next lint` (ESLint), 0 errors. Pre-existing warnings are
   tracked, not silently added to by the PR under review.
3. **Build** — `next build` succeeds, every route compiles.
4. **Tests** — `vitest run` green (see `TESTING_STANDARD.md`).
5. **Security review** — dealer-isolation and RBAC checks present per
   `SECURITY_STANDARD.md`, specifically: does every new single-record
   route check `record.dealer_id` against the session, and does every
   mutating route re-check the relevant `scope.ts` predicate server-side.
6. **Localization review** — no hardcoded string introduced outside
   `t()`/`useTranslation()`, per `docs/standards/DOMAIN_LANGUAGE_STANDARD.md`
   and `MODULE_DEVELOPMENT_STANDARD.md` §Localization.
7. **Dealer scope review** — same substance as the security review's
   dealer-isolation check, called out separately because it is the single
   highest-impact category of bug found in this codebase's history (the
   PM cross-tenant IDOR) and deserves an explicit, named review step
   rather than being folded silently into "security."
8. **Smoke test** — the change is exercised as a real user in a running
   app (dev server or preview deploy), not just verified by a green CI
   run — matching root `CLAUDE.md` §7's standing instruction to
   live-verify user-facing changes, not only confirm a clean build.

A PR that fails any gate does not merge with the gate waived "to save
time" — the gate is fixed or the PR is fixed, not bypassed.

## Verification

Documentation only. Does not create, merge, tag, or push any branch.
