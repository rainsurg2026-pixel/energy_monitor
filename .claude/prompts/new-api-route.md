# Prompt: new API route

```
Add a new API route [METHOD] [PATH] that [BEHAVIOR DESCRIPTION].

Requirements: re-check session + scope.ts permissions server-side
regardless of any client-supplied IDs; use the existing db layer only
(no direct Supabase calls in the route); return the {ok:true,...} /
{ok:false,error} envelope; if this triggers a notification or a
storage-relocation side effect, make it non-blocking (log on failure,
never fail the main response) following the pattern in records POST.
```
