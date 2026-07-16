# Git Safety Rules

These rules govern every git/GitHub operation on this repository, including operations performed through the GitHub web UI (this environment has no local clone or push credentials — see `.claude/playbooks/deploy-without-git-cli.md`).

This file is itself a governance artifact, on the same footing as the documents `docs/architecture/PLATFORM_CONSTITUTION.md` names as an "approval authority already defined for architecture-level changes." See **Rule Governance**, below, for how this file may change.

## Absolute prohibitions (no exception, ever)

Never:

- Force push.
- Rewrite git history (no rebase, no `commit --amend` on already-pushed commits, no `reset --hard` followed by push).
- Create a release.
- Create a tag.
- Bypass CI (merge with a required check red, missing, or unverified).
- Bypass Product Owner approval (merge or delete a branch without the specific approval this file requires).
- Commit unless explicitly instructed for that specific change.

## Scope of the conditional merge process

Merging and branch deletion are **not** blanket-forbidden, but they are also not the default. `docs/governance/AI_ENGINEERING_PLAYBOOK.md`'s standing Deliverable template — "Open ONE PR. Never Merge. Stop after reporting." — remains the default outcome for ordinary work. The conditional process below is a distinct, elevated mode that only applies when a task explicitly invokes it for a specific, already-open PR (naming the PR number and asking for merge/deletion). Absent that explicit invocation, fall back to the Playbook default: open the PR, do not merge, stop and report.

## Merge Policy

A merge may proceed only when **all** of the following are true, verified in this order:

**1. Explicit Product Owner approval**

- The approval must name the specific PR number being merged.
- Approval for one PR never applies to any other PR, no matter how similar or related.
- An approval given earlier in the conversation, before the conditions below were last checked, does not carry forward — see Freshness.

**2. Freshness**

- Approval is treated as expired — and must be re-confirmed — if, since it was given: new commits were pushed to the PR, its mergeable/mergeStateStatus changed, a required CI check went non-green, or its review status changed.
- Always re-fetch and use the latest repository/PR state immediately before merging, never a value cached from earlier in the session.

**3. Validation**

Before merging, verify every one of the following, freshly, in the actual PR/branch state:

- Mergeable (clean, conflict-free — e.g. GitHub's `mergeable: MERGEABLE` / `mergeStateStatus: CLEAN`).
- Every required CI check green.
- Architecture check passes.
- Build passes.
- Typecheck passes.
- Lint passes.
- Tests pass.

If any single one of these fails, do not merge — stop and report which check failed instead.

**4. Merge Strategy**

- Use only the repository's configured standard merge strategy (whatever GitHub's branch/PR settings default to for this repo).
- Never override it with an ad hoc strategy (e.g. forcing a squash when the repo default is a merge commit, or vice versa).

## Branch Deletion

Delete a branch only when **both** of the following are true:

- The merge of that branch's PR just completed successfully, under the Merge Policy above.
- The Product Owner has explicitly approved deleting *that specific branch*.

Merge approval does **not** imply branch-deletion approval — if the approval message did not clearly cover deletion, ask before deleting.

## Post-Merge

After every successful merge, verify:

- The merge commit exists and is on the target branch.
- `main`'s HEAD reflects the merge.
- CI on `main` (post-merge) is green.
- Deployment status, if this repository has one wired to the merge (e.g. Vercel auto-deploy on `main`).

Never claim a merge completed, or a deployment succeeded, unless each was actually verified — a merge command returning success is not itself proof; check the resulting state.

Then synchronize documentation: update only the specific doc(s) actually affected by the change (Reuse before Rewrite applies to docs too — `docs/governance/AI_ENGINEERING_PLAYBOOK.md`'s own Before-Every-PR rule), among:

- `PROJECT_STATE.md`
- `ROADMAP.md`
- `ADR_INDEX.md`
- `RELEASE_NOTES.md`
- `CHANGELOG.md`

If a business rule or architecture decision changed, that is an ADR, not a silent doc edit.

## Rollback

If production validation fails after a merge:

- Do **not** silently patch `main` directly.
- Open a dedicated rollback or hotfix PR.
- Document the reason for the rollback/hotfix in that PR.

## Rule Governance

`.claude/rules/git.md` is itself governed:

- Future modifications to this file require explicit Product Owner approval and a dedicated documentation PR.
- Rule changes must never be bundled with application code in the same PR.

## Note on repo history

`v1.0-platform-foundation` (tag + release, commit `bf12f48`) was created before this rules file existed. It predates this policy and was not created in violation of it, but going forward no further tags or releases should be created without explicit instruction.
