# Energy Monitor Web Clean v1 — Requirements

## Source-of-truth rule

Energy Monitor Desktop v2.3.1 is the only source of truth for user-visible
layout, labels, number/date formatting, input behavior, calculations,
dashboard values, history behavior, and report content. The web implementation
must adapt storage and session handling without changing those contracts.

## In-scope user workflow

### Normal user

1. Login with an active account.
2. Open the facility and reporting month.
3. Enter UPS, Air, DC, and Energy/Cost data.
4. Receive the Desktop-compatible validation/completion feedback.
5. Save the month transactionally.
6. Reload the browser and see the saved values.
7. Edit a permitted existing month and save with concurrency protection.
8. View Dashboard Summary and historical records/charts.
9. Download Excel, CSV, and PDF report output.
10. Logout and login again; previously saved data remains visible.

### Administrator

1. Login as an admin.
2. List users.
3. Create a user with a password and role.
4. Enable or disable a user.
5. Delete a user subject to self-protection and session revocation rules.
6. Reset a user password.
7. Configure the Global Display Period without altering historical records.

## Desktop data contract

The Desktop `MonthlyLog` contract contains:

| Section | Required data |
|---|---|
| Month | Canonical `YYYY-MM` key. |
| UPS | `upsId`, voltage, current, load kW, load kVA; optional phase readings for Srinakarin. |
| Air | EB41A, EB41B, EB42A, EB42B; Srinakarin also EB43A, EB43B, EB44A, EB44B through the configured meter map. |
| DC | Panel ID, voltage, current. |
| Energy/Cost | Building energy kWh and building electricity cost THB. Desktop-calculated floor cost/rate values are derived, not user inputs. |
| Metadata | Per-section last-saved timestamps, configured calculation profile, and Srinakarin phase snapshot where applicable. |

Current Desktop facility profiles are Rangsit and Srinakarin. Device names,
meter names, UPS groups, capacities, labels, and required sections come from
the facility profile; they are not hard-coded into a new web-only model.

## Validation requirements

- Reject malformed JSON, unknown facility/month identities, non-finite numeric
  values, invalid role/user identifiers, and stale `row_version` values.
- Preserve Desktop blank/null behavior. A blank dependency produces an
  unavailable derived metric, not a fabricated zero.
- Preserve the Desktop required-section completion rules: UPS, Air, DC, and
  Energy/Cost are required and all configured fields are required for a
  complete save prompt.
- Preserve Desktop auto-fill suggestions in the input tables, but treat the
  resulting values as user-editable inputs and validate them on the server.
- Do not add new operating-range rules that Desktop v2.3.1 does not enforce.
  Voltage/current benchmark warnings may remain warnings.
- Save raw inputs and recalculate derived values server-side.

## Calculation requirements

The authoritative formulas are in `src/domain/energyCost.ts`,
`src/domain/engineeringDashboard.ts`, `src/domain/analytics.ts`, and related
domain modules. Clean v1 must call those functions rather than reimplementing
them in an API route or UI component.

- UPS energy: required group/member load kW sum × 24 × calendar days.
- Air energy: required current-minus-previous-month meter deltas × 1,000,000.
- DC energy: `(voltage × current / 200) × 220 / 1000 × 24 × days` per panel.
- Floor energy: UPS + Air + DC when every required component is available.
- Average rate: building cost ÷ building energy, except null/zero inputs.
- Floor cost: average rate × floor energy when both are available.
- Floor share: floor energy ÷ building energy × 100 when building energy is
  non-zero.
- Dashboard UPS group load: kVA ÷ configured capacity × 100; available % is
  clamped at zero. Display fallbacks follow Desktop behavior.
- Srinakarin phase aggregates use the existing Desktop phase module.

## Dashboard and history requirements

Dashboard Summary must preserve the Desktop card hierarchy, selected-month
filter, KPI labels, tables, charts, colors, spacing, and formatting. Historical
Explorer must preserve its search/filter/sort/status workflow and show the raw
monthly sections plus calculated energy/cost values. The Dashboard and export
builder must receive the same calculation snapshot for the selected month.

Global Display Period is an admin-only setting. It constrains Dashboard, Data
Entry, History, Site Comparison, and every export through the server-owned
visibility rule. Updating it changes visibility only; it must never delete or
rewrite historical monthly records.

Site Comparison reads the scoped server DTO for every active facility. It uses
the Desktop comparison metrics, a common/reference month, and 3/6/12-month
energy trends. Missing facility-month data remains unavailable rather than
being converted to zero.

Rack Capacity, Rack Unit Capacity, advanced forecasting, Google Sheets, and
workbook integrity/round-trip surfaces remain deferred from clean v1.

## Export requirements

### Excel

The report workbook must contain the same relevant data and calculations as
Desktop report export:

- Summary
- UPS Loads
- Air Conditioning
- DC Power Panels
- Energy & Cost

It must preserve blank values, numeric precision, headers, filters/frozen
headers, and a print-friendly layout. It must not attempt to preserve macros or
rewrite the source Desktop workbook.

### CSV

Provide a browser download with Desktop-compatible section blocks for UPS,
Air, DC, and Energy/Cost. Escape commas, quotes, and newlines correctly;
format calculated numeric values with the shared number formatter; keep nulls
blank.

### Export scopes

Excel, CSV, and PDF must each support the current facility, all facilities,
and the Site Comparison KPI snapshot. All-facilities files preserve a clear
facility boundary; Site Comparison files use the same scoped API metrics shown
on-screen. No export may enumerate data outside the Global Display Period.

### PDF

The clean report contains the Desktop report family’s core structure:

1. Cover with facility, reporting month, historical range, and version.
2. Selected-month Building Energy Dashboard with KPI cards.
3. UPS group/detail, Air delta, DC load, and overall cost tables.
4. Facility trend pages for floor, UPS, Air, DC, cost, and average rate.
5. Monthly Energy & Cost table.

The PDF must be generated from the same normalized logs/calculations as the
screen and must pass sanitized fixture comparisons before deployment.

## Security requirements

- Passwords are never stored or logged in plaintext.
- Server secrets and database credentials never enter a client bundle,
  response DTO, browser storage, or report output.
- Session cookies are HttpOnly/Secure/SameSite and revoked on logout, disable,
  delete, and password reset where applicable.
- State-changing requests require a session-bound CSRF token.
- Admin routes enforce permissions server-side and protect the last admin and
  the current session from destructive self-actions.
- SQL uses parameterized queries; input payloads are bounded and validated.
- PostgreSQL RLS remains enabled and the runtime identity is never
  `postgres`, a superuser, or BYPASSRLS.

## Acceptance tests

The release is not accepted until automated and browser evidence proves:

- normal-user login/session/logout/re-login;
- data entry, validation, save, reload, permitted edit, history, and dashboard;
- Excel, CSV, and PDF downloads open and contain correct data/calculations;
- admin create/enable/disable/delete/reset-password flow;
- multiple-user authorization and disabled-user denial;
- RLS, grants, TLS, runtime identity, and secret-redaction checks;
- modern-browser rendering and Desktop visual/functional parity at the target
  desktop viewport;
- Preview UAT, Production deployment, smoke test, and rollback drill.
