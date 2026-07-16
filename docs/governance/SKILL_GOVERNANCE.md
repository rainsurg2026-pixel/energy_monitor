# Skill Governance

## Relationship to existing documents

`docs/governance/REPOSITORY_POLICY.md` §4 already covers *what's tracked
vs. gitignored* under `.claude/skills/` (the repository-level question).
**This document covers the different question of *how a tracked skill is
governed over time*** - official status, versioning, ownership, review,
and deprecation - which §4 does not address. Read §4 first for the
tracking facts this document builds on; not restated here.

## Official Skills (current state, verified against `main`)

A skill is "official" (governed, expected to be maintained, safe to cite
in another document) only if it is **tracked** on `main` - per
`REPOSITORY_POLICY.md` §4, that means one of:

| Skill | Status | Repository location |
|---|---|---|
| `.claude/skills/README.md` | Official | `.claude/skills/README.md` |
| `add-supabase-table.md` | Official | `.claude/skills/add-supabase-table.md` |
| `mobile-responsive-audit.md` | Official | `.claude/skills/mobile-responsive-audit.md` |
| `pdf-export-unicode-safe.md` | Official | `.claude/skills/pdf-export-unicode-safe.md` |
| `scaffold-admin-module.md` | Official | `.claude/skills/scaffold-admin-module.md` |
| `mseal-platform-design/` (18 files + `SKILL.md`) | Official (force-added exception, PR #37) | `.claude/skills/mseal-platform-design/` |
| `MSEAL_Skill_Library_v2.0/` | **Not official** - zero commit history on any branch, local-only scratch content | N/A - not in the repository at all |

Any other file appearing under `.claude/skills/` in a local working
directory that is not in the table above is, by definition, **not**
official - it is either gitignored scratch content or was never
committed. Do not cite an unofficial skill's content in a `docs/`
document as if it were shared, reviewed, project knowledge.

## Versioning

No skill in this repository carries an explicit version number today
(unlike the daymade-skill marketplace convention referenced in
`.claude/skills/CLAUDE.md`, which is a *different*, unrelated repository
mounted for that marketplace's own tooling, not this project). Policy
going forward:

1. A single-file skill (e.g. `add-supabase-table.md`) is versioned
   implicitly by its git history - no separate version number needed for
   something this small; its own commit log is the changelog.
2. A multi-file skill pack (e.g. `mseal-platform-design/`) carries an
   explicit version in its `SKILL.md` header comment (the pattern
   `mseal-platform-design/SKILL.md` already partially follows via its
   description) - bump it in the same commit that changes any file in the
   pack, matching `DOCUMENTATION_POLICY.md`'s "one version number per
   framework, bumped when materially revised" rule for design frameworks.

## Ownership

A tracked skill's owner is whichever domain/document it was written to
support - not a separate "skills team." `mseal-platform-design/` is
owned by whoever owns the MSEAL Design Framework (ADR-023). A future
skill covering, e.g., Import Platform onboarding would be owned by
whoever owns ADR-022/`docs/architecture/IMPORT_PLATFORM.md`. This mirrors
`DECISION_MATRIX.md`'s general rule: a concern's governance authority
follows its domain, not a parallel structure invented for skills
specifically.

## Review

A new or changed official skill goes through the same review a
documentation change gets (`DOCUMENTATION_POLICY.md`'s verification
checklist) plus one skill-specific check: **does this skill duplicate
guidance already in a tracked `docs/` file, or does it add a genuine
agent-facing operational distillation of one?** `mseal-platform-design/`
is the reference example of the latter (each guideline file points back
to its canonical `docs/` source rather than restating it - see that
pack's own `SKILL.md`).

## Deprecation

1. A skill is deprecated when the `docs/` document(s) it distills are
   themselves superseded or removed - the skill should be removed or
   updated in the same PR that supersedes its source, not left to drift
   independently (this is exactly the class of drift `EVENT_OWNERSHIP.md`
   and the ADR-009 fix in this same pass both had to clean up after the
   fact - the goal is to not create a third instance of that pattern).
2. Removing an official skill is a normal file deletion, reviewed like
   any other doc removal - no special ceremony, since skills are not a
   Freeze item and were never claimed to be.

## Repository location

`.claude/skills/**` is gitignored by default (`REPOSITORY_POLICY.md` §4).
An official skill is force-added (`git add -f`) with a one-line
justification in its introducing PR's description, matching the
`mseal-platform-design/` precedent. No skill should live anywhere else in
the repository (e.g. copied into `docs/` as well) - one location, cited
from `docs/` where relevant, never duplicated into a second home.

## Gap Analysis

- No skill has ever actually needed the versioning policy above in
  practice yet (`mseal-platform-design/` has not had a post-creation
  revision as of this writing) - policy is proposed, not battle-tested.
- The five single-file skills currently tracked
  (`add-supabase-table.md`, etc.) were not reviewed as part of writing
  this document - this document governs them going forward, it does not
  audit their existing content.
