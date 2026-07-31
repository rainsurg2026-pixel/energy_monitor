# Energy Monitor v2.2.3

## Rack Capacity and Utilization (extends v2.2.2's Rack Capacity Management)

The v2.2.2 "Rack Capacity Management" feature is renamed and restructured
into **Rack Capacity and Utilization**, extended with full multi-field
editing, an explicit Month/Year model for its History snapshots, and a new
**Rack Unit Capacity** worksheet/section covering the previously-unavailable
U-capacity (rack-unit space) dimension.

- **Editable Cabinet Size / Detail / Device Type.** In addition to Status,
  the Editor now stages Cabinet Size, Detail, and Device Type edits on the
  same row (one staged change can touch any combination of the four fields).
  Optimistic concurrency checks **every changed field's** expected value
  before writing any of them — a conflict on one field blocks the whole
  row's save (all-or-nothing), never a partial write.
- **Naming.** "Rack Capacity Overview" → **"Rack Capacity and Utilization"**
  (heading, nav tab, PDF section — Thai and English). The internal route key
  (`"rackCapacity"`) is unchanged; this is a presentational rename only. The
  subtitle no longer exposes the internal `Table7` workbook table name
  ("Summary from Rack Capacity / Table7" → "Rack capacity, status and
  utilization summary").
- **Page order.** The overview (count cards, donut, zone table) now renders
  at the **top** of the page, followed by the new Rack Unit Capacity panel,
  then the Rack Capacity Editor (search/staged edits/save), then History.
- **Explicit Month/Year selector, not a system-month assumption.** Saving a
  field edit used to silently snapshot History under whatever month
  `Dashboard-FAC!H1` currently reported. The Editor and the new Rack Unit
  Capacity panel now share one Month/Year selector; saving a field edit
  upserts **that selected month's** History snapshot. Table7 itself has no
  month dimension and remains current-state only — selecting a past month
  updates that month's historical snapshot without rolling back Table7's
  live data.
- **New "Rack Unit Capacity" worksheet**, in both workbooks: a structured
  Excel Table (`Month`, `Total (U)`, `Used (U)`, `Available (U)`,
  `Availability Capacity (%)`), one row per month, created idempotently on
  first use. `Total (U)`/`Used (U)` are the two independently-entered facts
  (no authoritative source exists for U-capacity in either workbook — it is
  a genuinely separate business dimension from rack count and is never
  inferred from it); `Available (U)` and `Availability Capacity (%)` are
  derived exactly once server-side (`Total − Used`; `Available / Total`,
  blank when `Total` is 0) and persisted as plain values, never a live Excel
  formula. Month is a real Excel date (first-of-month, `mmm-yy` display),
  never a text string.
- **K9 image relocated.** The K9-anchored image moves from the `Rack
  Capacity` sheet to the new `Rack Unit Capacity` sheet and is relabeled
  **"Rack Unit Capacity Image"**. A one-time, idempotent migration runs on
  every Rack Capacity save: any pre-v2.2.3 image still on the old sheet is
  moved (exact bytes and aspect ratio preserved) to the new sheet, and the
  old drawing/media/rels/Content_Types entries are removed only after the
  new embed has fully succeeded. Fresh uploads now go directly to the new
  sheet; the old sheet never receives a new image again.
- **Rack Capacity History formatting fix.** `SnapshotMonth` is now a real
  Excel date (`mmm-yy`), and all five `*Pct` columns (`UsagePct`,
  `AvailabilityPct`, `ReservedPct`, `PendingDismantlePct`, `OtherPct`) now
  carry a real `0.00%` number-format style — values remain 0–1 fractions on
  disk, never pre-multiplied by 100. Existing v2.2.2 text-Month rows migrate
  automatically and idempotently on the next save (no-op once migrated).
- **Export All Report (PDF).** Section renamed to "Rack Capacity and
  Utilization"; a new Rack Unit Capacity block (latest month's Total/Used/
  Available (U) and Availability Capacity (%), plus the Rack Unit Capacity
  Image as an embedded `<img>`) and a new Availability % trend page were
  added. The report's existing "no `<img>` allowed" content check now
  specifically allows this one expected image.

## A real, previously-latent bug found and fixed while building this feature

