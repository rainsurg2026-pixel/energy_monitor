# Energy Monitor v2.2.0

## Site Comparison

- Removed PUE from Site Comparison. PUE features outside this view remain unchanged.
- Added real workbook-backed **Reference Month** selector. Available months are
  unioned from Rangsit and Srinakarin monthly records; no month is hardcoded.
- Added shared **3 / 6 / 12 month** display range. Reference month is range end
  for comparison table and both charts.
- Added required two-site comparison table: whole-building energy/cost, Floor 4
  energy/cost, average electricity rate, and Floor 4 energy share.
- Added bold site names with warm Rangsit and cool Srinakarin row treatments.
- Added monthly Energy Trend and Floor 4 Cost Trend charts using same range.
- Added direct chart labels with shared compact `K` / `M` / `B` formatting.
  Tooltips retain full formatted values.
- Preserved missing monthly data as `null`; charts do not invent zero values.

## Data integrity

- Stored authoritative Floor 4 cost and average electricity rate now survive
  workbook mapping and are preferred over fallback calculations.
- Multi-workbook comparison retains facility identity and facility-specific Air
  fields through UI, provider, bridge, preload, IPC, and workbook reading.
- Rangsit always reads `DC_Rangsit.xlsm`; Srinakarin always reads
  `DC_Srinakarin.xlsm`.

## Release files

- Portable EXE: `release/Energy Monitor-v2.2.0.exe`
- Portable ZIP: `release/Energy Monitor-v2.2.0.zip`
- Verification record: `docs/releases/RELEASE_MANIFEST_V2.2.0.md`

## Known limitations

- Vite reports one renderer chunk above its 500 kB advisory threshold. Build
  and packaged runtime tests pass. Add code splitting only when startup or
  distribution evidence warrants it.
- Microsoft Excel was unavailable. OOXML/VBA/pivot/chart/table preservation
  tests passed; an operator may perform an optional copied-workbook Excel smoke
  test.
