# Deployment Guide — Energy Monitor (Portable)

## Building the distributable

```bash
npm install          # once
npm run portable     # → release/Energy Monitor.exe
npm run portable:zip # → release/EnergyMonitor_Portable.zip
```

`portable:zip` stages this layout and zips it:

```
Energy Monitor/
├─ Energy Monitor.exe
├─ RST_Dashboard.xlsm        (copied from the project root)
├─ config/ backup/ logs/ exports/
├─ docs/                     (docs/desktop/*)
└─ README.md
```

Build machine requirements: Windows x64, Node 20+, internet for the *first*
build only (Electron binaries are cached afterwards).

## Rolling out

1. Copy `EnergyMonitor_Portable.zip` to the target machine (file share, USB —
   no network needed on the target).
2. Extract to any user-writable folder, e.g. `D:\Energy Monitor\`.
   **Avoid** `C:\Program Files` — portable apps need write access beside the
   exe for config/backups/logs.
3. Double-click `Energy Monitor.exe`. First launch auto-opens the bundled
   `RST_Dashboard.xlsm`.

No administrator rights, no installer, no registry changes, no AppData usage.
Works fully offline.

### Deploying to users who already have a live workbook

Ship the ZIP *without* replacing their workbook: after extracting, delete the
bundled `RST_Dashboard.xlsm` and either copy their live file in, or just
open it from its existing location (File > Open / drag & drop). The app
remembers it.

### Windows SmartScreen note

The exe is not code-signed with an organization certificate. On first run
SmartScreen may show "Windows protected your PC" → **More info → Run anyway**.
For wider internal distribution, sign `Energy Monitor.exe` with your
enterprise code-signing certificate (`electron-builder` supports this via the
`win.certificateSubjectName`/`signtoolOptions` config, or sign the built exe
with `signtool sign /a "Energy Monitor.exe"`).

### "Open With" association (optional, per user, no admin)

Right-click any `.xlsm` → *Open with* → *Choose another app* → browse to
`Energy Monitor.exe`. Do **not** tick "Always" unless the user prefers the
app over Excel as the default.

## Updating to a new version

1. Close the app.
2. Replace `Energy Monitor.exe` (and `docs/`) with the new version.
3. Keep `RST_Dashboard.xlsm`, `config/`, `backup/` — they are the user's
   data. Older configs are merged with new defaults automatically; workbook
   sidecar metadata is upgraded by `WorkbookVersion` on open.

## Uninstalling

Delete the folder. Nothing else was ever written to the machine.

## Operational notes

- **Backups** accumulate in `backup/` with rotation (default 20). For
  belt-and-braces, include the whole app folder in whatever file backup the
  team already runs.
- **Logs**: `logs/app.log` (rotated at 1 MB) records opens, saves, backups,
  restores and errors with timestamps.
- **Excel coexistence**: users can keep using the workbook in Excel; the app
  refuses to save while Excel holds the lock and offers Retry/Save As.
