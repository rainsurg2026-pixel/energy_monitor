# Mahindra After Sales Platform (MASP)
# Domain Language & Localization Standard
# Release 1.0

## Objective

This document is the official business language standard for the Mahindra
After Sales Platform (MASP).

**All future modules must follow this standard.**

This document is the single source of truth for:

- Business terminology
- Localization
- Menu naming
- Icons
- PDF terminology
- CSV terminology
- Status names
- Business vocabulary

This document is separate from `docs/engineering/NAMING_CONVENTION.md`, which
governs source code naming only.

## Business Domain

MASP is an Agricultural After-Sales Platform.

> **Superseded by ADR-009 (Phase 5B, Machine Domain):** the platform
> business entity is now **Machine**, not Vehicle and not Tractor. This
> replaces this section's original "Tractor, NOT Vehicle" rule. See
> `docs/engineering/MACHINE_DOMAIN.md` for the full rationale and the
> Product Hierarchy this introduces (`Machine → Product Category →
> Product Family → Model → Variant → Serial Number`) - "Tractor" survives
> only one level down, as today's one Product Category (with Harvester,
> Power Tiller, Implement, Engine planned as future categories).

User-facing UI for the Machine 360 / Machine Registry / Machine Timeline /
Machine Search / Machine Health aggregation layer uses "Machine". Product
Category terminology ("Tractor Model", "Tractor Master") is unaffected -
see the updated Official Business Terminology table below.

Database tables may retain existing names (`vehicles`, `vehicle_id`, etc.)
for backward compatibility - the Machine rename is business terminology
only (repository/service/UI/docs), never a table rename (ADR-009).

## Dealer Standard

MASP currently supports Thailand only. Do not introduce Country or Region
abstractions.

The organizational hierarchy is:

```
MSEAL (Central)
  ↓
Dealer
  ↓
Branch
```

Use **Dealer Code** as the primary business identifier.

Current supported Dealer Codes:

| Code |
|---|
| MSEAL |
| KTV |
| CRR |
| KKE |
| PNT |
| TNR |
| SAM |

> **Status note (as implemented):** as of this standard's adoption, only
> `MSEAL`, `KTV`, and `CRR` exist as rows in the `dealers` table. `KKE`,
> `PNT`, `TNR`, `SAM` are not yet onboarded — add them through the existing
> Admin → Dealers master-data screen when ready; nothing here seeds them
> automatically.

Future dealer codes can be added through Master Data.

Report numbers should follow:

```
<Module>-<DealerCode>-<Year>-<Running>
```

Example:

- `PM-KTV-2026-000001`
- `MQR-KTV-2026-000001`
- `PDI-KTV-2026-000001`
- `NTR-KTV-2026-000001`

> **Status note (as implemented):** `pm_number` generation already matched
> this format before this standard was written. `job_id` (MQR) previously
> used a different, deliberately-global scheme (`QIR-YYMM-####`, no dealer
> code) — this was a real conflict with the standard, flagged and then
> migrated to `MQR-{DealerCode}-{Year}-{Running}` (see `nextJobId()` in
> `src/lib/db.ts`) as part of adopting this standard. Already-issued
> `QIR-YYMM-####` job IDs are untouched; only newly-created MQR records get
> the new format. PDI/NTR don't exist as modules yet — their formats are
> documented here for whoever builds them.

Do not implement Country-level abstractions at this stage.

All authorization, filtering, ownership, and reporting should be based on
Dealer Code.

## Official Menu Standard

**Superseded by the Navigation Standard (ADR-023,
`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`) and, for UI wording
specifically, by `docs/standards/TERMINOLOGY_STANDARD.md`.** The flat table below is
kept for historical reference (icon/terminology provenance) but the
platform's actual navigation is now the nested Group -> Item taxonomy in
`src/app/(app)/navConfig.ts`'s `getNavGroups()`. Two real, named
differences versus the table below: (1) navigation is now grouped
(Dashboard/Machines/Service/Quality/Engineering Intelligence/Reports/
Administration) rather than flat; (2) PDI and Parts Request have no entry
in the new navigation (no Coming Soon placeholder either) - both remain
recognized future modules elsewhere (Architecture Blueprint's Business
Capability Map), this is a navigation-only gap, flagged as open in
`MSEAL_DESIGN_FRAMEWORK.md`'s Gap Analysis rather than silently resolved.
Every icon/terminology choice below that *is* still in use keeps its
exact icon and business term - this document remains the terminology
source of truth for anything the Navigation Standard doesn't override.

