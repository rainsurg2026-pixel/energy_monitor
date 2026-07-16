# Domain Ownership Matrix

> **v3.0 Foundation Hardening note (ADR-032):** this matrix predates
> ADR-017/018/027/028/029/030/031 and does not name Inspection, Delivery,
> Knowledge, or Vehicle 360 as their own rows - they exist today as
> concrete sub-domains of "Service"/"Machine" below. See
> `docs/architecture/V3_FOUNDATION_HARDENING_AUDIT.md` §1 for the
> current, feature-module-grain ownership map. A full refresh of this
> matrix to bounded-context-level accuracy is named as follow-up debt
> there, not done in this pass.

## Relationship to existing documents

`docs/architecture/blueprint/02-DOMAIN-MODEL-AND-CONTEXT-MAP.md` (frozen
- the bounded-context list is one of 20's 5 Architecture Freeze items)
already names: Machine, Customer, Dealer, Service, Inspection, Knowledge,
Engineering Intelligence, Analytics.
`docs/architecture/blueprint/17-BUSINESS-CAPABILITY-MAP.md` (frozen, part
of the Baseline) already assigns capabilities to: Machine Management,
Inspection Management, Registration, Maintenance, Warranty, Quality
Management, Parts Management, Knowledge Management, Engineering
Intelligence, Analytics, Identity & Access, Document Management,
Notification, Integration.

**This matrix does not redefine either.** It exists because the task's
requested domain list - Machine, Service, Quality, Engineering
Intelligence, Reports, Administration, Import Platform, Authentication,
Master Data, Timeline, Notifications - only partially overlaps with 02/17's
lists, and six of these eleven have **no entry at all** in 17's capability
map: Administration, Import Platform, Authentication (present only as
frozen infrastructure per `PLATFORM_ARCHITECTURE_STANDARDS.md`, not as a bounded
context), Master Data, Timeline (present only as a shared component in
02, never a domain), Notifications (explicitly named a gap by 17 itself).
Where a domain below already exists in 02/17, this matrix cites them as
the source of truth rather than re-deriving; where it doesn't, this
matrix is the first place it's named.

## Matrix

| Domain | Owner (bounded context / platform layer) | Status | Primary governing doc | Reconciliation note |
|---|---|---|---|---|
| **Machine** | Machine bounded context (`features/machine`) | Frozen (aggregate root, per 20's Freeze) | 02, `docs/engineering/MACHINE_DOMAIN.md`, ADR-009-Machine-Domain | Authoritative in 02/17 already |
| **Service** | Service bounded context (subsumes Registration/NTR, Maintenance/PM, Warranty, Parts per 02) | Frozen (bounded context list) | 02 §Core Domains, 05-SERVICE-AND-QUALITY-DOMAINS.md | Authoritative in 02 already; this framework's `DATA_OWNERSHIP_MATRIX.md` fills Warranty's entity-level gap 02 leaves open |
| **Quality** | Quality bounded context (MQR + PIP per 17's "Quality Management") | Frozen (bounded context + capability) | 02, 17, 05-SERVICE-AND-QUALITY-DOMAINS.md | Authoritative already; PIP's exact domain home is refined by ADR-023's pre-merge addendum (proposed) - Engineering Intelligence produces PIP, Quality references it, per that addendum |
| **Engineering Intelligence** | Engineering Intelligence bounded context | Frozen (bounded context + AI Governance boundary) | 02, 08-ENGINEERING-INTELLIGENCE-ARCHITECTURE.md | Authoritative already; see `AI_GOVERNANCE.md` |
| **Reports** | Cross-cutting capability, not a bounded context (≈ 17's "Analytics" capability, named "Reports" in the MSEAL Design Framework's navigation, proposed) | Design-only / cross-cutting | 09-ANALYTICS-ARCHITECTURE.md, `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` §2b (proposed) | **Naming drift, not an ownership drift**: 17 calls this capability "Analytics"; the proposed MSEAL Design Framework's navigation calls the same nav group "Reports." Both describe the same cross-cutting, no-data-of-its-own capability. Recommend reconciling the label once ADR-023 merges - not done here (a naming choice, not a governance decision this framework makes unilaterally) |
| **Administration** | Cross-cutting capability (≈ 17's "Identity & Access" for the RBAC/user-management slice, plus every admin master-data screen) | **Gap in 17** - no dedicated capability-map row | `docs/ADMIN_FRAMEWORK.md` (design-only) | **New assignment**: Administration owns User Management, Master Data CRUD screens, System Health - cross-cutting like Reports, not a domain with its own aggregate. Import History retired (ADR-038, 2026-07-16) |
| **Import Platform** | Platform service (`src/shared/import/`, ADR-024-Universal-Import-Framework / ADR-022 Import Platform v2, proposed) | **Gap in 17** - not present at all | ADR-024 (Universal Import Framework, renumbered from ADR-009 - see `docs/adr/README.md`), ADR-022 (proposed), `docs/architecture/IMPORT_PLATFORM.md` (proposed) | **New assignment**: Import Platform is a platform service a business module can adopt - it has no aggregate root, it moves data *into* other domains' aggregates. NTR's adoption (Historical NTR Import) is retired (ADR-038, 2026-07-16, Product Owner decision); the framework itself has no current adopter |
| **Authentication** | Frozen platform layer (`PLATFORM_ARCHITECTURE_STANDARDS.md`'s Foundation Freeze), not a bounded context | Frozen (infrastructure, per Foundation Freeze) | ADR-014 (Authentication Platform v3), `docs/architecture/AUTHENTICATION_PLATFORM.md` | 17 lists "Identity & Access" as a capability, correctly, but never as a bounded context - this matrix confirms that distinction explicitly: Authentication is infrastructure every domain depends on, not a domain other domains depend on |
| **Master Data** | Frozen platform layer (`MasterDataService`, `PLATFORM_ARCHITECTURE_STANDARDS.md`) | Frozen (infrastructure) | `docs/architecture/MASTER_DATA_PLATFORM.md`, `docs/MASTER_DATA.md`, ADR-011 (Address Platform), ADR-012 (Tractor-IN Master Data) | **Gap in 17** - not present as a capability-map row; same reasoning as Authentication - it's a dependency of every domain, not a domain itself |
| **Timeline** | Platform standard component (`shared/activity-timeline/`), not a bounded context | Active, shared component | `docs/architecture/ACTIVITY_TIMELINE.md` | 02 mentions Machine Timeline as a Machine sub-concept (Registry/Timeline/Inspection/Ownership/Documents/Configuration/Attachments); `shared/activity-timeline/` is the reusable *rendering* platform every domain's own timeline is built from - two related but distinct things, both real. This matrix names the platform-component sense, since that's the "Timeline" the task's domain list actually means (it sits alongside Notifications, Import Platform, Master Data - infra-ish concerns, not Machine's own sub-concept) |
| **Notifications** | **Explicit gap** - `NotificationBell` is a static placeholder with no backing service (verified, ADR-023 proposed) | **Gap** - no owner assigned anywhere yet | 17 (names the gap explicitly: "not yet its own Business Module") | **Confirmed, not resolved**: no domain owns Notifications today. Recommend Platform Services (`shared/`) as the eventual owner (matches ADR-004's original "auth/upload/pdf/scheduler/notification/audit/logging/monitoring/cache/search" platform-service list) once built - not built or assigned to a code location by this framework |

## Ownership rules (derived from the above, cross-cutting)

1. **A domain with a bounded context (Machine/Service/Quality/Engineering
   Intelligence) owns its own aggregate root and repository boundary**
   per 02's Repository Boundaries rule - no other domain reaches into it.
2. **A cross-cutting capability (Reports/Administration) owns no data of
   its own** - it reads from domains, never becomes a second source of
   truth (same rule 09-ANALYTICS-ARCHITECTURE.md already states for
   Analytics, generalized here to Administration).
3. **A frozen platform layer (Authentication/Master Data) is a dependency
   every domain calls through its public interface** (`PLATFORM_
   CONSTITUTION.md`'s Platform service boundaries section) - never
   reimplemented per-domain.
4. **An explicit gap (Notifications) has no code today** - do not assume
   ownership by writing to a table or building a bell-icon backend
   without first raising the assignment here, in `DECISION_MATRIX.md`,
   and (if it touches a frozen item) through 20's ADR Process.

## Gap Analysis

- Reports/Analytics naming drift (table above) - a five-minute
  reconciliation once ADR-023 merges, not urgent.
- Administration, Import Platform, Master Data, Timeline, Notifications
  have no entry in the frozen `17-BUSINESS-CAPABILITY-MAP.md` - this
  matrix fills the gap at the governance-documentation layer, but 17
  itself is unchanged (updating a frozen Baseline document requires 20's
  Breaking Change Process, out of scope for this pass).
- Notifications remains genuinely unowned in code - the recommendation
  above (Platform Services) is not an approval to build it.
