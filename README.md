# Data Center Energy & Facility Monitor — "Energy Monitor"

Offline-first **portable Windows desktop application** for monthly data
center power & energy logging, reporting and forecasting. The Excel workbook
**`RST_Dashboard.xlsm` is the primary database** — the app reads and writes
it directly while preserving its VBA macros, pivot tables, charts and Excel
Tables. Google Sheets sync remains available as an optional secondary
provider, and the original browser build still works unchanged.

## Quick start (development)

```bash
npm install
npm run desktop:dev     # Electron + Vite dev server (HMR)
npm run dev             # browser build (legacy Google Sheets mode)
```

## Building the portable app

```bash
npm run portable        # → release/Energy Monitor.exe
npm run portable:zip    # → release/EnergyMonitor_Portable.zip
```

Extract the ZIP anywhere and double-click `Energy Monitor.exe` — no
installer, no admin rights, fully offline. Config, backups, logs and exports
live beside the executable.

## Verification

```bash
npm run lint            # typecheck renderer + main process
npm run test:excel      # 35-assertion workbook round-trip (VBA/pivot safety)
npm run test:e2e        # CDP-driven UI walkthrough of the built app
```

## Web v3 Preview verification

The web migration (`feat/web-v3`) deploys to Vercel Preview on every push.
Verify a Preview deployment end-to-end (auth, RBAC, migrated data, read-only
mode) with:

```bash
PREVIEW_URL=https://<your-preview-url>.vercel.app \
DEV_ADMIN_PASSWORD=<value> PREVIEW_UAT_PASSWORD=<value> \
npm run test:preview-http
```

or run it in CI via the manually-triggered **Preview Verification** GitHub
Actions workflow (`.github/workflows/preview-verification.yml`). Full
environment variable reference, exit codes, and the CI setup steps:
[`docs/web-v3/PREVIEW_VERIFICATION.md`](docs/web-v3/PREVIEW_VERIFICATION.md).
Never paste real credential values into a chat, issue, commit, or AI
assistant — set them directly in your shell or CI secrets store.

## Documentation

Full docs in [`docs/desktop/`](docs/desktop/README.md): User Guide,
Developer Guide, Deployment Guide, Architecture (system/IPC/data-flow
diagrams), Migration Summary, Regression Report, Production Readiness.

> Note: `docs/` also contains extensive platform-vision documents from an
> earlier planning phase (Supabase/Next.js multi-tenant platform). Those do
> **not** describe this application — for the current architecture see
> `docs/desktop/ARCHITECTURE.md`.