| Icon | Thai | English |
|---|---|---|
| 🏠 | แดชบอร์ด | Dashboard |
| 🚜 | ทะเบียนเครื่องจักร | Machine Registry |
| 📦 | ตรวจสภาพก่อนส่งมอบ (PDI) | Pre-Delivery Inspection |
| 📝 | ลงทะเบียนส่งมอบรถใหม่ (NTR) | New Tractor Registration |
| 🔧 | งานเช็คระยะ | Preventive Maintenance |
| ⚠️ | รายงานปัญหาคุณภาพ | Market Quality Report |
| 📜 | Machine 360 | Machine 360 |
| 📢 | แคมเปญบริการ | Service Campaign |
| 🛡️ | การรับประกัน | Warranty |
| 📦 | ขอเบิกอะไหล่ | Parts Request |
| 📈 | รายงาน | Reports |
| ⚙️ | ข้อมูลหลัก | Master Data |
| 👥 | ผู้ใช้งาน | Users |
| 🔧 | ตั้งค่าระบบ | System Settings |

## Official Business Terminology

| English | Thai |
|---|---|
| Machine (platform entity, ADR-009) | เครื่องจักร |
| Tractor (today's one Product Category) | รถแทรกเตอร์ |
| Machine Registry | ทะเบียนเครื่องจักร |
| Machine 360 | Machine 360 |
| Machine Timeline | Machine Timeline |
| Machine Health | Machine Health |
| Product Category | หมวดหมู่ผลิตภัณฑ์ |
| Product Family | กลุ่มผลิตภัณฑ์ |
| Model | รุ่นรถ |
| Serial Number | หมายเลขตัวรถ |
| Engine Number | หมายเลขเครื่องยนต์ |
| Retail Date | วันที่ส่งมอบ |
| Dealer | ผู้แทนจำหน่าย |
| Branch | สาขา |
| Technician | ช่างบริการ |
| Customer | ลูกค้า |
| Owner | เจ้าของรถ |

### Maintenance

| English | Thai |
|---|---|
| Maintenance | การบำรุงรักษา |
| Preventive Maintenance | งานเช็คระยะ |
| Maintenance Program | โปรแกรมการบำรุงรักษา |
| Maintenance Stage | ระยะการเช็คระยะ |
| Maintenance Due | กำหนดเช็คระยะ |
| Current Stage | ระยะปัจจุบัน |
| Next Maintenance | เช็คระยะครั้งถัดไป |
| Remaining Hours | ชั่วโมงคงเหลือ |
| Remaining Days | วันคงเหลือ |
| Maintenance Compliance | ความครบถ้วนของการบำรุงรักษา |
| Health Score | คะแนนสุขภาพรถ |
| Health Status | สถานะสุขภาพรถ |

### Quality

| English | Thai |
|---|---|
| Market Quality Report | รายงานปัญหาคุณภาพ |
| Root Cause | สาเหตุที่แท้จริง |
| Corrective Action | แนวทางแก้ไข |
| Preventive Action | แนวทางป้องกัน |
| Severity | ระดับความรุนแรง |
| Problem Code | รหัสปัญหา |
| Symptom | อาการ |

### Warranty

| English | Thai |
|---|---|
| Warranty | การรับประกัน |
| Claim | เคลม |
| Claim Status | สถานะการเคลม |

### Delivery

| English | Thai |
|---|---|
| PDI | ตรวจสภาพก่อนส่งมอบ |
| NTR | ลงทะเบียนส่งมอบรถใหม่ |

### Service Campaign

| English | Thai |
|---|---|
| Campaign | แคมเปญบริการ |
| Recall | เรียกคืนสินค้า |
| Service Bulletin | ประกาศบริการ |

### Parts

| English | Thai |
|---|---|
| Parts Request | ขอเบิกอะไหล่ |
| Part Number | หมายเลขอะไหล่ |
| Parts Availability | สถานะอะไหล่ |

### General

| English | Thai |
|---|---|
| History | ประวัติ |
| Timeline | ไทม์ไลน์ |
| Audit Trail | ประวัติการเปลี่ยนแปลง |
| Attachment | ไฟล์แนบ |
| GPS | พิกัด GPS |
| Photo | รูปภาพ |
| Document | เอกสาร |

### Retail Date vs. Acceptance Date (do not confuse these two)

**"Retail Date" (วันที่ส่งมอบ) is the canonical business term for when a
tractor was sold/delivered to its owner** — used everywhere across
MQR/PM/NTR/Vehicle 360 (`vehicles.delivery_date`, `pm_records`'
equivalent, `VehicleSummary.retailDate`). **Never label a user-facing
field "Delivery Date"** — that phrase is retired in favor of "Retail
Date" precisely because "delivery" is ambiguous between the sale event
and the physical handover event.

NTR is the one module with a genuinely separate second date: its
`ntr_records.delivery_date` column records the specific date the
dealer's representative physically handed the tractor to the customer
and the customer signed for it — a real business event distinct from
"Retail Date," not a duplicate of it. This is labeled **"Acceptance
Date"** in every NTR screen/PDF (never "Delivery Date," to avoid exactly
the ambiguity this section warns about). A future module with the same
"sale date vs. physical handover date" distinction should follow the
same pattern: "Retail Date" for the sale, "Acceptance Date" for the
handover — not a second "Delivery Date."

