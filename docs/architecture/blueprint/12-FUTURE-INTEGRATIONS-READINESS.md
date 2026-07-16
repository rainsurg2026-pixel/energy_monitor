# 12 — Future Integrations Readiness

Goal: prepare for the integrations below **without redesigning the
platform** — meaning each one should be able to plug into the Event
Model (06) / Domain Model (02) as an additional producer or consumer,
not require a new architectural layer of its own.

| Integration | How it plugs in without a redesign |
|---|---|
| IoT / Telematics | A new event producer: telematics data becomes `PlatformEvent`s (e.g. `MACHINE_HEALTH_ALERT`) with `machine_id` set, same envelope as every other domain (06). No special-casing needed at the Timeline/Knowledge/Analytics layer — they already only understand the generic event shape. |
| CAN Bus / Diagnostic Trouble Codes | Same as Telematics — a DTC is a symptom-bearing event; it becomes Knowledge Domain input (07) exactly like an MQR-reported symptom does, just from a machine-originated source instead of a human-reported one. |
| Machine Health Monitoring | A consumer *and* producer: reads Machine Profile (10) data, and itself produces health-alert events back into the Event Model. |
| Dealer Portal | A new UI surface reading the same services (`MachineService`, `KnowledgeService` read paths) — not a new backend. Authorization reuses `DealerBranchScope` (frozen platform layer) unchanged. |
| Customer Portal | Same shape as Dealer Portal, narrower scope (a customer's own machines only) — an additional `SessionUser`-equivalent role/scope, not a new data model. |
| Technician Mobile | A client of the same API routes (11) — mobile-vs-web is a client concern, not a backend architecture concern, as long as routes stay thin and service-backed. |
| Parts EPC | A new Service sub-domain (05) — Parts already has a placeholder table; EPC integration is a future data source feeding `parts_used` on Knowledge Cases (07) and Required Parts Recommendation (08). |
| Warranty Claims | Extends the Service Domain (05) once Warranty is a first-class module — emits `WARRANTY_CLAIM_*` events into the same Event Model. |
| ERP | An external system this platform likely *exports* events/records to (e.g. warranty cost data for Analytics, 09) — an integration boundary at the Event Model or a dedicated export job, not a two-way architectural coupling. |
| Power BI | A consumer of Analytics (09) — either reads Analytics' own computed views directly (Postgres) or a scheduled export, never a direct read of operational tables. |
| Data Warehouse | A downstream consumer of the Event Model + Knowledge tables, once real volume justifies it (09, 14) — explicitly not designed in this PR. |

## Why this list doesn't require new architecture today

Every integration above is either:

1. **A new event producer** — already supported by the Event Model's
   additive-only design (06, 11 Rule 3), or
2. **A new consumer of an existing service's read API** — already
   supported by every domain's "service owns the reads" convention (02),
   or
3. **A new client of existing thin API routes** — already supported by
   11's Rule 2 (thin controllers).

None of them require inventing a fourth integration pattern. This is the
concrete test of whether "prepare for X without redesigning the
platform" was actually achieved by Sections 02–11, rather than a
separate promise made without backing.

## Explicitly not designed here

- Specific protocols/SDKs for any integration above (MQTT for IoT, a
  specific Telematics vendor's API shape, Power BI's exact connector
  type) — implementation detail for whichever phase actually builds
  each one.
- Data residency/security requirements a specific integration might
  impose (e.g. a Dealer Portal's public internet exposure) — a real
  security-review question for that phase, not answered by this
  blueprint.
