# Technical Stack

This document defines the official platform stack and records what is actually installed today in the `mqr-mahindra` codebase (verified against `package.json` at the time of writing), so the gap between target and current state is explicit rather than assumed.

## Official Stack

| Layer | Choice |
|---|---|
| Frontend Framework | Next.js (App Router), React, TypeScript |
| Styling | Tailwind CSS |
| Hosting | Vercel |
| Backend / Database | Supabase |
| Authentication | Supabase Auth |
| Media Storage | Google Drive |
| Reporting / Daily Snapshot | Google Sheets |
| PDF Generation | React PDF |
| Charts | Recharts |
| Icons | None - inline SVG / emoji (ADR-023) |

These are the platform's official choices for all future module development. New modules should not introduce an alternative framework, styling approach, charting library, or icon set without an ADR justifying the exception.

## Verified Against the Current Codebase

As of this sprint, `package.json` (`mqr-webapp`, current version `0.1.0`) confirms the following are already in place:

| Dependency | Installed Version | Maps To |
|---|---|---|
| `next` | 14.2.35 | Frontend Framework |
| `react` / `react-dom` | 18.3.1 | Frontend Framework |
| `typescript` | 5.6.3 (devDependency) | Frontend Framework |
| `tailwindcss` | 3.4.13 (devDependency) | Styling |
| `@supabase/supabase-js` | 2.45.4 | Backend / Database |
| `@react-pdf/renderer` | 4.5.1 | PDF Generation |
| `recharts` | 2.12.7 | Charts |
| `googleapis` | 173.0.0 | Google Drive / Sheets integration |
| `exceljs` | 4.4.0 | Excel/report export |
| `resend` | 6.14.0 | Outbound email (notification building block) |
| `sweetalert2` | 11.26.24 | UI alerts/confirmations |
| `jose` | 5.9.6 | JWT signing/verification |
| `leaflet` / `react-leaflet` | 1.9.4 / 4.2.1 | Maps (not part of the official stack list; existing, real usage) |
| `papaparse` | 5.5.4 | CSV parsing |
| `qrcode` | 1.5.4 | QR code generation |
| `heic-convert` | 2.1.0 | Image format conversion |

## Known Gaps Between Target and Current State

These are noted explicitly rather than glossed over, per this sprint's documentation-first principle:

- **Icons — corrected by ADR-023** (`docs/adr/ADR-023-MSEAL-Design-Framework.md`).
  This row and the "Known Gap" below it previously named Lucide React as
  the adopted-going-forward icon standard; that was never acted on
  (Lucide is still not installed) and directly contradicted
  `docs/UI_STANDARD.md`'s current-state rule. The actual standard,
  reconciled by ADR-023, is: no icon library - inline SVG or emoji.
- **Authentication — "Supabase Auth" is the target principle, not a literal description of today's implementation.** The current codebase (`src/lib/auth.ts`, `src/lib/supabase.ts`) implements a custom session/JWT layer (signed with `jose`) on top of Supabase as the data store, rather than using Supabase's hosted Auth client directly. `docs/adr/ADR-001-Supabase.md` and `docs/PLATFORM_SERVICES.md` record this distinction. Whether the platform standardizes on Supabase's native Auth product or formalizes the existing custom session approach as the shared `auth` service is a decision for a future sprint, not this one.
- **Google Sheets integration today is read-only and narrow in scope.** `src/lib/tractorSheet.ts` reads one existing reference sheet (read-only, via a public CSV export endpoint, no service account). It is not the same thing as the Supabase → Sheets daily reporting sync described in `docs/DATA_SYNCHRONIZATION.md`, which does not exist yet. The two should not be confused: the daily sync is new, forward-looking architecture; `tractorSheet.ts` is an existing, narrower integration that may eventually be superseded by it.
- **Google Drive integration already has a starting point.** `src/lib/googleDrive.ts` and `scripts/get-google-refresh-token.mjs` (OAuth2) already exist. `docs/GOOGLE_DRIVE_ARCHITECTURE.md` defines the target folder structure and conventions this existing integration should grow into.

## Principles

- **Supabase = Source of Truth.** All operational reads and writes go through Supabase first.
- **Google Drive = Media Repository.** Photos, videos, and generated PDFs are stored in Drive, referenced by URL/ID from Supabase records — never stored as binary data in the database.
- **Google Sheets = Reporting & Daily Snapshot.** Sheets is a downstream, read-oriented mirror of Supabase data for reporting, Power BI, and Excel consumption. It is never the system of record.