`ensureExactCellFormatStyles()` (the shared helper both Rack Capacity History
and the new Rack Unit Capacity writer use to register number-format styles)
searched the **entire** `styles.xml` document for a reusable `<numFmt>`,
instead of scoping the search to the real `<numFmts>` custom-format registry.
`styles.xml` can also contain `<numFmt>` elements nested inside `<dxfs>`
(conditional-formatting/pivot differential-format records) — a separate
id-numbering context. Proven on the real production `DC_Rangsit.xlsm`: a
`dxf`-scoped `<numFmt numFmtId="14" formatCode="0.00%"/>` exists, while
`numFmtId` 14 is Excel's **builtin** `"m/d/yyyy"` format — the old code would
have written a percentage cell styled as a garbled date. Caught by this
release's own Rack Unit Capacity tests (which check the real, scoped
`<numFmts>` registry, not a document-wide scan) before it ever reached a
release; fixed by scoping the reuse-lookup to the `<numFmts>` container
(allocation of a brand-new id still scans the whole document, to avoid ever
colliding with a `dxf`-scoped id). This also retroactively fixes the same
class of risk for v2.2.2's Rack Capacity History percentage columns, on the
real production workbook.

A second, related bug (`locateTableXmlPath`'s naive `"xl/worksheets/" +
target` string concatenation, which produced an invalid zip entry path for
a relationship Target like `"../tables/table7.xml"`) was found and fixed the
same way — via a new shared `resolveRelationshipTarget()` helper that
properly collapses `../` traversal, mirroring `WorkbookWriter.ts`'s existing
`resolveTarget()`.

## Architecture note

A renderer-bundle regression was caught mid-development: this session's
Rack Capacity History rewrite (reusing `WorkbookWriter.ts`'s date/style
helpers) accidentally pulled `fs`/`path`/`ExcelJS` into the browser bundle
(`RackCapacityHistoryWriter.ts` is imported by renderer components). Fixed
by extracting the pure, browser-safe helpers into a new `ExcelZipUtils.ts`
module that neither `WorkbookWriter.ts` nor any Rack Capacity module needs
Node builtins to use. The same split was then applied consistently to the
new `RackUnitCapacityWriter.ts` (browser-safe read/upsert logic, importable
by the PDF report builder) versus `RackUnitCapacitySaveWriter.ts` (Node-only
lock/backup/atomic-write orchestration) and `SheetImageWriter.ts` (the
generic K9-image-embed logic, shared by both the old and new sheets without
creating a circular import between their two writer modules).

## Release files

- Portable EXE: `release/Energy Monitor-v2.2.3.exe` (SHA-256 `ABDFD87696135E145FE2B6C9967BCB441BA5140AC542DCD90C34A4CDAE41713A`)
- Portable ZIP: `release/Energy Monitor-v2.2.3.zip` (SHA-256 `91ED705E68449155347431D6A9022226C41E5FB454271B634CE4FE7DF41CABEC`)
- Release commit: `8a3aff5` ("auth: switch to redirect+popup fallback for iframe compatibility")
- Verification record: `docs/releases/RELEASE_MANIFEST_V2.2.3.md`

## Auth fix for iframe compatibility

The original v2.2.3 release was augmented with an essential fix for Firebase
Auth's iframe incompatibility (error: "This third-party cookie will be blocked.
Learn more in the Issues tab."). In environments where third‑party cookies are
blocked—Electron's embedded browser, any same‑site‑contextualized app,
Chrome's default cookie policy for cross‑origin iframes—the auth screen now
falls back to a redirect‑then‑popup flow that never relies on a silent iframe.
The `src/firebaseAuth.ts` change ensures the app can sign in across all
deployment scenarios; the fix does not affect any other business‑logic or
UI‑layout feature.

## Known limitations

- Vite renderer chunk advisory above 500 kB remains (carried over from prior
  releases; no functional/runtime failure found).
- Microsoft Excel was unavailable in this environment. The Rack Unit
  Capacity sheet/table, the relocated K9 image, and the History format
  migration were verified by direct OOXML inspection, ExcelJS re-open, and
  the full automated + packaged-runtime test suite; an operator may
  optionally open a copy of either workbook after a real save in Excel to
  visually confirm.
- `upsMappingReader.ts`'s cached-value dependency (documented in v2.2.1's
  `KNOWN_TECHNICAL_DEBT.md` item 4) is unrelated to and unchanged by this
  release.
