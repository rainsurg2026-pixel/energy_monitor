# Terminology Standard

Canonical UI wording for MSEAL DMS. Written as part of the **UI
Terminology & Navigation Cleanup** pass - a terminology/wording/navigation
change only, no architecture, no redesign, no new features. Where this
document and a screen disagree, this document wins; fix the screen, not
the wording, unless the drift reveals this document itself is wrong (then
say so and update both, don't silently pick one).

Scope: **user-facing UI text only** (labels, nav items, page titles,
button/action text, empty-state copy). Code identifiers, routes, API
endpoints, database tables/columns, and TypeScript types are **never**
renamed to match this document - see `docs/standards/DOMAIN_LANGUAGE_STANDARD.md`
and `docs/adr/ADR-026-Machine-Digital-Passport.md` for why UI wording and
code naming are deliberately allowed to diverge (e.g. the route stays
`/records`, the database table stays `records`/`record_audit_log`, the
type stays `MqrRecord` - only the *label a user sees* changed).

## Terminology Governance

Business terminology is part of the platform architecture. Official
business terms must remain consistent across the entire platform to avoid
user confusion, documentation drift, and inconsistent UI language. This
section governs the subset of terms below that are frozen; everything
else in this document (the wording tables, forbidden wording, domain
ownership, translation rules) continues to apply as before and is not
loosened by this section.

### Frozen business terms

The following business terms are officially frozen. They must not be
translated, renamed, or replaced without an Architecture Review and a
documentation update:

- MQR
- NTR
- PM
- PIP
- AI Engineering
- Predictive Quality
- Troubleshooting (การแก้ไขปัญหา)

These terms are platform vocabulary rather than ordinary UI labels - they
identify a business concept the Thai-speaking user base already uses
regardless of which UI language is toggled on (see "Why some terms are
fixed across both locales" above).

### Change governance

Any future change to a frozen business term requires:

- Architecture Review
- Design Review
- Documentation Review

and updating every affected artifact, including:

- Navigation
- Design Framework
- UI Standards
- Translation Resources
- User Documentation
- Help Pages
- Training Materials
- Release Notes
- This Terminology Standard

### Consistency rule

Frozen business terms must use exactly the same wording across:

- Navigation
- Dashboard
- Machine Passport
- Search
- Breadcrumbs
- Related Records
- Empty States
- Notifications
- Reports
- Documentation

No alternative wording is permitted. For example, for the Troubleshooting
term:

- Correct: `Troubleshooting (การแก้ไขปัญหา)`
- Incorrect: `การแก้ไขปัญหา`, `Troubleshooting`, `Diagnosis`, `Fault
  Finding`, `วิเคราะห์ปัญหา`, `คู่มือแก้ปัญหา`

This rule applies platform-wide, not only to the surfaces that currently
render a frozen term - see "Consistency requirement: Troubleshooting"
below for the current-vs-future distinction for that specific term.

## Official UI wording

| Concept | Official term | Locale |
|---|---|---|
| Quality Cases (nav item, `/records`) | รายงานปัญหาคุณภาพ | Both `en` and `th` - fixed term, not translated per-locale (matches this doc's own pre-existing Business Terminology table, which already defined รายงานปัญหาคุณภาพ as the canonical term for Market Quality Report/quality cases) |
| Quality Dashboard (nav item, `/quality/dashboard`) | แดชบอร์ดคุณภาพ | `th`; `en` keeps "Quality Dashboard" |
| Quality Analytics (nav item, Coming Soon) | การวิเคราะห์ | `th`; `en` keeps "Analytics" |
| Quality Knowledge (nav item, `/quality/knowledge` as of the Engineering Knowledge Platform, ADR-018 - was Coming Soon) | องค์ความรู้ | Both `en` and `th` - fixed term (correction: this row previously said "`en` keeps 'Knowledge'," but the actual locale files have always had the identical Thai string in both locales, matching the fixed-term pattern used for Troubleshooting/PIP/AI Engineering/Predictive Quality below - the doc was stale, not the code; corrected here per this doc's own "if the drift reveals this document itself is wrong, say so and update it" rule) |
| Knowledge Maturity badge values (`/quality/knowledge` list/detail) | Draft ฉบับร่าง / In Review กำลังตรวจสอบ / Published เผยแพร่แล้ว / Deprecated เลิกใช้งาน / Archived เก็บถาวร | `th` translates each; `en` keeps the English stage name. "Candidate" and "Case" are informal UI names for a maturity bucket (Draft/Review = Candidate, Published/Deprecated/Archived = Case), not separate stored values or separate terms requiring their own row |
| Knowledge Confidence badge values (`/quality/knowledge` list/detail, Machine Passport Known Issues) | Very Low ต่ำมาก / Low ต่ำ / Medium ปานกลาง / High สูง / Verified ยืนยันแล้ว | `th` translates each; `en` keeps the English level name. Manual only - never assigned by AI |
| **Troubleshooting** (nav item under Quality, Coming Soon; Machine Passport reserved section; also the official term for this capability in breadcrumbs, search, Related Records, and empty-state copy - see Consistency requirement below) | **Troubleshooting (การแก้ไขปัญหา)** | Both `en` and `th` - fixed compound term (see below) |
| AI Engineering (nav item under Engineering Intelligence, Coming Soon) | AI Engineering | Both `en` and `th` - intentional English exception |
| PIP / Product Improvement Plan (nav item under Engineering Intelligence and under Service > Campaigns, Coming Soon) | แผนปรับปรุงผลิตภัณฑ์ (PIP) | Both `en` and `th` - fixed term |
| Predictive Quality (nav item under Engineering Intelligence, Coming Soon) | Predictive Quality | Both `en` and `th` - intentional English exception |
| Platform Overview (`/dashboard` page title) | ภาพรวมแพลตฟอร์ม | `th`; `en` keeps "Platform Overview" |
| Platform KPIs (dashboard section heading) | ตัวชี้วัดหลักของแพลตฟอร์ม | `th`; `en` keeps "Platform KPIs" |
| Registered Machines (KPI label) | เครื่องจักรที่ลงทะเบียน | `th`; `en` keeps "Registered Machines" |
| System Health (KPI/HealthCard label) | สถานะระบบ (การซิงค์ข้อมูลเครื่องจักรหลัก) | `th`; `en` keeps "System Health (Vehicle Master sync)" |
| Today's Activities (dashboard section heading) | กิจกรรมวันนี้ | `th`; `en` keeps "Today's Activities" |
| Quick Actions (dashboard section heading) | การดำเนินการด่วน | `th`; `en` keeps "Quick Actions" |
| "View ..." action links (e.g. View Machine Registry, View Open Cases) | ดู... | `th` translates per destination; `en` keeps "View ..." |
| Dashboard MSEAL PDI (nav item, `/delivery/pdi/dashboard`, disambiguates from the top-level Platform Overview "Dashboard") | Dashboard MSEAL PDI | Both `en` and `th` - intentional identical-string exception, same rationale as AI Engineering/Predictive Quality below (a fixed internal system name, not translated prose) |
| Incoming PDI (nav item, `/delivery/pdi`) | ตรวจสอบเครื่องจักรนำเข้าใหม่ MSEAL PDI | `th` translates fully; `en` keeps "Incoming PDI." Note: this is a different surface label than the `pdi.*` screen-content namespace's own official term "Import Inspection" (see Domain ownership below) - both nav items are business-decision renames (Product Owner, 2026-07-16), not yet reconciled with the screen-content wording; tracked here rather than silently left inconsistent. |
| "Search ..." helper text (e.g. Search machines by serial/model) | ค้นหา... | `th` translates per context; `en` keeps "Search ..." |
| "Register ..." action labels (e.g. Register New Tractor) | ลงทะเบียน... | `th` translates per context; `en` keeps "Register ..." |

All values above live in `src/locales/en.json`/`th.json`'s `nav`/
`dashboard`/`machinePassport` namespaces - see `src/lib/i18n/` for how a
Server or Client Component looks one up via `t('namespace.key')`. Never
hardcode one of these strings directly in a component; always add or
reuse a locale key.

### Why some terms are fixed across both locales

A handful of terms above (Quality Cases, PIP, Troubleshooting, AI
Engineering, Predictive Quality) show the *identical* string in both
`en.json` and `th.json`, rather than a locale-appropriate translation.
This is deliberate, not an oversight: this platform is Thai-first (Goal
1 of this cleanup pass; `DEFAULT_LOCALE` in `src/lib/i18n/types.ts` is
already `'th'`), and these specific terms are established, fixed business
vocabulary the Thai-speaking user base already uses regardless of which
UI language happens to be toggled on - the same way `MQR`/`NTR`/`PM`
already appear unchanged in both locales elsewhere in this app. Every
*other* label in the tables above still translates normally per locale.

**Troubleshooting is a compound term, not an English-only exception**:
the official wording is the single fixed string **"Troubleshooting
(การแก้ไขปัญหา)"** - English term followed by its Thai gloss in
parentheses - shown identically in both locales, never split into two
separate per-locale values and never shortened to just "Troubleshooting"
or just "การแก้ไขปัญหา" on their own.

### Consistency requirement: Troubleshooting

"Troubleshooting (การแก้ไขปัญหา)" is the one official term for this
capability, wherever it appears. It must render identically across:

- **Navigation** - the Quality group's nav entry (`nav.troubleshooting`).
- **Machine Passport** - the reserved section's heading and `EmptyState`
  title (`machinePassport.troubleshootingTitle`).
- **Dashboard** - if a Troubleshooting widget/link is ever added to
  Platform Overview or a domain dashboard.
- **Breadcrumbs** - `PlatformHeader`'s breadcrumb/title lookup
  (`flattenRealNavItems`/`findActiveNavItem`) derives its text directly
  from the same nav item label, so once Troubleshooting becomes a real
  route, its breadcrumb is automatically correct with no separate
  implementation - as long as no one hardcodes a second, differently-
  worded breadcrumb string for it.
- **Search** - the Universal Search data contract
  (`.claude/skills/mseal-platform-design/SEARCH_GUIDELINES.md`), once
  built, indexes/displays this capability under this exact term.
- **Related Records** - if a Related Records panel (Machine Passport or
  elsewhere) ever links to or labels a Troubleshooting record/category.
- **Empty States** - any `EmptyState` referencing this capability (title,
  reason, or next step copy) names it this way, not a paraphrase.
- **Documentation references** - `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`,
  `.claude/skills/mseal-platform-design/NAVIGATION_GUIDELINES.md`, and any
  other doc declaring this as *the UI term* (not casual prose describing
  the underlying concept - see Translation Rule 5) use the same exact
  string.

None of the surfaces above except Navigation and Machine Passport
currently render this term - Dashboard/Breadcrumbs/Search/Related Records
have no Troubleshooting content today (no new placeholder was added to
any of them by this rule; see Forbidden wording and Translation Rule 6).
This section exists so that whenever one of them *does* gain
Troubleshooting content, the wording is already decided rather than
invented ad hoc.

## Forbidden wording

Never use the following in new or edited UI text - if you find one,
replace it with the official term above in the same change:

- **"Quality Cases"** (English) - replaced by "รายงานปัญหาคุณภาพ" everywhere.
- **"กรณีปัญหา"** (Thai) - replaced by "รายงานปัญหาคุณภาพ" everywhere.
- **"Recall"** as a standalone nav item or dashboard placeholder - removed
  entirely (not carried forward as Coming Soon). No Recall module or data
  exists, and it had no distinct destination from Service Campaign. If a
  real Recall capability is ever built, it requires its own product
  decision and ADR, not a silent re-add of the old placeholder.
- **"Knowledge Engine"** as a separate Engineering Intelligence nav entry
  - Knowledge is its own independent domain, nav-grouped under Quality's
    menu for UX/discoverability, not owned by Quality or by Engineering
    Intelligence (see Domain ownership below, corrected by ADR-018); do
    not reintroduce a duplicate Engineering Intelligence "Knowledge" entry.
- **"Insights"** / **"AI Analysis"** as separate Engineering Intelligence
  nav entries - consolidated into the single "AI Engineering" entry.
  Do not re-split them without a product decision.
- **Plain "Troubleshooting"** or plain **"การแก้ไขปัญหา"** alone, as a UI
  label - replaced by the single fixed term "Troubleshooting
  (การแก้ไขปัญหา)" everywhere (see Consistency requirement above).
- **"No Data"** / **"ไม่มีข้อมูล"** as empty-state copy - unrelated to this
  pass but already forbidden platform-wide, see
  `.claude/skills/mseal-platform-design/EMPTY_STATE_GUIDELINES.md`.
- **"Dealer Approval"** / **"Dealer PDI"** (business-domain correction,
  ADR-028) - Import Inspection has no Dealer Approval concept; use
  "Release to Dealer" (an MSEAL-only decision) instead. "Dealer PDI"
  never existed in the corrected model - every inspection in this domain
  is an Import Inspection.

## Domain ownership (binding, see `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` §2a)

- **Quality owns execution**: Quality Cases and Troubleshooting
  (technicians diagnosing an active quality problem).
- **Knowledge owns itself** (corrected by ADR-018, Engineering Knowledge
  Platform - this line previously said "Quality owns... Knowledge,"
  which contradicted that epic's own explicit Vision, "Knowledge is NOT
  owned by Quality/PM/Warranty/Machine," and its own independent
  `knowledge_cases`/`knowledge_evidence` tables and `KnowledgeService` -
  the doc was stale, not the architecture; corrected here per this doc's
  own "if the drift reveals this document itself is wrong, say so and
  update it" rule). Knowledge aggregates Evidence from every domain,
  including Quality, PM, Warranty, Machine, Dealer, Customer, and
  Engineer - it is not subordinate to any one of them. Its nav entry
  sits under the Quality menu group purely for UX/discoverability
  (technicians move Quality Cases -> Troubleshooting -> Knowledge in one
  place), which is a navigation-placement decision, not a data-ownership
  one - see `docs/architecture/KNOWLEDGE_PLATFORM.md` §1/§7.
- **Engineering Intelligence owns analysis**: AI Engineering, PIP,
  Predictive Quality - consumes Knowledge (never raw Quality/PM/Warranty
  data directly, and never owns a second copy of Knowledge itself).
- **Delivery owns the lifecycle, Inspection owns Import Inspection**
  (ADR-027/ADR-017, amended by ADR-028, Machine Delivery Platform).
  Delivery is the lifecycle-tracking aggregate - Tractor In, Stock Yard,
  Dealer Preparation, Operator Training, Delivery Acceptance, Warranty
  Activation. It never duplicates what another domain already owns:
  Tractor In reads `vehicles` (ADR-012 owns that sync), Import Inspection
  links an Inspection (Inspection domain owns the checklist/findings/
  evidence), Customer Delivery links an `NtrRecord` (Service >
  Registration owns NTR's own fields). Import Inspection has exactly one
  nav entry, under Delivery, gated to MSEAL roles only - not under
  Quality or Engineering Intelligence, and never visible to a Dealer
  role.
- **Import Inspection** (business-domain correction, ADR-028) - the
  internal MSEAL quality process performed before a machine is Released
  to Dealer. "PDI" and "RE-PDI" are inspection **events** within this one
  capability, not separate capabilities - a machine may have several,
  chained and immutable. **Import Inspection is not Dealer Delivery** -
  Dealer Delivery starts only after Release to Dealer. Dealer roles never
  view, create, edit, or approve Import Inspection (`canAccessImportInspection`,
  `lib/scope.ts`) - there is no "Dealer Approval" of an inspection.
- **Release to Dealer** - the MSEAL-only decision ending the Import
  Inspection stage for one machine, distinct from Delivery Acceptance
  (a later, Delivery-lifecycle, Dealer-side event).
- **Warranty Activation is automatic, triggered by NTR only** (ADR-028) -
  never a manual action, never triggered by Delivery Acceptance. NTR
  (New Tractor Registration) is the ownership-transfer event.
- Each of these concepts has **exactly one** nav entry platform-wide.
  Never duplicate a concept's placeholder across two groups to "cover
  both angles" - if a concept genuinely belongs in two places for two
  different reasons (e.g. Service > Campaigns' own PIP entry, which
  represents Service's campaign-tracking view of a PIP rather than a
  second copy of the PIP page), document why in the nav config comment,
  the same way `navConfig.ts` already does.

## Translation rules

1. **UI is Thai-first.** `DEFAULT_LOCALE` is `'th'` - write the Thai
   value first, then the English value, not the other way around.
2. **Code, API routes, database tables/columns, and TypeScript types stay
   in English, always** - this document governs what a user reads, never
   an identifier. Renaming `qualityCases` (the locale key) is fine;
   renaming `/records` (the route) or `records`/`record_audit_log` (the
   tables) is not in scope for a terminology change and requires its own
   architecture-level decision.
3. **Every user-facing string goes through `t('namespace.key')`** (server:
   `@/lib/i18n/server`'s `t()`; client: `useTranslation()`) - never a
   hardcoded string literal in JSX. `en.json` must define every key
   `th.json` defines (`src/lib/i18n/dictionaries.ts`'s `satisfies
   Dictionary` check enforces this at compile time) - adding a Thai-only
   key without its English counterpart fails the build.
4. **One official term per concept, reused everywhere it appears** - a
   nav label, a KPI label, a QuickActionCard label/description, and a
   page heading referring to the same business concept all use the exact
   same locale value (or the same key), never independently-worded
   near-synonyms that drift apart over time.
5. **Comments and internal documentation are not UI text** - a code
   comment or ADR prose describing "Quality Cases" as a concept is not
   required to use the exact official UI string; only what a user actually
   sees in the rendered app is governed by this document.
6. **No new placeholder nav items without a real destination or an
   explicit, already-approved Coming Soon per `NAVIGATION_GUIDELINES.md`**
   - a wording/terminology cleanup renames, relocates, or removes existing
   placeholders; it does not invent new ones.
