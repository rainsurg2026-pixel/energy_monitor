# Rack Unit Capacity Image Storage Contract

Status: design gate only. No bucket, migration, environment variable, or
Production data has been changed by this document.

## Why this is needed

Desktop stores one PNG/JPEG image plus metadata for each facility/reporting
month in its local filesystem. The Web app already has the equivalent layout,
month selection, numeric capacity data, and image metadata table
(`rack_unit_capacity_images`), but the table stores an object key only. It
does not store image bytes and the current API has no upload/download route.

Do not store base64 image bytes in a monthly-log request or add a `bytea`
column as a shortcut. The Desktop limit is 8 MiB; base64 increases that size,
and a Vercel function request is the wrong transfer path for such files.

## Required behavior

- One active image per `(site_id, reporting_month)` Rack Unit Capacity
  snapshot. Replacing an image preserves an audit event and removes the old
  private object only after the replacement is finalized.
- Accept only PNG and JPEG, maximum 8 MiB. Validate magic bytes, dimensions,
  MIME type, byte count, and SHA-256 server-side after upload. Client-side
  validation is feedback only.
- No browser receives a database URL, Storage service credential, session
  secret, or unrestricted object URL.
- `rackRead` users may view a short-lived signed download URL only after the
  normal session/RBAC check. `operationalDataWrite` users may create/finalize
  an upload. Every mutation requires CSRF.
- An image is scoped to exactly its requested site and month. No latest-image
  fallback and no cross-site lookup are permitted.

## Proposed architecture

Use one **private** Supabase Storage bucket named
`rack-unit-capacity-images`. Browser transfers image bytes directly to/from
the private bucket with short-lived signed URLs. The API issues those URLs only
after normal local-session RBAC checks; the Storage service credential remains
server-only.

```text
Browser --session/CSRF--> Energy Monitor API --service credential--> Storage
Browser <-------- short-lived signed upload/download URL -------- Storage
```

### Upload flow

1. `POST /api/v1/rack-unit-capacity-images/upload-ticket`
   validates site, month, intended MIME type, byte count, and the caller's
   `operationalDataWrite` permission. It creates a random, expiring upload
   ticket and returns one signed upload URL.
2. Browser uploads directly to the ticket object key. It does not receive a
   service credential.
3. `POST /api/v1/rack-unit-capacity-images/:ticketId/finalize` downloads the
   private object server-side, runs `validateImageBytes`, computes SHA-256,
   validates the object against the ticket, persists metadata, and writes an
   audit event. Invalid/expired objects are deleted.
4. API moves the validated object to a stable private key:
   `sites/{siteId}/rack-unit-capacity/{YYYY-MM}/{sha256}.{png|jpg}`.
   A completed ticket is idempotent; a second finalize must return the same
   metadata, never create another active image.

### Read flow

`GET /api/v1/rack-unit-capacity-images?siteId=&month=` checks `rackRead`,
looks up the exact active metadata row, then returns a short-lived signed
download URL and safe metadata only. The URL must expire quickly and be
requested again after expiry. It is never stored in localStorage, reports, or
audit payloads.

## Migration and configuration gate

This design needs owner-approved infrastructure work before implementation:

1. Add an idempotent migration for an upload-ticket table with an expiry,
   ticket state, site/snapshot linkage, expected MIME/size, object key, and
   no secret fields. Ensure exactly one active image per snapshot.
2. Create the private Storage bucket and deny anonymous/public object access.
   Direct browser access must be possible only through signed URLs issued by
   this API.
3. Add server-only Storage configuration in Vercel. The service credential
   must never be bundled or printed. Existing database RLS does not grant
   object-store access by itself.
4. Define retention: replacement cleanup, abandoned-ticket cleanup, and audit
   retention. A scheduled cleanup job is optional only after an owner approves
   its operational cost and credentials.

## Acceptance tests

- PNG/JPEG happy paths preserve exact metadata and SHA-256.
- Reject invalid magic bytes, mismatched MIME, oversized data, corrupt
  dimensions, expired tickets, cross-site/month finalization, and replay.
- A `user` with `rackRead` can request only their authorized image URL; an
  unauthenticated request is rejected; a user without write permission cannot
  create or finalize a ticket.
- Replacing an image leaves one active metadata row and no readable orphan.
- Signed URL expiry, CSRF, audit event, RLS, and no-secret-response tests pass.
- Browser UAT verifies upload, refresh, per-month history, facility isolation,
  PDF image inclusion, and replacement after a hard reload.

Until this gate is approved and implemented, Web must keep the Desktop-like
image panel but state that image history is unavailable. It must not offer an
upload control that cannot persist an image.
