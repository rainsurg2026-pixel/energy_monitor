# Prompt: new admin resource

```
Add a new admin-managed entity called [ENTITY_NAME] with fields:
[FIELD_LIST — name: type, ...]

Follow the exact pattern of the Dealers admin module (db.ts functions,
API routes, page + table component, sidebar entry) per
.claude/skills/scaffold-admin-module.md. Roles allowed to manage this
entity: [ROLE_LIST]. [Any entity-specific validation or relationships].

Do not introduce a new abstraction for this — copy the Dealers shape
exactly, even if you see room to improve it generically. That improvement
is Sprint 2's job (extracting a shared AdminCrudTable), not this task's.
```
