# Prompt: new business module

```
Stand up a new module called [MODULE_NAME] under modules/[module_name]/,
covering: [SCOPE DESCRIPTION].

Follow the module contract in docs/MODULE_GUIDE.md: own pages/api/db.ts/
types.ts, import only from shared/, never reach into another module's
internals. Reuse shared/ for auth, scope, db client, date formatting,
upload pipeline, and feedback (swal) — do not re-implement any of these.

New tables: [LIST, or "none yet"] — follow
.claude/skills/add-supabase-table.md exactly (RLS + applyScope, soft
delete, security-advisor check).

Before writing code: analyze the existing MQR module (the reference
implementation) for the closest equivalent pattern, design the module's
shape, confirm the plan with me, then implement. Do not touch src/,
modules/mqr/, or shared/ except to add the new module's own files and any
genuinely new shared utility this module needs.
```
