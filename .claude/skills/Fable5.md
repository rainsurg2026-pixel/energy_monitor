---
name: safe-code-execution
title: Safe Coding Workflow for Hard Tasks
description: >
  A disciplined workflow for decomposing complex coding tasks, inspecting a
  codebase before editing, minimizing change risk, verifying results, and
  reporting outcomes with evidence. Use this skill whenever a task involves
  modifying an existing codebase, fixing non-trivial bugs, or implementing
  features whose scope is not fully specified.
version: 1.2.0
author: engineering-enablement
tags: [coding, refactoring, debugging, verification, safety]
applies_to: [code-editing, bug-fixing, feature-implementation, refactoring]
requires_tools: [file-read, file-search, shell, test-runner]
risk_level: medium
---

# Safe Coding Workflow for Hard Tasks

## Description

This skill teaches a coding agent to approach non-trivial coding tasks the way
a careful senior engineer would: understand before acting, change the minimum
necessary, verify before claiming success, and report with evidence rather
than assertion.

The core principle: **an unverified change is an unfinished change.** Every
edit must be justified by observed facts about the codebase, and every claim
of completion must be backed by evidence the user can inspect.

## When to Use

Use this skill when **any** of the following is true:

- The task touches an existing codebase (not a greenfield single file).
- The fix or feature spans more than one file or module.
- The root cause of a bug is not yet confirmed.
- The task description is ambiguous, incomplete, or possibly wrong.
- The change could affect data, security, builds, deployments, or public APIs.
- Tests exist (or should exist) for the affected area.

Do **not** apply the full workflow for trivial, self-contained requests
(e.g., "rename this variable in this one file I pasted"). Use judgment; scale
the process to the risk.

---

## Step-by-Step Workflow

### Phase 1 — Restate and Scope

1. Restate the task in one or two sentences in your own words.
2. List explicit requirements and explicit constraints given by the user.
3. List assumptions you are making. Mark each as `[confirmed]`, `[inferred]`,
   or `[unverified]`.
4. Define what "done" means as observable outcomes (e.g., "test X passes",
   "endpoint returns 200 with schema Y"), not internal impressions.

### Phase 2 — Inspect Before Editing

Never edit a file you have not read. Before proposing changes:

1. **Map the structure.** Identify the project type, entry points, and layout
   (e.g., read `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`,
   directory tree, README).
2. **Identify dependencies and versions.** Note frameworks, runtime versions,
   and lockfiles. Do not assume APIs from a different major version.
3. **Locate the relevant code.** Use search (grep/symbol search) to find all
   definitions, call sites, and usages of the code you intend to change —
   not just the first match.
4. **Find the tests.** Identify existing test files, test commands, CI
   configuration, and linters. Record the exact command to run them.
5. **Identify constraints.** Look for style guides, CONTRIBUTING files,
   type-checking configs, feature flags, environment assumptions, and
   comments like `TODO`, `HACK`, `DO NOT EDIT`, or generated-file headers.
6. **Reproduce the problem** (for bugs). Confirm the failure with a concrete
   command, failing test, or observed output *before* changing anything. If
   you cannot reproduce it, say so and treat the root cause as unconfirmed.

### Phase 3 — Decompose Into Safe Steps

1. Break the task into small, independently verifiable steps. Each step
   should be revertible and testable on its own.
2. Order steps so that read-only and low-risk changes come first, and
   destructive or wide-impact changes come last.
3. For each step, write down:
   - the files it touches,
   - the expected observable effect,
   - the verification method (test, command, manual check).
4. If a step cannot be verified, redesign it until it can.

### Phase 4 — Edge Cases and Hidden Risks

Before writing code, explicitly enumerate:

- **Input edge cases:** empty, null/undefined, zero, negative, very large,
  malformed, non-ASCII / multibyte text, timezone and locale variation.
- **State edge cases:** concurrent access, retries, partial failure,
  idempotency, ordering assumptions.
- **Integration risks:** callers you did not modify, serialized data formats,
  database schemas, public API contracts, config files, environment
  variables.
- **Operational risks:** migrations, caching, build artifacts, generated
  code, backwards compatibility, secrets accidentally logged or committed.
- **Blast radius:** who or what else consumes the code being changed? List
  every call site found in Phase 2 and state whether each is affected.

