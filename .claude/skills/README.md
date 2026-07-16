# .claude/skills/

A skill here is a repeatable, documented procedure for a task this
repository needs often enough to be worth writing down once instead of
re-deriving every time. Each skill file should be self-contained: what it's
for, when to use it, the exact steps, and the gotchas specific to this
codebase that aren't obvious from the code alone.

## Index

| Skill | Use when |
|---|---|
| `scaffold-admin-module.md` | Adding a new admin CRUD entity (like Dealers/Branches/Technicians/Users/Problem Codes) |
| `add-supabase-table.md` | Adding any new table, in any module |
| `pdf-export-unicode-safe.md` | Adding or changing a `@react-pdf/renderer` export |
| `mobile-responsive-audit.md` | Auditing a page/component for mobile breakpoints |

## Adding a new skill

Write it as if handing the task to a capable engineer who has read
`docs/ARCHITECTURE.md` but has never touched this specific corner of the
code. Name it after the task, not the file it touches.
