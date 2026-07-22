# RC-3 — Release Candidate Notes

**Scope:** the current release-candidate round on top of the v1.0.0
portable desktop baseline (`docs/desktop/MIGRATION_SUMMARY.md`,
`docs/desktop/PRODUCTION_READINESS.md`), spanning facility/multi-site
configuration (RC1), the data-entry workflow (RC2), the data-entry
experience and save-pipeline hardening (RC3), and a broader
formatting-architecture and Excel-engine hardening pass. Commits:
`53abe77`…`dac0b2d` (RC1) → `5423d89` (RC2) → `5524cae`, `c10565c` (RC3).

## Summary

RC-3 completes the data-entry and save-pipeline hardening line of work
and closes out the number-formatting architecture standardization
(`docs/desktop/adr/ADR-001-Number-Formatting-Standard.md`) across the
reporting and dashboard layer. RC-3 functional
verification is complete; the one remaining item is a documented,
non-blocking operational limitation in the packaged-runtime test
environment (see below) — not an application defect.

## Completed

### Multi-site / facility architecture
- Config-driven facilities with live workbook switching (`53abe77`);
  `facilities.json` entries and `FacilityProfile` now carry `displayName`
  + `reportTitle` used by exports/reports, with backward-compatible
  defaults for existing config files (`dac0b2d`).

### Data-entry workflow and experience (RC2 / RC3)
- Unsaved-changes protection (Save/Discard/Cancel on facility/year/month
  switch), automatic Read-Only Mode with a persistent reason banner,
  workbook auto-recovery dialog, always-visible status bar, cross-year
  calendar navigation, Last Saved indicator (`5423d89`).
- Interactive validation summary (filled/total + jump-to-error),
  value-accurate dirty indicator, staged save progress with elapsed time,
  auto-scroll/focus/highlight on failed save, session undo (Ctrl+Z),
  export/refresh shortcuts, internal performance monitor (`5524cae`).

### Save-pipeline hardening
- Fixed undo history surviving a month/facility/workbook context switch
  and corrupting the wrong record.
- Fixed a synchronous re-entrancy gap that allowed two saves to race on
  the same file.
- Save-progress UI now reflects the backend's actual failure stage
  instead of inferring it client-side.
- Removed leftover recovery debug logging (`c10565c`).
- Added a permanent regression suite, `npm run test:rc3` (13 checks),
  covering all of the above.

### Formatting architecture (ADR-001, `docs/desktop/adr/`)
- All presentation numeric values route through the shared formatter
  (`formatNumber` / `formatDecimal` / `formatPercentage` / `formatEnergy`
  in `src/utils/numberFormat.ts`, exposed via `numberFormatBridge.ts`).
  Direct `toFixed` / `toLocaleString` / `Intl.NumberFormat` calls are no
  longer used in presentation code (SVG/canvas geometry remains an
  explicit, documented exception).
- Enforced by an architecture validator (`npm run validate:formatting`)
  that rejects formatting imports from `energyCost.ts` and direct
  presentation formatting outside the shared utility.

### Excel synchronization / workbook engine hardening
- Continued hardening of `WorkbookWriter`, `WorkbookValidator`,
  `ExcelSchema`, and `SheetMapper` on top of the existing zip-level
  surgical-patch approach (VBA/pivot/chart-safe writes; validate-then-
  replace atomic saves).
- Workbook preservation, VBA preservation, formula preservation, and
  round-trip integrity are all verified by the automated suite (below) —
  not re-derived by hand for this release.

### Regression and verification suite
- `npm run test:rc3` — 13/13 (save-pipeline hardening, above)
- `npm run test:facility-isolation` — 15/15, `test:dashboard-facility-isolation`
  — 12/12, `test:dashboard-config-driven` — 17/17 (multi-site isolation
  and dashboard config-driven architecture, including the read/write/
  round-trip, VBA/pivot/chart byte-level preservation, and lock-detection
  coverage previously provided by `test:excel`, now run against the
  supported `DC_Rangsit.xlsm`/`DC_Srinakarin.xlsm` workbooks)
- `npm run test:excel` — **deprecated**, targets the retired single-facility
  `RST_Dashboard.xlsm`; see `KNOWN_TECHNICAL_DEBT.md` §2
- `npm run test:srinakarin`, `test:srinakarin:roundtrip`,
  `test:srinakarin:aggregate` — pass (second-facility read, round-trip,
  and rack-aggregation checks)
- `npm run test:all-report`, `test:all-report:pdf` — pass (report data
  assembly + PDF generation)
- `npm run test:packaged-report` — pass (packaged-runtime CDP export
  smoke test; see Known Operational Limitation)

## Known operational limitation

Packaged runtime may experience a transient renderer launch failure
immediately after a fresh build on systems protected by aggressive
endpoint security (observed: SentinelOne, McAfee, Reason Cybersecurity).
This is an environment condition, not an application, Excel
synchronization, or CDP defect — full root-cause evidence in
`docs/desktop/PACKAGED_RUNTIME_INVESTIGATION.md`, operational recovery
steps in `docs/KNOWN_OPERATIONAL_LIMITATIONS.md`.

## Known technical debt

Two items, neither blocking release — full detail in
`docs/desktop/KNOWN_TECHNICAL_DEBT.md`, planned resolutions in
`docs/desktop/ROADMAP.md`:

- Srinakarin's device-ID list is duplicated across
  `config/srinakarin/profile.json` and `SRINAKARIN_AGGREGATE_IDS`
  (`src/utils/srinakarinPower.ts`) — JSON cannot reference a TypeScript
  constant. Maintainability concern only; not a correctness or
  production issue (verified identical by
  `scripts/test-dashboard-config-driven.ts`).
- `test:excel` (`scripts/test-excel-roundtrip.ts`) is **deprecated**: it
  targets `RST_Dashboard.xlsm`, the pre-multi-site single-facility
  workbook, which is no longer part of the supported architecture. The
  Excel engine's actual preservation guarantees are independently
  verified against the supported `DC_Rangsit.xlsm` /
  `DC_Srinakarin.xlsm` workbooks by `scripts/test-facility-isolation.ts`
  and `scripts/test-dashboard-facility-isolation.ts`.

## Not part of this release

No changes to business calculations, Excel synchronization logic, or
application architecture were made while preparing this release —
release-preparation work in this pass was limited to documentation, a
packaged-test-script diagnostics improvement (classification only, no
new retries or sleeps), and excluding vendored, non-application skill
scaffolding from the TypeScript lint project (see Final Verification).

## Final verification (this pass)

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run build` | Pass |
| `npm run validate:formatting` | Pass |
| `npm run test:excel` | **Deprecated** — targets retired `RST_Dashboard.xlsm`; see `KNOWN_TECHNICAL_DEBT.md` |
| `npm run test:facility-isolation` | Pass — 15/15 |
| `npm run test:dashboard-facility-isolation` | Pass — 12/12 |
| `npm run test:dashboard-config-driven` | Pass — 17/17 |
| `npm run test:srinakarin` (+ `:roundtrip`, `:aggregate`) | Pass — 3/3 |
| `npm run test:rc3` | Pass — 13/13 |
| `npm run test:all-report` (+ `:pdf`) | Pass |
| `npm run test:packaged-report` | Pass — 6/6 across this investigation |
