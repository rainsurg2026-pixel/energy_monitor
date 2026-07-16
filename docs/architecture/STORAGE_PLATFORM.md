# Storage Platform

> **Status: Foundation (feature-frozen), reaffirmed as of MASP Platform
> Foundation v1.1.0** (`docs/releases/MASP_PLATFORM_FOUNDATION_V1.1.md`;
> originally frozen at v1.0.0, see `docs/releases/archive/`). Further
> work is bug fixes and security hardening only, not new capability,
> until an explicit future decision reopens it.
>
> **Scope note (updated at the Platform Baseline Freeze):**
> `docs/engineering/STORAGE_PLATFORM_FINAL.md` is now the canonical
> architecture/component/dependency reference for the Storage Platform,
> and `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` is the permanent,
> repo-wide policy document. This file is kept as the detailed
> `StorageProviderFactory` configuration reference (env-var table,
> worked examples) - the Provider table it used to duplicate here has
> been removed in favor of `STORAGE_PLATFORM_FINAL.md`'s Provider Model
> section, the single source of truth for that table. The full
> documentation reorganization proposed earlier
> (`docs/architecture/MASTER_ARCHITECTURE.md`, `PLATFORM.md`,
> `EVENT_PLATFORM.md`, `DOMAIN_LANGUAGE.md`, ADR renumbering) remains
> unapproved and out of scope for this freeze.

`src/shared/attachments/` is the storage layer every module goes through
via `AttachmentService` - never a storage provider or SDK directly (ADR-010,
`docs/engineering/ATTACHMENT_FRAMEWORK.md`). See
`docs/engineering/STORAGE_PLATFORM_FINAL.md` for the provider table and
full architecture; this document covers `StorageProviderFactory`
configuration in more detail than that summary does.

## StorageProviderFactory

`src/shared/attachments/StorageProviderFactory.ts` is the seam a future
provider switch goes through - a configuration change, not a code change
to `AttachmentService` or any business module.

```ts
StorageProviderFactory.createPrimaryProvider(): StorageProvider
StorageProviderFactory.createArchiveProvider(): StorageProvider
```

Each reads one env var, validates it against the supported provider
names, and constructs the matching class:

| Env var | Supported values | Default when unset |
|---|---|---|
| `STORAGE_PROVIDER` | `SUPABASE`, `CLOUDFLARE_R2`, `GOOGLE_DRIVE` | `SUPABASE` |
| `ARCHIVE_PROVIDER` | `SUPABASE`, `CLOUDFLARE_R2`, `GOOGLE_DRIVE` | `GOOGLE_DRIVE` |

Values are case-insensitive (`cloudflare_r2` and `CLOUDFLARE_R2` both
resolve). An unsupported value throws immediately, naming the offending
env var and the supported list - never silently falls back to a default
for a *set-but-wrong* value (only a genuinely *unset* var uses the
default). A provider that fails to construct (e.g. `CLOUDFLARE_R2`
selected without its `R2_*` config) throws with both the provider name
and which role (`primary`/`archive`) it was being built for, so a
misconfiguration is traceable at startup rather than surfacing later as a
confusing runtime error mid-upload.

### `AttachmentService`'s dependency injection

```ts
constructor(
  repo: AttachmentRepository = new AttachmentRepository(),
  primary: StorageProvider = StorageProviderFactory.createPrimaryProvider(),
  archiveProvider: StorageProvider = StorageProviderFactory.createArchiveProvider()
) {}
```

`AttachmentService` no longer constructs `new SupabaseStorageProvider()`/
`new GoogleDriveStorageProvider()` itself - every `new AttachmentService()`
call site (MQR/PM's API routes, Machine 360) gets its providers from the
factory by default, and nothing needed to change at those call sites,
since the factory's defaults reproduce exactly what was hardcoded before.
A caller that needs a specific provider (every unit test) still passes it
in directly - the factory is what chooses a *default*, not a mandatory
indirection.

### Configuration examples

```bash
# Default - nothing set. Primary = Supabase, Archive = Google Drive.
# (No env vars needed for this, the current, unchanged behavior.)

# Explicit default (equivalent to unset):
STORAGE_PROVIDER=SUPABASE
ARCHIVE_PROVIDER=GOOGLE_DRIVE

# Switching primary to Cloudflare R2 (not yet approved for production use -
# see CloudflareR2Provider's own doc comment and
# docs/engineering/R2_PRODUCTION_READINESS.md):
STORAGE_PROVIDER=CLOUDFLARE_R2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
# No R2_PUBLIC_URL - CloudflareR2Provider never returns a permanent/public
# object URL (R2 Production Readiness Review hardening); the only way to
# get a usable URL is AttachmentService.getUrl() -> getSignedUrl().

# ARCHIVE_PROVIDER=CLOUDFLARE_R2 is rejected by StorageProviderFactory -
# AttachmentService.getUrl() can't yet resolve a signed URL for a non-Drive
# archive provider (see R2_PRODUCTION_READINESS.md, blocker #3).

# Invalid - throws at the first new AttachmentService() call:
STORAGE_PROVIDER=AWS_S3
# Error: STORAGE_PROVIDER="AWS_S3" is not a supported storage provider -
# expected one of: SUPABASE, CLOUDFLARE_R2, GOOGLE_DRIVE
```

## What hasn't changed

No business module (MQR, PM, Machine 360) was touched by this milestone.
No default was switched - `STORAGE_PROVIDER`/`ARCHIVE_PROVIDER` are unset
in every environment today, so every `AttachmentService` still resolves to
Supabase primary / Google Drive archive, identical to before the factory
existed. Switching the default (or setting `STORAGE_PROVIDER=CLOUDFLARE_R2`
anywhere real) is an explicit, separate, future decision.
