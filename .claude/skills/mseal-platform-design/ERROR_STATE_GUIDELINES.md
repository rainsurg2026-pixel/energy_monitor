# Error State Guidelines

## Always name four things

Use `src/components/shared/layout/ErrorState.tsx`:

1. **Problem** - what failed, in plain language ("Could not load import
   sessions").
2. **Reason** - why, if known ("The import service did not respond").
3. **Resolution** - what the user can do ("Try again, or contact an
   administrator if this keeps happening").
4. **Retry** - an `onRetry` callback when the failure might be transient
   (a network call) - omit it when retrying can't help (a permission
   denial).

Never render a bare "Something went wrong" or a raw stack
trace/exception message to an end user.

## Server Component errors

Most pages in this app are Server Components - a thrown error there hits
Next.js's error boundary, not `ErrorState` directly. `ErrorState` is for
**client-side** fetch failures (e.g. a client component's `fetchJson`
call failing) - see `legacy-import-tool.tsx`'s existing
`showError()`/`swalErrorToast` pattern for the SweetAlert2 equivalent of
the same idea for one-off action failures; `ErrorState` is for a
section/widget that failed to load, not a submit action.

## Don't duplicate SweetAlert2's job

A failed form submission still uses `swalErrorToast`/`swalError`
(`FORM_GUIDELINES.md`, `lib/swal.ts`) - `ErrorState` is for a
section/widget's failed *load*, not an action's failed *result*.
