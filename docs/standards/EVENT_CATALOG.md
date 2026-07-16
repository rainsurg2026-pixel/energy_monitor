# Event Catalog

Canonical list of every Vehicle Life Cycle timeline event code MASP
recognizes. Backed by the `event_definitions` table (Supabase) — this
document is the human-readable index of that table, not a separate source
of truth; if they ever disagree, the database is authoritative (per
`docs/standards/MODULE_DEVELOPMENT_STANDARD.md`'s source-of-truth
priority) and this file should be corrected to match.

## Relationship to the Canonical Event Catalog (blueprint 18)

**Consolidated by ADR-025 (`docs/adr/ADR-025-Canonical-Event-Catalog-Consolidation.md`)
— read that ADR and `docs/governance/EVENT_OWNERSHIP.md` for the full
reasoning; this section states only the resulting rule.**

This file and `docs/architecture/blueprint/18-CANONICAL-EVENT-CATALOG.md`
govern two different layers of the *same* underlying facts, not two
competing catalogs:

- **18 is authoritative for event *name* and *ownership*** (frozen, one of
  `20-ARCHITECTURE-GOVERNANCE.md`'s 5 Architecture Freeze items) — the
  `PlatformEventType` PascalCase name (e.g. `MQROpened`) and which single
  module may produce it.
- **This file is authoritative for the literal, DB-level `event_code`**
  (UPPER_SNAKE_CASE, e.g. `MQR_OPENED`) that the same fact is stored and
  queried as, plus the Thai/English display label and Timeline display
  order — none of which 18 defines, since 18 is architecture-level, not
  implementation-level.

Where both catalogs describe the same real-world fact, the mapping is:

| 18's `PlatformEventType` | This file's `event_code` | Relationship |
|---|---|---|
| `DealerReceived` | `DEALER_RECEIVED` | Same fact, two naming conventions (architecture name vs. DB code) |
| `PMCompleted` | `MAINTENANCE_COMPLETED` | Same fact |
| `MQROpened` | `MQR_OPENED` | Same fact |
| `MQRClosed` | `MQR_CLOSED` | Same fact |
| `MachineDelivered` | `NTR_COMPLETED` | Same fact (NTR is today's one Registration implementation - "New Tractor Registration completing" *is* "Machine Delivered" per `docs/standards/DOMAIN_LANGUAGE_STANDARD.md`'s Acceptance Date section) |
| `MachineImported` | `FACTORY_BUILD` | Related but not identical - `MachineImported` is the Tractor-IN sync import event; `FACTORY_BUILD` is reserved for a literal factory-build feed that doesn't exist yet. Do not treat these as the same fact without re-checking 18 when a real producer is built |
| `PdiCompleted` | `PDI_COMPLETED` | **Now wired** (business-domain correction, ADR-028) - reused uniformly for every Import Inspection completion, both the initial PDI and every subsequent RE-PDI (distinguished by the event's own reference number/date/metadata, not a second event code). 18's `ImportPDICompleted`/`DealerPDICompleted` two-stage split does not apply - the corrected model has no Dealer PDI concept, so one event code covers every Import Inspection completion |
| `ReleasedToDealer` (no 18 equivalent) | `RELEASED_TO_DEALER` | New (ADR-028) - the MSEAL decision ending the Import Inspection stage for one machine. Published by `InspectionService.releaseToDealer()` |
| `WarrantyActivated` | `WARRANTY_ACTIVATED` | **Now wired** (ADR-028) - published by `DeliveryService.activateWarrantyFromNtr()`, the sole legitimate trigger (NTR, never manual) |

Events with **no equivalent in 18** (this file only - operational/
non-Machine-Lifecycle events, or reserved for modules 18 doesn't name at
all): `NTR_CREATED`, `CAMPAIGN_ASSIGNED`, `CAMPAIGN_COMPLETED`,
`PART_REQUESTED`, `PART_DELIVERED`, `INSPECTION` (generic),
`SOFTWARE_UPDATE`, `RECALL`, `TELEMATICS_ALERT`, `RELEASED_TO_DEALER`,
`OTHER`. These remain governed by this file alone.

Events with **no equivalent here** (18 only - not yet wired to
`event_definitions`/`VehicleEventPublisher`): `PIPCreated`,
`PIPCompleted`, `OwnershipTransferred`, `Retired`. When any of these gets
a real producer, add its `event_code` here following this file's
existing naming convention, and add the mapping row above - **check this
table before picking a new event name so a fifth independent naming
scheme doesn't appear.**

**Every module publishes to the timeline through `VehicleEventPublisher`
(`src/features/vehicle-event/publisher.ts`) only — never by inserting into
`vehicle_events` directly.** A new event code is added by (1) inserting a
row into `event_definitions` via a migration, (2) adding the code to
`EVENT_CODES` in `src/features/vehicle-event/types.ts`, and (3) adding a
`publish<EventName>()` convenience method to `VehicleEventPublisher` (or
using its generic `publish()` escape hatch). The generic timeline adapter
(`src/features/vehicle/eventSources/platformEvents.ts`) then renders it
automatically — no per-module timeline code is required unless the
generic mapping can't express something module-specific.

## Event codes

| `event_code` | Module | Thai | English | Display order |
|---|---|---|---|---|
| `FACTORY_BUILD` | `factory` | ผลิตจากโรงงาน | Factory Build | 10 |
| `DEALER_RECEIVED` | `dealer_receive` | ดีลเลอร์รับรถ | Dealer Received | 20 |
| `PDI_COMPLETED` | `pdi` | ตรวจสภาพก่อนส่งมอบ (PDI) | PDI Completed | 30 |
| `RELEASED_TO_DEALER` | `pdi` | ปล่อยรถให้ดีลเลอร์ | Released to Dealer | 32 |
| `NTR_CREATED` | `ntr` | เริ่มจดทะเบียนรถใหม่ (NTR) | NTR Created | 35 |
| `NTR_COMPLETED` | `ntr` | จดทะเบียนรถใหม่ (NTR) | NTR Completed | 40 |
| `WARRANTY_ACTIVATED` | `delivery` | เริ่มการรับประกัน | Warranty Activated | 45 |
| `MAINTENANCE_COMPLETED` | `maintenance` | บำรุงรักษาเชิงป้องกัน | Maintenance Completed | 50 |
| `MQR_OPENED` | `mqr` | เปิดรายงานปัญหาคุณภาพ | MQR Opened | 60 |
| `MQR_CLOSED` | `mqr` | ปิดรายงานปัญหาคุณภาพ | MQR Closed | 70 |
| `CAMPAIGN_ASSIGNED` | `campaign` | มอบหมายแคมเปญ | Campaign Assigned | 80 |
| `CAMPAIGN_COMPLETED` | `campaign` | ดำเนินการแคมเปญเสร็จสิ้น | Campaign Completed | 90 |
| `PART_REQUESTED` | `parts_request` | ขออะไหล่ | Parts Requested | 100 |
| `PART_DELIVERED` | `parts_request` | จัดส่งอะไหล่แล้ว | Parts Delivered | 110 |
| `INSPECTION` | `inspection` | ตรวจสภาพรถ | Inspection | 120 |
| `SOFTWARE_UPDATE` | `software_update` | อัปเดตซอฟต์แวร์ | Software Update | 130 |
| `RECALL` | `recall` | เรียกคืนตรวจสอบ | Recall | 140 |
| `TELEMATICS_ALERT` | `telematics` | แจ้งเตือนระบบเทเลเมติกส์ | Telematics Alert | 150 |
| `OTHER` | `other` | อื่นๆ | Other | 999 |

## Which modules actually publish today

- **MQR** and **Maintenance (PM)**: `event_definitions` rows and
  `VehicleEventPublisher` methods exist for these
  (`MQR_OPENED`/`MQR_CLOSED`/`MAINTENANCE_COMPLETED`), but as of this
  writing MQR's and PM's own record-lifecycle code does not call the
  publisher — their Vehicle 360 timeline rows still come from the older,
  module-specific direct-read adapters (`eventSources/mqrEvents.ts`,
  `eventSources/maintenanceEvents.ts`), which read `records`/`pm_records`
  directly. This is pre-existing, not something NTR changed.
- **NTR** is the first module actually wired end-to-end: `NtrService.create()`
  calls `publishNtrCreated()` and `publishNtrCompleted()` on every
  registration, and the new generic adapter
  (`eventSources/platformEvents.ts`) reads them back from `vehicle_events`
  for display on Vehicle 360.
- **Import Inspection (ADR-017/ADR-028)** and **Delivery (ADR-027)** are
  wired as of the business-domain correction:
  `InspectionService.completeInspection()` calls `publishPdiCompleted()`,
  `.releaseToDealer()` calls `publishReleasedToDealer()`, and
  `DeliveryService.activateWarrantyFromNtr()` calls
  `publishWarrantyActivated()`.
- **FACTORY_BUILD, DEALER_RECEIVED, CAMPAIGN\*, PART\*, INSPECTION,
  SOFTWARE_UPDATE, RECALL, TELEMATICS_ALERT**: catalog entries reserved
  for modules that don't exist yet (Campaign, Parts Request, and future
  telematics/software-update integrations). No code publishes these
  today; they exist so the catalog and the Platform Event Framework
  don't need a schema change when those modules are built.

## Verification

Documentation only. Reflects `event_definitions` as of the NTR module's
implementation; re-verify against the live table (`list_tables`/
`execute_sql` via Supabase) before trusting a code/order value for a new
module, since this file can drift from the database over time.
