# Playbook: onboard a new module

Use when actually starting one of the planned modules from
`docs/MODULE_GUIDE.md` (PDI, Warranty, Parts, NTR, Dashboard) — not before;
this assumes `shared/` already has real content (post-Sprint 2) and at
least one module (MQR) has already been re-homed under `modules/`
(post-Sprint 3).

## Steps

1. Confirm scope with the business owner first if there's any ambiguity
   (this blocked NTR specifically — don't repeat that mistake for the
   next module either).
2. Create `modules/<name>/` with the standard shape from
   `docs/MODULE_GUIDE.md` §2 (`pages|api|components|db.ts|types.ts|README.md`).
3. Identify what's genuinely shared vs. module-specific before writing
   anything — check `shared/` first, and only add something new to
   `shared/` if a second module already needs it too (see
   `.claude/rules/01-architecture-boundaries.md`).
4. New tables go through `.claude/skills/add-supabase-table.md` exactly.
5. New admin-managed entities for this module go through
   `.claude/skills/scaffold-admin-module.md`.
6. Register the module in the shared nav config — do not add
   module-specific conditionals to the shared shell.
7. Update `docs/ROADMAP.md` to mark the module's sprint as in progress/done
   and `modules/README.md`'s status table.
8. Manual regression pass on the rest of the app before calling it done —
   no automated tests exist to catch a shared-code regression.