If a risk cannot be ruled out, either add a test that covers it or flag it
explicitly in the final report.

### Phase 5 — Implement

Apply the Safe Code Editing Rules below. Make the smallest set of changes
that satisfies the requirement.

### Phase 6 — Verify

Run the Verification Checklist below. Do not skip it because the change
"looks obviously correct."

### Phase 7 — Report

Produce a final report in the Reporting Format below, with evidence.

---

## Safe Code Editing Rules

1. **Read before you write.** Never modify code you have not opened and read
   in full (or at least the full function/class and its neighbors).
2. **Minimum viable diff.** Change only what the task requires. Do not
   reformat unrelated code, rename unrelated symbols, upgrade unrelated
   dependencies, or "clean up while you're here" unless asked.
3. **No silent behavior changes.** If a fix changes behavior beyond the bug
   (return types, error semantics, defaults), call it out explicitly.
4. **Preserve public contracts.** Do not change function signatures, API
   response shapes, CLI flags, or serialized formats without confirming all
   consumers or getting user approval.
5. **Never delete or overwrite without a safety net.** Prefer additive
   changes. If removal is required, confirm nothing references the removed
   code (search all call sites) and note it in the report.
6. **Do not touch generated files, lockfiles, or vendored code by hand**
   unless the task is specifically about them; regenerate via the proper tool.
7. **No destructive commands without explicit approval:** dropping tables,
   force-pushing, deleting branches, `rm -rf`, rewriting history, rotating
   secrets, or modifying production configuration.
8. **Handle secrets safely.** Never hardcode credentials, print them in
   logs/output, or commit `.env` contents. If a secret is required and
   missing, stop and ask.
9. **Match the codebase, not your preference.** Follow existing style,
   naming, error-handling patterns, and test conventions.
10. **Keep steps revertible.** Structure work so each step could be reverted
    with a single, clean rollback (e.g., one logical commit per step).
11. **If you are guessing, say so.** Never present an unverified hypothesis
    as a confirmed root cause.

---

## When Information Is Missing

Follow this decision procedure instead of guessing silently:

1. **Can I discover it myself safely?** (read files, run read-only commands,
   run existing tests) → Do that first.
2. **Can I proceed with a clearly labeled assumption whose failure is cheap
   and visible?** → Proceed, record the assumption as `[unverified]`, and
   surface it in the report.
3. **Would a wrong guess be expensive, destructive, or hard to detect?**
   (data loss, security, public API, payments, migrations) → **Stop and ask
   the user a specific question**, offering the options you see and your
   recommended default.
4. **Is the task itself possibly wrong?** (the requested fix contradicts
   observed behavior) → Report the discrepancy with evidence before
   implementing anything.

A good clarifying question names the exact unknown, why it matters, and the
options: *"The API can return either `snake_case` or `camelCase` keys
depending on version. Which does your client expect? If unsure, I'd default
to `snake_case` because current tests assert it."*

---

## Verification Checklist

Complete before claiming the task is done. Record the actual commands and
outputs — not just "tests pass."

- [ ] **Reproduction confirmed fixed** (for bugs): the original failing
      command/test now succeeds, and I have the before/after output.
- [ ] **New or updated tests exist** covering the changed behavior and the
      key edge cases identified in Phase 4.
- [ ] **Full relevant test suite run** with the project's own command; all
      pass, or failures are pre-existing and documented as such.
- [ ] **Linter / type checker / formatter run** using the project's config;
      no new violations introduced.
- [ ] **Build succeeds** (compile step, bundler, or equivalent) if the
      project has one.
- [ ] **Diff review:** I re-read the complete diff and confirmed every
      changed line is intentional and necessary; no debug prints, no
      commented-out code, no stray files.
- [ ] **Call-site audit:** every caller/consumer identified in Phase 2 still
      works or was updated.
- [ ] **No secrets, credentials, or personal data** in the diff or output.
- [ ] **Assumptions resolved or flagged:** every `[unverified]` assumption is
      either now verified or listed in the report as an open risk.

If any box cannot be checked, the task is **not complete** — report it as
partially complete with the remaining gap stated plainly.

---

## Reporting Format

Every final report must contain these sections: