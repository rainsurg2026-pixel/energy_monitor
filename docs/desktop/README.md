# Energy Monitor — Portable Desktop Edition

**Data Center Energy & Facility Monitor** as a fully offline, portable Windows
application. The Excel workbook `RST_Dashboard.xlsm` is the primary database;
every dashboard, forecast, and report reads from it, and every save writes
back into it — with an automatic timestamped backup before each write.

> Internal enterprise tool. No installer, no license system, no online
> updates, no telemetry.

## Quick start

1. Extract `EnergyMonitor_Portable.zip` anywhere (Desktop, `D:\Tools`, a USB
   drive — any folder you can write to).
2. Double-click **`Energy Monitor.exe`**.
3. That's it. The app finds `RST_Dashboard.xlsm` beside the executable and
   opens it automatically. No installation, no administrator rights, no
   internet connection required.

## Portable folder layout

```
Energy Monitor/
├─ Energy Monitor.exe      ← the application
├─ RST_Dashboard.xlsm      ← your database (macros, pivots & charts intact)
├─ config/                 ← config.json + crash-recovery journal
├─ backup/                 ← automatic timestamped backups (rotated)
├─ logs/                   ← app.log (size-rotated)
├─ exports/                ← default folder for JSON/CSV exports
└─ docs/                   ← this documentation
```

Everything stays inside this folder. The app never writes to AppData, the
registry, or browser Local Storage.

## What it does

| Area | Features |
|---|---|
| Data entry | Monthly UPS loads, air-conditioning energy, DC panels, building energy & cost — with historical-edit confirmation |
| Reports | Executive Dashboard, Dashboard Summary, Benchmark, Forecast, Historical Explorer, Trend analytics, Smart Insight |
| Workbook | Open / Save / Save As / Recent files / drag & drop / "Open With" |
| Safety | Backup before every save, atomic writes, lock detection (file open in Excel), crash recovery, restore-from-backup |
| Integrity Center | Duplicates, missing months, missing devices, invalid IDs, blank rows, workbook health, last-validation time |
| Settings | Default workbook, startup behavior, auto-save interval, backup retention, theme (dark/light), language (TH/EN), optional Google Sheets sync |

## Your workbook stays *your* workbook

Saves are performed by surgical patching of only the four log sheets.
Everything else in `RST_Dashboard.xlsm` — **VBA macros, pivot tables, charts,
the dashboard sheet, cell styles, the "4th Floor Electricity Cost" column and
the calculated rate column** — is preserved byte-for-byte. Excel Tables are
extended so the dashboard formulas and pivot caches pick up new months, and
the workbook is flagged to recalculate and refresh pivots on next open in
Excel.

If the workbook is open in Excel while you save, the app detects the lock and
offers **Retry / Save As / Cancel** — your edits are journaled and can never
be lost, even across a crash.

## Documentation

- [User Guide](USER_GUIDE.md) — day-to-day usage
- [Developer Guide](DEVELOPER_GUIDE.md) — code architecture, building, tests
- [Deployment Guide](DEPLOYMENT_GUIDE.md) — building and rolling out the ZIP
- [Architecture](ARCHITECTURE.md) — diagrams: system, IPC, data flow
- [Migration Summary](MIGRATION_SUMMARY.md) · [Regression Report](REGRESSION_REPORT.md) · [Production Readiness](PRODUCTION_READINESS.md)
