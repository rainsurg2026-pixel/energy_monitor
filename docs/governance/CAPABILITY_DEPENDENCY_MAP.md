# Capability Dependency Map

> **v3.0 Foundation Hardening note (ADR-032):** this map predates
> ADR-017/018/027/028/029/030/031 and does not show Inspection/Delivery/
> Knowledge/Vehicle 360 as their own nodes. See
> `docs/architecture/V3_FOUNDATION_HARDENING_AUDIT.md` §5 for the
> current, feature-module-grain dependency diagram (Vehicle → Import
> Inspection → NTR → Warranty → PM → MQR → Timeline → Documents, plus
> Machine Passport as the one aggregation reading all of them). No
> circular dependency or boundary violation was found in that audit.

## Relationship to existing documents

`docs/governance/CAPABILITY_MAP.md` shows each domain's own capability
tree (what it contains). `docs/governance/DOMAIN_OWNERSHIP_MATRIX.md`
shows who owns each domain. **Neither shows which domain depends on
which other** - this document adds that missing axis. No prior document
in this repository maps cross-domain dependency explicitly as its own
artifact (02's Context Map comes closest, with Conformist/Published
Language/Open Host Service/Customer-Supplier relationships between
bounded contexts - cited below, not restated, since 02 is frozen and this
document must not contradict it).

## Dependency Table

| Capability / Domain | Depends on (reads from) | Depended on by (read by) |
|---|---|---|
| **Authentication** (frozen) | Nothing (foundation layer) | Every domain - every request passes through `getSession()` first |
| **Master Data** (frozen) | Authentication (admin write access only) | Every domain - Dealer/Branch/Technician/Product Family are referenced by FK everywhere |
| **Machine** | Master Data (dealer/branch assignment), Import Platform (writes `product_family_id`/`sub_model` only) | Service, Quality, Engineering Intelligence (via Knowledge), Timeline, Reports, every domain that references a machine by FK |
| **Import Platform** | Master Data (dealer/branch resolution during import) | Machine (writes), any future adopting module (NTR today) |
| **Service** (Registration/NTR, Maintenance/PM, Warranty, Parts) | Machine (FK), Master Data, Authentication | Quality (a service visit can surface a quality issue), Knowledge (a service outcome is a candidate observation), Reports |
| **Quality** | Machine (FK), Master Data, Authentication | Knowledge (Quality Cases are candidate observations, blueprint 01 Principle 3), Reports, Timeline |
| **Knowledge** | Quality (closed cases), Service (PM outcomes), Machine Lifecycle events (18) | Engineering Intelligence (the *only* legitimate reader, 08's "no independent data of its own" rule), Analytics (via Engineering Intelligence, 09's one exception) |
| **Engineering Intelligence** | Knowledge (only - never raw operational tables, 08) | PIP (recommendation input), Analytics (Predictive Quality Analytics, 09's exception) |
| **PIP** | Engineering Intelligence (recommendation), Knowledge (evidence), Quality (originating cases) | Service > Campaigns (reference, tracks but does not own), Recall (escalation source) |
| **Recall** | PIP (usual origin), Machine (target population) | Reports |
| **Reports** (cross-cutting) | Every domain above - owns none of its own data | Nothing (terminal consumer) |
| **Administration** (cross-cutting) | Master Data, Authentication | Every domain, indirectly (admin screens manage the master data every domain reads) |
| **Timeline** (shared component) | Event Catalog (18) / `record_audit_log` | Every domain's own record-detail UI |
| **Notifications** (gap, unowned) | Would depend on: Event Catalog / every domain that triggers a notification-worthy event | Nothing built yet - see `DOMAIN_OWNERSHIP_MATRIX.md` |

## Dependency Diagram

```
Authentication (frozen)
   │  every request
   ▼
Master Data (frozen) ───────────────────────────┐
   │  dealer/branch/product-family FK             │
   ▼                                              ▼
Machine ◀── Import Platform              Administration (cross-cutting)
   │
   ├──────────────┬─────────────────┐
   ▼              ▼                 ▼
Service        Quality          (future domains referencing Machine)
   │              │
   └──────┬───────┘
          ▼
      Knowledge
          │  (only reader)
          ▼
Engineering Intelligence
          │
          ▼
        PIP ──────────▶ Recall
          │
          ▼
  Service > Campaigns (reference only)

                    ┌─── Reports (cross-cutting, reads everything above, owns nothing)
Every domain above ─┤
                    └─── Timeline (shared component, reads Event Catalog)
```

## Rules derived from this map

1. **No arrow ever points backward through Engineering Intelligence** -
   it reads Knowledge, never Quality/Service/Machine directly (08,
   frozen). If a future feature needs Engineering Intelligence to read
   an operational table directly "just this once," that is a Freeze
   violation, not a design choice - it goes through 20's Breaking Change
   Process, and the honest answer is very likely "no."
2. **Reports/Analytics is always a leaf** - nothing depends on it. If a
   future feature makes another domain depend on a Report's output for
   its own operational logic, that domain has accidentally made Reports
   a second source of truth, contradicting `DOMAIN_OWNERSHIP_MATRIX.md`'s
   ownership rule #2 ("a cross-cutting capability owns no data of its
   own").
3. **Import Platform never depends on the domain it writes into** - it
   resolves against Master Data only, then writes into Machine (or a
   future adopting domain) - it must not read Machine's own business
   logic to decide how to import, or the dependency direction inverts.
4. **A new domain's first design question is "where does it sit in this
   map"** - matching blueprint 01's own Engineering Principles
   ("What Machine is involved? What Event is created?") applied at the
   dependency-direction level specifically.

## Gap Analysis

- Notifications has no real dependency edges because it has no code -
  the "would depend on" row is forward-looking guidance, not a built
  fact.
- This map is derived from the existing frozen bounded-context/ownership
  content (02, 08, 09, 18) plus this framework's own new domain
  assignments (`DOMAIN_OWNERSHIP_MATRIX.md`) - it does not introduce any
  dependency not already implied by those documents; it makes the
  implied graph explicit for the first time.
