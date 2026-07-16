# Address Platform

Current-state reference for the Thai Province/District/Subdistrict/
Postcode platform. The decision record (why it looks like this, what
was considered and rejected) lives in
`docs/adr/ADR-011-Address-Platform.md` - this document is the
architecture/schema/API reference kept in sync with the code, not a
duplicate of that ADR's reasoning.

## Architecture

```
Supabase (provinces / districts / subdistricts)
  ↓
AddressRepository (src/shared/master-data/address/AddressRepository.ts)
  ↓
MasterDataService (src/shared/master-data/MasterDataService.ts)
  ↓
/api/master/provinces | /api/master/districts | /api/master/subdistricts
  ↓
AddressSelector (src/components/shared/scope/AddressSelector.tsx)
  ↓
Business modules (NTR today; PM/future modules reuse the same component)
```

No business module queries Supabase directly for address data, and none
imports `AddressRepository` directly - only `MasterDataService` does.
This is the same boundary `AttachmentService` established for the
Storage Platform (`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s Master
data rules #1 and #3).

## Database

Canonical tables (migration `address_platform_canonical_tables`):

| Table | Row count | Primary key | Foreign keys | Indexes |
|---|---|---|---|---|
| `provinces` | 77 | `province_id` | - | (PK) |
| `districts` | 928 | `district_id` | `province_id` → `provinces` | `districts_province_id_idx` |
| `subdistricts` | 7,436 | `subdistrict_id` | `district_id` → `districts`, `province_id` → `provinces` | `subdistricts_district_id_idx`, `subdistricts_postcode_idx` |

RLS is enabled on all three with a permissive `SELECT ... USING (true)`
policy - non-tenant-scoped reference data every authenticated session
reads identically, matching the existing pattern for `problem_codes`/
`product_families`.

**Staging/seed tables** (immutable, never read by application code):
`provinces_raw`/`districts_raw`/`subdistricts_raw` - the original,
undeduplicated import (7,436 rows each, one row per subdistrict-level
source record, regardless of which entity that row's columns describe).
The canonical tables above were populated from these via `DISTINCT ON
(id) ... ORDER BY id, ctid`, picking one canonical name per id
deterministically. Kept for: re-seeding the canonical tables if
Thailand's official boundaries ever change, and as an audit trail of
the original import.

`src/shared/master-data/address/seed/thaiAddressData.ts` and its
`data/thaiAddressMaster.json` are the pre-Supabase (v1) seed source -
kept only as seed/backup/test-fixture data (see ADR-011's v1 section for
why it existed and its own v2 supersession note). No production request
path imports it.

## API Contract

```
GET /api/master/provinces
  -> { ok: true, provinces: { provinceId: string; provinceThai: string }[] }

GET /api/master/districts?province_id=<id>
  -> { ok: true, districts: { districtId: string; districtThai: string; provinceId: string }[] }

GET /api/master/subdistricts?district_id=<id>
  -> { ok: true, subdistricts: { tambonId: string; tambonThai: string; districtId: string; postalCodes: string[] }[] }
```

All three require an authenticated session (401 if not); none are
dealer/branch-scoped (reference data, not tenant data). `postalCodes` is
an array of 0 or 1 entries - the DB's `subdistricts.postcode` column
holds a single value; the array shape is kept for caller compatibility
with the pre-v2 API, which supported multiple codes per subdistrict.

## AddressRepository

`src/shared/master-data/address/AddressRepository.ts` - the only class
that queries the `provinces`/`districts`/`subdistricts` tables.

- `listProvinces()` / `listDistricts(provinceId)` / `listSubdistricts(districtId)`:
  async, each cached on the repository instance after first query
  (`MasterDataService` holds one long-lived instance per serverless
  process, so this is "load once, reuse for every caller" in practice).
- `findProvince(name)` / `findDistrict(name, provinceId)` /
  `findSubdistrict(name, districtId)`: name-based lookup via
  `normalizeThaiAddressValue()` (strips `อำเภอ`/`เขต`/`ตำบล`/`แขวง`/
  `จังหวัด`/`กิ่งอำเภอ` prefixes before comparing), used by
  `validateThaiAddress()` and Historical Import.

## AddressSelector

`src/components/shared/scope/AddressSelector.tsx` - the one shared
component for a Thai address field. Cascading Province → District →
Subdistrict → Postal Code (auto-filled), a filter `<input>` above each
`<select>` for "Searchable Dropdown" (never a free-text combobox - that
would allow selecting an invalid value), auto-clears child selections
when a parent changes, backed by the `/api/master/*` routes above (never
bundles address data into client JS). Every module capturing a
Thai address reuses this component - currently NTR's registration form;
PM has no customer address fields today.

## Historical Import

NTR's Legacy Import validates each row's Province/District/Subdistrict/
Postal Code against the canonical tables via
`MasterDataService.validateThaiAddress()` (async, Supabase-backed) -
rejects an internally inconsistent combination (e.g. a real district
under the wrong province) before the row is imported. The imported
`ntr_records` row stores the Thai names as free text, not the resolved
IDs - see ADR-011's v2 Supersession section for why.

## Verification history

- Post-migration DB check: `provinces` 77 / `districts` 928 /
  `subdistricts` 7,436 rows (matching Thailand's real administrative
  counts); `*_raw` tables unchanged at 7,436 rows each; zero new Supabase
  security advisories.
- lint / typecheck / tests / build / architecture-check all pass.
- Live UAT on a Vercel Preview: `/api/master/provinces`,
  `/api/master/districts?province_id=`,
  `/api/master/subdistricts?district_id=` all verified against the real
  canonical tables; NTR create/Historical Import preview exercised
  end-to-end; full regression sweep across Dashboard/NTR/PM/QIR-MQR/
  Machine360/Dealer/Customer/Historical Import.