### Standardized Attachment Types

Every module's attachment/photo categories use this fixed set of type
keys and labels — introduced by NTR
(`src/features/ntr/types/index.ts`'s `NTR_ATTACHMENT_TYPES`), reused
verbatim by future modules (PM, Warranty, Campaign) rather than each
inventing its own category names:

| Key | Thai | English |
|---|---|---|
| `CUSTOMER_ID` | บัตรประชาชนลูกค้า | Customer ID |
| `CUSTOMER_TRACTOR` | ลูกค้าคู่กับรถแทรกเตอร์ | Customer + Tractor |
| `SERIAL_PLATE` | แผ่นป้ายหมายเลขตัวรถ | Serial Plate |
| `ENGINE_PLATE` | แผ่นป้ายเครื่องยนต์ | Engine Plate |
| `HOUR_METER` | มิเตอร์ชั่วโมง | Hour Meter |
| `DELIVERY_SHEET` | ใบส่งมอบรถ | Delivery Sheet |
| `TAX_INVOICE` | ใบกำกับภาษี | Tax Invoice |
| `CRM_LEAD` | CRM Lead | CRM Lead |
| `OTHER` | อื่นๆ | Other |

A module with a dedicated required-photo column (like NTR's
`photo_customer_tractor_url`, `photo_serial_plate_url`,
`photo_hour_meter_url`, `photo_signed_document_url`) maps that column to
the matching type key for display purposes; a module without one stores
the attachment via the existing `{url, label}[]` array pattern
(`additional_photos`) using one of these type keys as the label — no new
dedicated database column is needed just to add a new standardized
attachment category.

## Localization Standard

Thai is the default language. English remains fully supported.

All user-facing strings must come from `src/locales/`.

Never hardcode UI text.

Google Translate is NOT part of the production UI.

## Date Standard

- Thai: `01 กรกฎาคม 2569`
- English: `01 Jul 2026`

## Phone Format

`XXX-XXXXXXX`

## Report Number

`<Module>-<DealerCode>-<Year>-<Running>` — see the Dealer Standard section
above for the current examples and implementation status.

## Status Colors

| Status | Color |
|---|---|
| Open | Blue |
| Under Investigation | Orange |
| Waiting Parts | Amber |
| Waiting Customer | Purple |
| Repaired | Green |
| Closed | Gray |
| Rejected | Red |

## Icon Standard

See the Official Menu Standard table above — the icon column is
authoritative for every top-level menu entry.

## Engineering Rules

- No hardcoded business terminology.
- No hardcoded translations.
- No duplicate terminology.
- Every future module must reference this document.

## Verification

Before merging any feature:

- [ ] Business terminology matches this document
- [ ] Menu names match this document
- [ ] PDF matches this document
- [ ] CSV matches this document
- [ ] Localization keys exist
- [ ] Icons follow the standard

---

From the commit that introduced this file forward, `DOMAIN_LANGUAGE_STANDARD.md`
is the project's canonical business-language reference. Any new feature,
module, page, PDF, CSV, report, or API documentation must comply with this
standard by default. If a future implementation conflicts with this
standard, stop and report the conflict instead of introducing new
terminology.
