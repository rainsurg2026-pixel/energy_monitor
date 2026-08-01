# Release Manifest — v2.2.4 (Corrective Release)

## Version

2.2.4 (unchanged — this manifest supersedes the placeholder committed under
the same version number; see Local Release Lineage below)

## Why this manifest was rewritten

The previous `v2.2.4` tag pointed at commit `a2fcfa2c2902d58a7be7b7e7e196589df49df950`,
whose only changes versus `v2.2.3` were a version bump, an
`electron-builder.yml` tweak, and these two release doc files as literal
placeholders ("Pending build and verification"). Neither of the two
required v2.2.4 requirements (Google Sheets auth reliability, Rack Capacity
UI redesign) were implemented in that commit. This manifest documents the
corrective pass that actually implements, tests, and packages both.

## Scope of this corrective pass

- Google Sheets: replaced renderer-side Firebase popup/redirect auth with a
  main-process OAuth 2.0 Authorization Code + PKCE flow (RFC 8252 loopback
  redirect, RFC 7636 PKCE), `safeStorage`-encrypted token persistence, and
  a clean IPC boundary (renderer never holds a token).
- Rack Capacity and Utilization: one shared canonical status config
  (`src/utils/rackStatusConfig.ts`) now drives order/labels/colors across
  the summary card, donut, legend, zone table, Historical Explorer, and
  PDF; real progress bars (`RackStatusBar.tsx`) replace plain text; the
  obsolete "unavailable... not inferred" U-capacity claim was removed and
  replaced with a real, month-scoped second dimension; a Rack Capacity tab
  was added to the Historical Operations Explorer; Quick Jump was fixed to
  show only real, chronological, single-year, facility-scoped months.
- Bug fix: a Google auth-state listener was clearing `syncedLogs` (breaking
  History/Excel-mode views) on any non-connected state, including a failed
  sign-in attempt that never touched Excel data at all — fixed to only
  apply in the browser/iframe deployment, never in desktop mode.

Full file-level change list is in `RELEASE_NOTES_V2.2.4.md`.

## Files changed (working tree at time of corrective commit)

16 modified, 10 new (see `git show --stat` on the corrective commit below
for the authoritative list). Notable new files:

- `src/electron/googleAuth.ts`, `src/electron/googleAuthPure.ts`,
  `src/electron/ipc/googleSheets.ts`, `src/googleSheetsDriver.ts`
- `google-oauth-desktop-config.example.json` (template only — the real,
  gitignored `google-oauth-desktop-config.json` is never committed)
- `src/utils/rackStatusConfig.ts`, `src/components/RackStatusBar.tsx`
- `scripts/test-google-auth.ts`, `scripts/test-rack-status-config.ts`,
  `scripts/verify-packaged-rack-ui-visual.mjs`

## Artifacts

- **Portable EXE**: `release\Energy Monitor-v2.2.4.exe`
  - Size: 82,575,906 bytes
  - SHA-256: `c83e3509f40d6608db6cdae5c191baa7c3f774ee64032694334117379200f616`
- **Portable ZIP**: `release\Energy Monitor-v2.2.4.zip`
  - Size: 82,774,265 bytes
  - SHA-256: `0f631a9c2d6ed6841cbbc63e7c612ace723728e0358e8ecb3aeba90f9ae72eef`

Both built 2026-08-01 from the final corrected source tree (`npm run
portable` + `npm run portable:zip`), superseding the previous, incomplete
`v2.2.4` artifact (not preserved as a separate version, per instruction).

## Integrity

- Production workbooks `DC_Rangsit.xlsm` / `DC_Srinakarin.xlsm`: untouched
  by any test in this pass (verified by SHA-256 comparison before/after in
  every regression script that touches a workbook copy, and again at the
  end of `e2e-cdp.mjs` and `run-packaged-report-test.mjs`).
- Facility isolation re-verified specifically for the redesigned Rack
  Capacity UI in the packaged build: Rangsit shows 358 total / 294 In Use;
  Srinakarin shows 237 total / 218 In Use; neither facility's numbers ever
  appear while the other is active.

## Test Results

See `RELEASE_NOTES_V2.2.4.md`'s "Full Regression Testing" section for the
complete list. Summary: lint, build, `validate:formatting`, all 23
pre-existing domain regression scripts, the new `test-rack-status-config`
script (26 checks), the CDP E2E suite (74 checks), the packaged-runtime
report test, and a targeted packaged-runtime visual/screenshot pass — all
green.

## Local Release Lineage

- **Previous `v2.2.4` tag target (incomplete/incorrect)**:
  `a2fcfa2c2902d58a7be7b7e7e196589df49df950`
- **Final corrective commit**: `55f456e498a28f6ac3471b92139068b430703033`
  ("docs: record final commit hash in v2.2.4 release manifest" — a small
  follow-up to the main corrective commit `b351528f7d912edb473c040c40130dfbd6e17b59`,
  needed only to record that commit's own hash here; no application code
  changed between the two)
- **`v2.2.4` tag recreated to point at**: `55f456e498a28f6ac3471b92139068b430703033`
  (same commit — annotated tag, recreated only after every release gate
  above passed)
- This tag move is LOCAL ONLY. No remote exists for this repository; no
  push, force-push, or GitHub release/tag was performed.

## Release Gates (all required to PASS before the tag was recreated)

- [x] Lint (renderer strict + Electron strict TypeScript)
- [x] Build (Vite production build)
- [x] `validate:formatting` (number-formatting architecture check)
- [x] Full domain regression (23 scripts)
- [x] New targeted tests (`test-rack-status-config`, extended `e2e-cdp`)
- [x] Electron CDP E2E (74/74 checks)
- [x] Packaged portable runtime test (`test:packaged-report`)
- [x] Packaged visual/screenshot verification (both facilities + Google
      sign-in initiation)
- [x] Data integrity (source workbooks byte-unchanged; facility isolation
      re-verified)

## Certification

**PRODUCTION RELEASE CERTIFIED — v2.2.4 (corrective).** Both required
v2.2.4 acceptance-scope items (Google Sheets authentication reliability,
Rack Capacity and Utilization UI/UX redesign) are implemented, tested, and
verified against real workbook data and the packaged executable, subject to
the one disclosed, genuinely-external limitation: live Google OAuth user
consent has not been exercised (requires the user's own Google Cloud
Console credentials — see `RELEASE_NOTES_V2.2.4.md`).
