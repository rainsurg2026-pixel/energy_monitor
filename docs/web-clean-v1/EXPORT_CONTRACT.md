# Web Clean v1 Export Contract

## Excel

Web Clean v1 exports Excel reports as `.xlsx` files using the Office Open XML
workbook format.

The Web export is a report workbook generated from API data. It is not a
round-trip copy of the Desktop `.xlsm` source workbook and does not promise to
preserve VBA projects, Desktop-only pivot caches, chart objects, or the exact
source workbook formatting. The Desktop `.xlsm` files remain authoritative
reference/import sources; Web report output is intentionally `.xlsx`.

The export contract is:

- filename extension: `.xlsx` exactly once;
- MIME type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
- report data and calculated tables come from the selected API scope;
- Rack Unit Capacity values and image metadata are included when available;
- binary Rack Unit Capacity image objects are not embedded unless a future
  export design explicitly adds that capability;
- no export operation writes back to the source `.xlsm` or Production data.

The XLSX output must be validated by opening the serialized workbook and
checking required sheets and row counts against the source/API acceptance
fixtures. Exact Desktop workbook/VBA parity is a separate feature and must not
be inferred from a successful `.xlsx` download.
