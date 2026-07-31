# Energy Monitor v2.1.0

## Highlights

- Added **Site Comparison**. Reads Rangsit and Srinakarin workbooks in one
  read-only view and compares latest month, PUE, energy, cost, meter count,
  and month count.
- Added complete multi-workbook path:
  `FacilityComparison` → `ExcelProvider` → DesktopBridge → preload →
  `excel:openMultiple` → facility-specific workbook parser.
- Preserved facility isolation. Each comparison request carries its own UPS,
  DC, and Air device configuration; missing `airFields` now fails instead of
  falling back to Rangsit defaults.
- Preserved Srinakarin's six Air meters: EB41A/B, EB43A/B, EB44A/B.
- Made dashboard UPS groups and mappings facility-configured instead of UI
  branches or shared hardcoded mappings.

## Reliability

- Hardened UPS Group History migration and incremental persistence.
  Unchanged data is a byte-identical no-op; repeated save cycles no longer
  create duplicate styles or grow the workbook.
- Hardened Excel test isolation. Roundtrip, migration, stress, and packaged
  runtime tests use copied workbooks, protecting source facility data.
- Hardened packaged runtime smoke test. It stages a copied portable EXE and
  both facility workbooks, verifies facility switching, comparison, PDF
  exports, startup logs, clean shutdown, and source-workbook hashes.
- Removed stale optional workbook packaging entry. ZIP now ships only the two
  configured facility workbooks.

## Release files

- Portable EXE: `release/Energy Monitor-v2.1.0.exe`
- Portable ZIP: `release/Energy Monitor-v2.1.0.zip`
- Verification details: `docs/releases/RELEASE_MANIFEST_V2.1.0.md`

## Known limitations

- Some source Dashboard-FAC formula caches contain pre-existing `#VALUE!`
  results. Application calculations use parsed source data, not those caches.
- Renderer bundle exceeds Vite's 500 kB advisory chunk size. No runtime fault
  found in production packaging verification.
