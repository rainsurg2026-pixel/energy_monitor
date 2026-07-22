# Production Readiness Report — Energy Monitor v1.0.0

## RC-3 update

**Verdict: Production Ready, with a documented operational limitation and
documented technical debt — no production defect.**

RC-3 (data-entry experience, save-pipeline hardening, formatting
architecture, Excel-engine hardening, dashboard config-driven refactor —
see `docs/desktop/RC3_RELEASE_NOTES.md`) is functionally verified: lint,
build, `validate:formatting`, `test:srinakarin` suite (3/3), `test:rc3`
(13/13), `test:dashboard-facility-isolation` (12/12),
`test:dashboard-config-driven` (17/17), `test:facility-isolation`
(15/15), `test:all-report`(+`:pdf`), and `test:packaged-report` (6/6
across the RC-3.1 investigation) all pass. Two open items, both
non-blocking:

- **Operational limitation**: transient packaged-renderer launch failure
  immediately after a fresh build on machines running aggressive endpoint
  security (SentinelOne / McAfee / Reason Cybersecurity observed). An
  environment condition, not an application defect — see
  `docs/desktop/PACKAGED_RUNTIME_INVESTIGATION.md` and
  `docs/KNOWN_OPERATIONAL_LIMITATIONS.md`.
- **Technical debt** (maintainability only, no correctness/production
  impact): Srinakarin's device-ID list duplicated across
  `config/srinakarin/profile.json` and `SRINAKARIN_AGGREGATE_IDS`; and
  `test:excel` is **deprecated** — it targets the retired single-facility
  `RST_Dashboard.xlsm` (not present in this repository's current
  multi-site state, so the suite currently fails with `ENOENT`, not a
  regression). The Excel engine's real preservation guarantees are
  independently verified against the supported `DC_Rangsit.xlsm` /
  `DC_Srinakarin.xlsm` workbooks by the facility-isolation suites above.
  Full detail in `docs/desktop/KNOWN_TECHNICAL_DEBT.md`, planned
  resolutions in `docs/desktop/ROADMAP.md`.

The rest of this report (v1.0.0 baseline checklist below) remains valid
and unchanged.

## Verdict (v1.0.0 baseline)

**Ready for internal pilot deployment**, with the four manual checks below
performed once on a production-like machine before rollout.

## Checklist

### Functionality
- [x] Workbook open / save / save-as / reload / recent files / drag & drop / Open With
- [x] All reports render from workbook data (executive, summary, benchmark, forecast, history, trend, insight)
- [x] Data entry for UPS / Air / DC / Energy incl. historical-edit confirmation
- [x] Integrity Center (duplicates, missing months/devices, invalid IDs, blank rows, health, last validation)
- [x] Settings (workbook, startup, auto-save, backups, theme, language, Google Sheets toggle)
- [x] Optional Google Sheets sync preserved (browser build fully unchanged)

### Data safety
- [x] Backup before every save, rotation, collision-safe naming
- [x] Atomic replace (temp + rename); patched file validated by re-read **before** touching disk
- [x] Round-trip equality gate — a save that would alter data aborts instead
- [x] VBA / pivots / charts / tables / unmanaged columns preserved (byte-level test)
- [x] Lock detection with Retry / Save As / Cancel; edits never lost
- [x] Crash-recovery journal + restore offer on next launch
- [x] Restore-from-backup validates the backup and safety-backs-up the current file

### Security
- [x] `contextIsolation`, `sandbox`, no `nodeIntegration`, no remote module
- [x] Renderer has zero filesystem access; every IPC payload re-validated in main
- [x] Navigation/popup lockdown (only Google auth origins may open, external links → default browser)
- [x] No secrets in the repository or the bundle

### Portability / offline
- [x] Runs without admin from any writable folder; nothing in AppData/registry
- [x] `config/ backup/ logs/ exports/` beside the exe (verified with the real portable exe)
- [x] Zero external network requests in the desktop data path (fonts local; Google APIs only if the user enables Sheets sync)
- [x] First launch auto-opens the workbook shipped beside the exe

### Engineering
- [x] Typecheck clean (renderer + main configs); production build clean
- [x] Automated tests: 35-assertion Excel round-trip + 13-check UI E2E
- [x] Milestone commits with validation evidence per step
- [x] Logs with rotation (`logs/app.log`)

## Known limitations (accepted for an internal tool)

1. **Not code-signed** — SmartScreen "More info → Run anyway" on first run;
   sign with the enterprise certificate for wider rollout (see Deployment Guide).
2. **Excel-open verification is a manual step** — COM automation was blocked
   in the build environment. Structural checks (strict parser re-read,
   byte-identical preserved parts, clean part relationships) all pass.
3. **Light theme is functional but the dashboards are dark-optimized**
   (chart series colors unchanged).
4. **Concurrent writers are out of scope** — single-user semantics; if two
   people must edit at once, they should keep using one shared workbook and
   coordinate (the lock detection prevents silent clobbering by Excel, and
   every save has a backup).
5. **Report export buttons remain presentational** (as in the browser app);
   real JSON/CSV export exists through the exports IPC.

## Rollback story

Every save leaves the previous file in `backup/`; a bad state is one
Settings → Restore away. Uninstall = delete the folder.
