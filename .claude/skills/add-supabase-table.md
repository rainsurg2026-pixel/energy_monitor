# Skill: add a new Supabase table safely

Use whenever any module needs a new table — this is the highest-risk
recurring task in the codebase (a missed layer here is a real cross-tenant
data leak), so follow it exactly rather than improvising.

## Steps

1. Design the schema with a `dealer_id` (or equivalent tenant key) column
   and, for any table supporting deletion, `record_status`, `deleted_by`,
   `deleted_at` — soft delete only, no hard delete unless the table is
   genuinely `users`-like and SuperAdmin-gated.
2. Enable RLS on the table and write a policy that mirrors the tenant
   scoping the application layer will also enforce — RLS is the first
   layer, not the only layer.
3. Add the corresponding `applyScope()`-filtered query functions to the
   shared db layer. Every read and write goes through these functions —
   never a direct Supabase call from a route or component.
4. If the table needs an atomic human-readable sequence number (like
   `QIR-YYMM-0001`), use the existing `next_job_seq()` RPC pattern
   (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), not a
   read-then-increment in application code (race condition).
5. Run `get_advisors` (Supabase security advisor) after creating the table
   and policy, before considering the table done — don't just assume the
   policy is correct.
6. Verify with two different tenant accounts that neither can see or
   mutate the other's rows, through the application (not just by reading
   the policy SQL).
