# User Guide — Energy Monitor (Portable Desktop)

## 1. Starting the app

Double-click **`Energy Monitor.exe`**. On first launch the app opens the
`RST_Dashboard.xlsm` sitting next to the executable. After that it reopens
whatever workbook you used last (configurable in **4. Settings**).

Other ways to open a workbook:

- **Open…** button (entry page or Settings) → native file picker
- **Drag & drop** any `.xlsm`/`.xlsx` anywhere onto the window
- **Recent files** list on the welcome panel
- **Right-click a workbook in Explorer → Open with → Energy Monitor.exe**
- Double-clicking a second time while the app runs hands the file to the
  already-open window

## 2. The four views

| Tab | What it is |
|---|---|
| **2. Dashboard Summary** | All reports: Executive, Dashboard, Benchmark, Forecast — with the universal filter bar (year, period, trend window, compare mode, category, site, UPS group) |
| **1. Data Entry Sheet** | Monthly logging tables: UPS Loads, Air Conditioning, DC Panels, Energy & Cost |
| **3. Historical Logs** | Trend charts + the Historical Explorer (view / edit past months) |
| **4. Settings & Integrity** | Workbook, backups, auto-save, theme, language, Google Sheets — plus the Data Integrity Center |

## 3. Entering data

1. Go to **1. Data Entry Sheet**. The latest month is selected; use
   **Add New Month** for a new period.
2. Fill a table and press its **Save** button. The data is written into the
   workbook immediately — a timestamped backup is created first, and the file
   is replaced atomically (a failed save can never corrupt it).
3. Editing an older month (via **3. Historical Logs → Edit**) shows a
   confirmation popup before saving, exactly like before.

**Workbook status strip** (top of the entry page): open file, months count,
Saved / Unsaved-changes badge, "Open in Excel" lock warning, and the
Open / Reload / Save As / Show-in-folder actions.

### If the workbook is open in Excel

Saving is blocked while Excel holds the file. The app shows a dialog with:

- **Retry** — after you close the file in Excel
- **Save As…** — write everything to a new file instead
- **Cancel** — keep working; your edits stay in memory and are journaled

## 4. Backups & restore

- A backup is created in `backup/` **before every save**:
  `RST_Dashboard_2026-07-16_183200.xlsm`
- Retention is configurable (Settings → *Backups to keep*, default 20).
- **Restore**: Settings → backup list → *Restore*. The backup is validated
  first and your current file is safety-backed-up before being replaced.

## 5. Auto-save & crash recovery

- **Auto-save** (default every 5 min, configurable/disable-able) writes only
  when there are unsaved changes.
- If a save fails (e.g. file locked) or the app closes unexpectedly, your
  unsaved data is journaled. On the next launch the app offers
  **Restore & Save** or **Discard**.

## 6. Integrity Center (Settings tab)

Shows workbook health at a glance and the full findings list:

- Duplicate records (same month + device twice)
- Missing months (a month present in one sheet but absent in another)
- Missing devices (a month lacking one of the expected UPS/DC units)
- Invalid device IDs and rows without a valid month
- Structure validation + last-validation timestamp; **Validate now** re-reads
  the file from disk

## 7. Settings reference

| Setting | Meaning |
|---|---|
| Default workbook | File used when startup behavior is "Open default" |
| On startup | Open last file / Open default / Ask every time |
| Auto-save interval | 0 (off) – 60 minutes |
| Backups to keep | Rotation depth of `backup/` |
| Theme | Dark (recommended) / Light |
| Language | ไทย / English (also toggleable from the header) |
| Google Sheets | Optional: shows the sync board on the entry page for cloud sync (requires internet + Google sign-in) |

All settings live in `config/config.json` beside the exe — copy the folder,
and your settings travel with it.

## 8. PIN lock

Header → **Set PIN Lock** to require a PIN when the app opens (stored as a
hash in `config/config.json`). The **lock** button locks the screen
immediately.

## 9. Opening the workbook in Excel

Any time the app is *not* saving you can open `RST_Dashboard.xlsm` in Excel
as usual — dashboards, macros, and pivots are intact. On open, Excel
recalculates formulas and refreshes pivot caches automatically (the app
requests this), so the Dashboard-FAC sheet reflects everything entered in the
app. Close the file in Excel before saving from the app again.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| "Workbook is locked" | Close the file in Excel (check for the hidden `~$RST_Dashboard.xlsm` owner file if Excel crashed) and Retry |
| "Not a compatible workbook" | The file is missing one of the four log sheets or their `Month` header rows — see the exact error text |
| Reports empty | No workbook open — use the welcome panel |
| Something looks wrong after a bad edit | Settings → Backups → Restore the last good backup |
| Anything else | Check `logs/app.log` beside the exe |
