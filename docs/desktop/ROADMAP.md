# Roadmap — Energy Monitor Desktop

Forward-looking items only. Current-state facts belong in
`ARCHITECTURE.md`; open debt belongs in `KNOWN_TECHNICAL_DEBT.md` — this
file tracks what to do about them, not implemented yet.

## From RC-3

- **Generate `config/srinakarin/profile.json`'s `dashboard` block from
  `SRINAKARIN_AGGREGATE_IDS`** (`src/utils/srinakarinPower.ts`) at build
  time, instead of hand-maintaining the same 10 device IDs in both
  places. See `KNOWN_TECHNICAL_DEBT.md` §1.
- **Replace `test:excel` / `scripts/test-excel-roundtrip.ts`** (targets
  the retired single-facility `RST_Dashboard.xlsm`) with an equivalent
  byte-level preservation test against `DC_Rangsit.xlsm` /
  `DC_Srinakarin.xlsm`. See `KNOWN_TECHNICAL_DEBT.md` §2.
