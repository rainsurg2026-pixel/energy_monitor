# Notification Guidelines

## Two separate notification concepts - don't conflate them

1. **Feedback popups** (toast/success/error/confirm/loading) - always
   `lib/swal.ts`, never a new toast system. This is unchanged by this
   framework.
2. **Notification list items** (a feed of things that happened) - the new
   `NotificationCard` component, standardized across every source.

## `NotificationCard` source vocabulary (fixed union, extend deliberately)

`platform | import | quality | pm | warranty | auth | ai` - each has a
fixed icon+color. A new module gets a new source value added to this
union in `NotificationCard.tsx`, not a free-form string.

## Current status

`NotificationBell` (`shared/layout/`) is a static, disabled placeholder
with no backing data - unchanged by this framework (real notification
data has no source yet, see Gap Analysis). `NotificationCard` is ready to
render whenever a real notification query exists; don't wire it to fake
data in the meantime.

## When a real notification source exists

Render via `NotificationCard`, group by source if a list mixes sources,
and always include a link (`href`) back to the record/screen the
notification is about - a notification with nowhere to go is not
actionable.
