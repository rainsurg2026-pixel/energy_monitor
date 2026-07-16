# .claude/CLAUDE.md — AI agent entry point

This file governs how any AI coding assistant (Claude or otherwise) should
operate in this repository, **on top of, not instead of**, the root
`CLAUDE.md` (the living application spec — architecture, DB schema, RBAC,
deployment workflow). Read both before making any change.

## Standing operating mode (Senior Software Architect)

Always follow project skills. Always read root `CLAUDE.md` before coding.
Always understand the whole architecture before touching a piece of it.
Never break an existing feature. Always reuse components before writing
new ones. Keep the architecture scalable. Keep code clean and
production-ready. Before writing code: **Analyze → Design → Plan →
Implement → Test → Refactor → Document.** If a requirement is unclear,
ask — never guess. Never generate an incomplete implementation, never
leave a `TODO`, never use fake data unless explicitly requested. Prefer the
reusable, generic solution. Optimize for long-term maintainability over a
quick fix.

## Where to look, in order

1. Root `CLAUDE.md` — what the app is, schema, RBAC, deployment.
2. `docs/governance/AI_ENGINEERING_PLAYBOOK.md` — mission, reading order,
   Production Pilot allowed/not-allowed scope, and the Before-Every-PR
   checklist. Read this before implementation or business-logic changes.
3. ~~`docs/ARCHITECTURE.md`~~ **Stale — do not use for current
   architecture.** That file is a Sprint-1-era snapshot (single-module
   MQR world, an aspirational `modules/` layout never adopted — see
   "Sprint 1 status" below). The current architecture reference is
   `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`, per the
   Playbook above.
4. `.claude/rules/` — the specific convention area you're about to touch.
5. `.claude/skills/` — is there already a documented procedure for this?
6. `.claude/playbooks/` — multi-step operational procedures (deploys,
   module onboarding, incident response).
7. `.claude/prompts/` — reusable prompt templates for recurring requests,
   useful when *delegating* a piece of work to another session/agent.
8. `templates/` and `shared/` — reuse before writing something new.

## Sprint 1 status (read this before assuming anything has moved)

As of Sprint 1, `modules/`, `shared/`, and `templates/` are **scaffolding
only** — they contain README placeholders and no executable code. All
working application code is still 100% under `src/`, exactly as it was
before Sprint 1. Do not move anything out of `src/` without an explicit
sprint task in `docs/ROADMAP.md` authorizing that specific move. Adding
files to `modules/`, `shared/`, or `templates/` speculatively, outside of
a planned sprint, is not part of this sprint's scope.

## Hard constraints that apply to every change, not just Sprint 1

- Two-layer tenant isolation (RLS + `applyScope()`) is mandatory for any
  new table — see `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s
  Authorization rules section and `.claude/rules/03-data-access-security.md`
  (not `docs/ARCHITECTURE.md` §5 — that file is stale, see above).
- SweetAlert2 is the only UI feedback mechanism — no `alert()`, no ad-hoc
  banners.
- Timestamps shown to a user must go through the shared GMT+7 formatter.
- Never enter API tokens, credentials, or passwords into any command or
  field, even when explicitly supplied and authorized — stop and ask the
  user to do it themselves. (Authenticated-browser-session artifacts, like
  a GitHub raw-content redirect token or a Drive resumable-session URL
  passed via header, are not "entering a credential" — see root `CLAUDE.md`
  for the exact carve-outs; do not extend them further without asking.)
