# Repository Policy

Governs the repository itself, as distinct from the application it
contains. No prior document in this repository covers this ground as a
single policy - `.claude/rules/git.md` covers *git operation safety*
(never force-push, never merge, etc.) but not repository-level questions
like visibility, what data classes are allowed in the repo, or which
`.claude/skills/` content is tracked. This document is new, not a
duplicate.

## 1. Public vs. Private

**Documentation drift resolved this pass.** Root `CLAUDE.md` previously
stated: *"Repo: `github.com/patamin-lab/mqr-mahindra` (**private**)."*
Re-verified directly against GitHub (`gh repo view patamin-lab/
mqr-mahindra --json visibility,isPrivate`, checked twice, in two
separate sessions, same result both times): `{"isPrivate": false,
"visibility": "PUBLIC"}` - the repository is, and has been, public.
**`CLAUDE.md` is now corrected to state public**, matching verified
reality - documentation and actual state agree as of this pass.

The separate, business-level question this does **not** answer - "is
public the visibility this repository is *supposed* to have" - remains
open and is the repository owner's call, not a documentation fix:

- If public is intentional, nothing further is needed - the documentation
  now correctly reflects it.
- If public was never intended, this is a real exposure - every commit
  ever pushed (including commit messages, which in this repository's
  convention are often detailed architecture rationale) has been publicly
  readable this whole time, and the repository should be set to private
  by whoever owns it. Making a public repository private again does not
  un-index anything a search engine or fork already captured - the
  exposure window doesn't close retroactively.

**This framework does not change repository visibility** - flipping the
actual GitHub setting is an irreversible-feeling, owner-level
infrastructure action, consistent with this repository's own "Executing
actions with care" operating principle. Recorded here as the single most
important open item in this policy; see `README.md`'s Gap Analysis.

## 2. Secrets

- Never committed, ever - not in code, not in a migration file, not in a
  test fixture, not in a commit message. Enforced today by convention
  (`.claude/rules/03-data-access-security.md`) - no automated secret
  scanner is wired into this repository's own CI as of this framework
  (`docs/engineering/ARCHITECTURE_ENFORCEMENT.md`'s `npm run architecture`
  checks dependency direction, not secrets).
- Credentials are environment variables, read lazily at call time (see
  `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s Infrastructure rules).
- `.env.local`/`.env` are gitignored - verify this remains true whenever
  `.gitignore` is touched.
- Narrow, already-agreed carve-outs for "entering" credentials exist (an
  authenticated-browser-session artifact like a GitHub raw-content
  redirect token, or the Drive resumable-session URL passed via a custom
  header) - see root `CLAUDE.md` for the exact list; this policy does not
  extend that list.

**Gap**: no automated secret-scanning is configured for this repository
(no `gitleaks`/`trufflehog`/GitHub secret-scanning-alert confirmation
found in `docs/engineering/ARCHITECTURE_ENFORCEMENT.md` or
`.github/workflows/`). Given the repository is confirmed public (§1),
this is a materially more important gap than it would be for a private
repository - recommended in `README.md`'s Governance Roadmap.

## 3. Demo Data / Production Data / Test Data / Sample Files

- **No fake/mock/demo data in production code paths**, ever, per
  `docs/PRODUCT_PHILOSOPHY.md` and every session-level instruction this
  repository has been built under ("No fake data unless explicitly
  requested"). A stub is acceptable only when the user explicitly asks
  for one.
- **Production data never appears in a fixture, test, or commit.** Test
  data lives only in `*.test.ts` files as inline literals
  (`docs/standards/TESTING_STANDARD.md`'s mocking-at-the-module-boundary
  convention) - no captured production row is ever pasted into a test.
- **Sample/template files** (e.g. the Legacy Import's downloadable
  template) are synthetic, generated from the schema/contract, never a
  redacted real file. `docs/adr/ADR-022-Import-Platform-v2.md` (proposed)
  and its `ImportTemplateService` are the existing pattern to follow for
  any future import profile.
- A disposable QA account (`qa_test_temp`, per root `CLAUDE.md` §9) is
  the one standing exception - real credentials for a real, but
  non-production-meaningful, account - and its test `records` rows are
  soft-deleted after each run, never left as stray "real-looking" data.

## 4. Claude Skills

This is a genuinely new governance area - no prior document addressed
what's tracked vs. not under `.claude/skills/`. Verified directly against
`origin/main`:

- **`.gitignore` line 10 excludes `.claude/skills/**` broadly** (comment:
  "IDE-generated skill scaffolding not part of this repo's own
  `.claude/skills/*.md` set").
- **What IS tracked on `main` today**: exactly five files -
  `.claude/skills/README.md` and four individual project-specific skills
  (`add-supabase-table.md`, `mobile-responsive-audit.md`,
  `pdf-export-unicode-safe.md`, `scaffold-admin-module.md`).
- **What is NOT tracked anywhere** (verified via `git log --all`, zero
  commits): the large `.claude/skills/MSEAL_Skill_Library_v2.0/` tree
  (00-core/10-domains/20-business/30-platform/40-engineering/
  50-playbooks/60-knowledge-packs/90-reference) referenced in several
  prior session tasks - this is **local-only scratch content**, never
  committed to any branch. Any future task that says "read the project's
  skill library" should verify this status hasn't changed before
  assuming that content is authoritative or shared with other
  contributors.
- **`.claude/skills/mseal-platform-design/`** (the MSEAL Design
  Framework's 18-file agent-facing guideline pack, ADR-023 proposed) was
  **deliberately force-added** (`git add -f`) as a named exception in its
  originating PR - it is project-specific, governed by an ADR, and
  referenced from tracked `docs/` files, unlike the generic scaffolding
  the ignore rule targets.

**Policy going forward**:
1. `.claude/skills/**` stays gitignored by default.
2. A skill gets tracked (force-added, with a one-line note in its
   introducing PR explaining why) only when it is genuinely
   project-specific, referenced by a tracked `docs/` file, and intended
   to be shared with every future contributor/agent - not for personal
   scratch material.
3. Large generic skill libraries (marketplace-style content, not
   project-specific) are never tracked, regardless of usefulness locally.

## 5. Architecture Docs

`docs/architecture/`, `docs/adr/`, and `docs/architecture/blueprint/` are
tracked normally (no special gitignore treatment) - see
`DOCUMENTATION_POLICY.md` for the standard governing their content and
lifecycle. No repository-level exception applies to them.

## 6. Release Docs

`docs/releases/`, `docs/release/` are tracked normally. See
`docs/releases/MASP_PLATFORM_FOUNDATION_V1.1.md` for the existing release
format to follow; `DOCUMENTATION_POLICY.md` §Release Notes standardizes
this going forward.

## 7. Security Rules

`.claude/rules/03-data-access-security.md` and
`docs/standards/SECURITY_STANDARD.md` are the binding security rule sets
- this policy does not restate them (see `SECURITY_BOUNDARY.md` for the
governance-layer view). Both files are tracked normally; neither is
gitignored, and neither should be, since every contributor/agent must be
able to read them before touching data-access code.

## Verification

Documentation only. No file was moved, deleted, gitignored, or
un-gitignored as part of writing this policy - `.gitignore` itself was
not modified. The repository-visibility finding (§1) is reported, not
acted on.
