# 13 — Roadmap & Migration Strategy

## Roadmap (as given)

| Phase | Focus |
|---|---|
| 1 | Machine Profile |
| 2 | Machine Timeline |
| 3 | Knowledge Base |
| 4 | AI Troubleshooting Assistant |
| 5 | Quality Intelligence |
| 6 | PIP Management |
| 7 | Predictive Quality Analytics |
| 8 | Machine Intelligence Platform |

## Reconciliation with `docs/ROADMAP.md`'s existing Next Milestones

`docs/ROADMAP.md` already carries a committed, nearer-term plan (Sync
Improvements, Google Sheet Master Data, Vehicle 360, Workflow, Reporting,
Engineering Quality, Technical Debt, v3.0 Digital Tractor Passport). This
blueprint's 8 phases are **not a replacement** for that roadmap — they
are its long-term continuation, and they depend on some of the same
items:

| This blueprint's phase | Depends on / relates to `docs/ROADMAP.md` item |
|---|---|
| Phase 1 (Machine Profile) | Builds directly on "Vehicle 360" (already a Next Milestone) and the already-shipped Machine 360 facade (ADR-009) — same page, extended scope (10) |
| Phase 2 (Machine Timeline) | Extends the already-shipped Activity Timeline platform (03) — no new component, more event sources |
| Phase 3 (Knowledge Base) | New — no equivalent item in the existing roadmap; first genuinely new domain |
| Phase 4–8 | New — depend on Phase 1–3 existing first; not started until then |
| (existing) Google Sheet Master Data | A **prerequisite**, not a parallel track — Knowledge Cases (07) key off `product_family_id`, which depends on Tractor IN's Product Family/Sub Model sync reaching 100% population, exactly as `docs/ROADMAP.md` already flags for PM's own model-derivation fallback |
| (existing) v3.0 Digital Tractor Passport | The eventual convergence point — a Digital Tractor Passport *is* a Machine Profile (10) with a public/QR-code entry point; this blueprint's Phase 1 is effectively that item's foundation |

**Recommendation**: update `docs/ROADMAP.md`'s "Next Milestones" table to
add a forward-reference to this blueprint once this PR is reviewed and
accepted, rather than duplicating phase numbering across two documents —
tracked as a follow-up docs task, not done in this PR (which does not
modify `ROADMAP.md`, per this PR's own scope).

## Recommended Implementation Order (within this blueprint)

1. **Event Model foundation (06)** — extend `AuditModule`/introduce
   `PlatformEvent` as an additive superset. This unlocks every later
   phase; nothing else in this list is buildable first.
2. **Machine Timeline generalization (03, Phase 2)** — lower risk than
   it looks: the component already exists and is already
   proven-generic (Activity Timeline's own final review). Doing this
   *before* Machine Profile gives Phase 1 a working Timeline section to
   aggregate, instead of building both at once.
3. **Machine Profile (10, Phase 1)** — aggregates what already exists
   (Summary, Timeline, Attachments) plus Inspection once it lands (next
   item). Low risk: it is explicitly a read-only aggregation page.
4. **Inspection Domain (04)** — the first genuinely new operational
   domain. Deliberately sequenced early because Import PDI/Dealer PDI
   are concrete, bounded, and immediately useful on their own (dealers
   get a real PDI record) even before Knowledge/AI exist to consume it.
5. **Knowledge Base (07, Phase 3)** — can only be built once there is
   real event volume from MQR (already shipped) + Inspection (previous
   step) to learn from. Building Knowledge before there's data to
   populate it produces an empty, unconvincing feature.
6. **PIP Management (05, Phase 6)** — depends on Knowledge existing
   (PIPs reference Knowledge-surfaced patterns), so it comes after
   Phase 3 despite being numbered Phase 6 in the given roadmap — the
   given numbering and the dependency-correct build order are not
   required to match line-for-line, and this document says so
   explicitly rather than silently reordering without comment.
7. **AI Troubleshooting Assistant (08, Phase 4)** — depends on Knowledge
   (step 5) having enough real cases to make Similar Case Retrieval
   meaningful. Building this before Knowledge has real data would
   produce a demo, not a tool.
8. **Quality Intelligence (Phase 5) / Predictive Quality Analytics
   (09, Phase 7)** — depend on Knowledge + enough historical Event
   volume for trend detection to be statistically meaningful, so they
   are necessarily later than Phases 3–4 regardless of their given
   numbering.
9. **Machine Intelligence Platform (Phase 8)** — the "everything is
   integrated and mature" milestone, not a discrete build — this phase
   is really "Phases 1–7 operating together at scale," not a ninth new
   thing to construct.

## Migration Roadmap (what actually gets migrated, and when — none of it in this PR)

| Migration | When | Risk |
|---|---|---|
| `AuditModule` union extended with `'inspection'`, `'pip'`, `'machine'` | Alongside Inspection Domain build (step 4) | Low — additive |
| New tables: `inspections` | Step 4 | Low — additive, no existing table touched |
| New tables: `knowledge_cases` | Step 5 | Low — additive |
| New tables: `pip_records` | Step 6 | Low — additive |
| New table: `machine_ownership_history` | Whenever Ownership Transfer (03) is prioritized — not strictly ordered above, can move earlier if the business needs it sooner | Low — additive |
| Any Warranty/Parts schema | Only once those become real modules (05, 14) — no schema proposed until a confirmed business requirement exists, per `PLATFORM_ARCHITECTURE_STANDARDS.md`'s Architecture Evolution Rule | N/A — not designed yet |

Every migration above follows 11's Database Evolution Strategy: additive
tables, additive unions, no rename, no data migration of existing rows.

## Explicitly not decided here

- Exact sprint/quarter timing for any phase — a resourcing/business
  decision, not an architecture one.
- Whether Phases 4–8 are built by the same team building Phases 1–3, or
  a dedicated "Engineering Intelligence" team once Knowledge exists — an
  organizational decision outside this document's scope.
